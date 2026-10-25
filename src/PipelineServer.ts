import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import type * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import type * as Headers from "effect/http/Headers"
import type * as HttpRouter from "effect/http/HttpRouter"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as RpcSchema from "effect/rpc/RpcSchema"
import * as Layer from "effect/Layer"
import type { CapabilityInstance } from "./Capability.js"
import { isInstance, isRef } from "./Capability.js"
import * as Duplex from "./Duplex.js"
import { PipelineExecutionError, PipelineProtocolError, type Expr, type PipelineNode, type PipelineRequest } from "./Pipeline.js"
import type { PipelineResponse } from "./PipelineClient.js"
import { makeScope, RequestScope } from "./RequestBatching.js"

export { PipelineExecutionError, PipelineProtocolError }

type ServerDefinition<R extends Rpc.Any> = { readonly id: string; readonly root: RpcGroup.RpcGroup<R> }
export type RequestMetadata = {
  readonly client: Rpc.ServerClient
  readonly requestId: unknown
  readonly headers: Headers.Headers
}
export type Requirements<R extends Rpc.Any> = Rpc.ToHandler<R> | Rpc.Middleware<R> | Rpc.ServicesServer<R>

export interface RequestContext<R extends Rpc.Any = any> {
  /** Configured server definition, independent of untrusted request metadata. */
  readonly definitionId: string
  readonly group: RpcGroup.RpcGroup<R>
  readonly request: PipelineRequest
  readonly metadata: RequestMetadata
}

export interface ExecutionContext<R extends Rpc.Any = any> extends RequestContext<R> {
  readonly rpcTags: ReadonlyArray<string>
}

export interface InvocationContext<R extends Rpc.Any = any> extends ExecutionContext<R> {
  readonly nodeId: string
  readonly invocation: number
  readonly kind: "root" | "capability"
  readonly rpc: Rpc.Any
}

type Around<C, EX, RX> = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: C
) => Effect.Effect<A, E | EX, R | RX>

/** Advanced lifecycle middleware. Built-in integrations construct this value for normal use. */
export interface Middleware<EX = never, RX = never> {
  readonly request?: Around<RequestContext, EX, RX>
  readonly execution?: Around<ExecutionContext, EX, RX>
  readonly invocation?: Around<InvocationContext, EX, RX>
}

export const makeMiddleware = <RX = never, EX = never>(middleware: Middleware<EX, RX>): Middleware<EX, RX> => middleware

export type MiddlewareRequirements<M> = M extends Middleware<any, infer R> ? R : never
export type MiddlewaresRequirements<M extends ReadonlyArray<Middleware<any, any>>> = MiddlewareRequirements<M[number]>

export interface ServerOptions<M extends ReadonlyArray<Middleware<any, any>> = readonly []> {
  readonly id?: string
  readonly middleware?: M
  readonly limits?: {
    readonly maxNodes?: number
    readonly maxMapItems?: number
    readonly maxInvocations?: number
    readonly concurrency?: number
    readonly maxDepth?: number
    readonly maxExpressionNodes?: number
    readonly maxExecutionSteps?: number
  }
}

interface ExecutionLimits {
  readonly maxNodes: number
  readonly maxMapItems: number
  readonly maxInvocations: number
  readonly concurrency: number
  readonly maxDepth: number
  readonly maxExpressionNodes: number
  readonly maxExecutionSteps: number
}

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value < 1 ? fallback : Math.floor(value)

const executionLimits = (options?: ServerOptions<any>): ExecutionLimits => ({
  maxNodes: positiveLimit(options?.limits?.maxNodes, 1000),
  maxMapItems: positiveLimit(options?.limits?.maxMapItems, 1000),
  maxInvocations: positiveLimit(options?.limits?.maxInvocations, 10_000),
  concurrency: positiveLimit(options?.limits?.concurrency, 64),
  maxDepth: positiveLimit(options?.limits?.maxDepth, 64),
  maxExpressionNodes: positiveLimit(options?.limits?.maxExpressionNodes, 100_000),
  maxExecutionSteps: positiveLimit(options?.limits?.maxExecutionSteps, 100_000)
})

const PathSchema = Schema.Array(Schema.Union([Schema.String, Schema.Number]))
export const ExprSchema: Schema.Codec<Expr> = Schema.suspend(() => Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("literal"), value: Schema.optionalKey(Schema.Json) }),
  Schema.Struct({ _tag: Schema.Literal("ref"), id: Schema.String, path: PathSchema }),
  Schema.Struct({ _tag: Schema.Literal("item"), scope: Schema.String, path: PathSchema }),
  Schema.Struct({ _tag: Schema.Literal("array"), values: Schema.Array(ExprSchema) }),
  Schema.Struct({ _tag: Schema.Literal("object"), entries: Schema.Array(Schema.Tuple([Schema.String, ExprSchema])) }),
  Schema.Struct({ _tag: Schema.Literal("none") }),
  Schema.Struct({ _tag: Schema.Literal("some"), value: ExprSchema })
])) as Schema.Codec<Expr>
export const PipelineNodeSchema: Schema.Codec<PipelineNode> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("call"),
    id: Schema.String,
    scope: Schema.optionalKey(Schema.String),
    target: Schema.optionalKey(ExprSchema),
    method: Schema.String,
    payload: ExprSchema,
    dependencies: Schema.Array(Schema.String)
  }),
  Schema.Struct({
    _tag: Schema.Literal("map"),
    id: Schema.String,
    scope: Schema.optionalKey(Schema.String),
    source: ExprSchema,
    template: ExprSchema,
    dependencies: Schema.Array(Schema.String)
  })
]) as Schema.Codec<PipelineNode>
export const PipelineRequestSchema: Schema.Codec<PipelineRequest> = Schema.Struct({
  version: Schema.Literal(1),
  definitionId: Schema.String,
  nodes: Schema.Array(PipelineNodeSchema),
  selection: ExprSchema,
  discards: Schema.Array(Schema.String)
}) as Schema.Codec<PipelineRequest>

export const PipelineRpc = Rpc.make("__effect_rpc_pipeline_v1", {
  // Structural validation is bounded inside the handler, before recursively
  // decoding expressions. Native RPC must not recurse through the graph first.
  payload: Schema.declare<PipelineRequest>((value): value is PipelineRequest => typeof value === "object" && value !== null),
  success: Schema.Unknown,
  error: Schema.Unknown
})

interface ExecutionWork {
  readonly step: Effect.Effect<void, PipelineProtocolError>
  readonly consume: () => void
}

const makeExecutionWork = (limit: number): ExecutionWork => {
  let steps = 0
  const consume = () => {
    if (++steps > limit) throw new PipelineProtocolError("Pipeline execution work limit exceeded", "LimitExceeded")
  }
  return {
    consume,
    step: Effect.try({ try: consume, catch: (error) => error as PipelineProtocolError })
  }
}

const pathValue = (value: unknown, path: ReadonlyArray<string | number>, work: ExecutionWork): unknown => {
  let current = value
  for (const part of path) {
    work.consume()
    if (current === null || current === undefined) throw new PipelineProtocolError(`Cannot read ${String(part)} from nullish value`, "InvalidPath")
    if (part === "__proto__" || part === "prototype" || part === "constructor" ||
      (typeof part === "number" && (!Number.isSafeInteger(part) || part < 0)) ||
      (!Object.hasOwn(Object(current), part) && part in Object(current))) {
      throw new PipelineProtocolError(`Invalid own-property path ${String(part)}`, "InvalidPath")
    }
    current = (current as any)[part]
  }
  return current
}

const evalExpr = (expr: Expr, values: Map<string, unknown>, items: ReadonlyMap<string, unknown>, work: ExecutionWork): unknown => {
  work.consume()
  switch (expr._tag) {
    case "literal": return expr.value
    case "ref": {
      if (!values.has(expr.id)) throw new PipelineProtocolError(`Unknown or unresolved ref ${expr.id}`, "InvalidReference")
      return pathValue(values.get(expr.id), expr.path, work)
    }
    case "item": {
      if (!items.has(expr.scope)) throw new PipelineProtocolError("Map item escaped its scope", "InvalidReference")
      return pathValue(items.get(expr.scope), expr.path, work)
    }
    case "array": return expr.values.map((value) => evalExpr(value, values, items, work))
    case "object": return Object.fromEntries(expr.entries.map(([key, value]) => [key, evalExpr(value, values, items, work)]))
    case "none": return Option.none()
    case "some": return Option.some(evalExpr(expr.value, values, items, work))
  }
}

// Prefer the declared encoded representation, then support decoded values such
// as OptionFromNullOr inputs and references to earlier decoded handler results.
const decodePayload = (rpc: Rpc.AnyWithProps, value: unknown): Effect.Effect<unknown, unknown, any> =>
  Schema.decodeUnknownEffect(rpc.payloadSchema)(value).pipe(Effect.catch(() =>
    Schema.encodeUnknownEffect(rpc.payloadSchema)(value).pipe(Effect.flatMap(Schema.decodeUnknownEffect(rpc.payloadSchema)))
  ))

const encodeTransportValue = (value: unknown): unknown => {
  const ancestors = new WeakSet<object>()
  let count = 0
  const encode = (value: unknown, depth: number): unknown => {
    if (++count > 100_000 || depth > 64) throw new PipelineProtocolError("Pipeline result structure limit exceeded", "LimitExceeded")
    if (value === undefined) return { _id: "effect-rpc-pipeline/Undefined" }
    if (typeof value === "number" && !Number.isFinite(value) || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
      throw new PipelineProtocolError("Pipeline results must contain JSON data or Option values", "UnsupportedValue")
    }
    if (value === null || typeof value !== "object") return value
    if (ancestors.has(value)) throw new PipelineProtocolError("Cyclic pipeline result", "UnsupportedValue")
    ancestors.add(value)
    try {
      if (Option.isOption(value)) return Option.isNone(value)
        ? { _id: "Option", _tag: "None" }
        : { _id: "Option", _tag: "Some", value: encode(value.value, depth + 1) }
      if (Array.isArray(value)) return value.map((item) => encode(item, depth + 1))
      const tag = Object.prototype.toString.call(value)
      if (tag !== "[object Object]" && tag !== "[object Error]") throw new PipelineProtocolError("Unsupported pipeline result object", "UnsupportedValue")
      const entries = Object.entries(value)
      // Error.message is non-enumerable, including on Schema.TaggedError.
      if ("_tag" in value && Object.hasOwn(value, "message") && typeof (value as any).message === "string" && !entries.some(([key]) => key === "message")) entries.push(["message", (value as any).message])
      return Object.fromEntries(entries.map(([key, item]) => [key, encode(item, depth + 1)]))
    } finally {
      ancestors.delete(value)
    }
  }
  return encode(value, 0)
}

const refsIn = (expr: Expr, out = new Set<string>()): Set<string> => {
  if (expr._tag === "ref") { out.add(expr.id); return out }
  if (expr._tag === "array") for (const value of expr.values) refsIn(value, out)
  if (expr._tag === "object") for (const [, value] of expr.entries) refsIn(value, out)
  if (expr._tag === "some") refsIn(expr.value, out)
  return out
}

const applyMiddleware = (
  middleware: ReadonlyArray<Middleware<any, any>>,
  stage: "request" | "execution" | "invocation",
  effect: Effect.Effect<any, any, any>,
  context: RequestContext<any> | ExecutionContext<any> | InvocationContext<any>
): Effect.Effect<any, any, any> => middleware.reduceRight((current, entry) => {
  const around = entry[stage] as Around<any, any, any> | undefined
  return around === undefined ? current : around(current, context)
}, effect)

interface ExecutionPlan<R extends Rpc.Any> {
  readonly definition: ServerDefinition<R>
  readonly request: PipelineRequest
  readonly executable: ReadonlyArray<PipelineNode>
  readonly required: ReadonlyMap<string, ReadonlyArray<string>>
  readonly regions: ReadonlyMap<string | undefined, ReadonlyArray<PipelineNode>>
  readonly rpcTags: ReadonlyArray<string>
  readonly limits: ExecutionLimits
}

const expressionsFor = (node: PipelineNode): ReadonlyArray<Expr> => node._tag === "map"
  ? [node.source, node.template]
  : node.target === undefined ? [node.payload] : [node.payload, node.target]

const validatePath = (path: ReadonlyArray<string | number>): void => {
  if (path.some((part) => part === "__proto__" || part === "prototype" || part === "constructor" ||
    (typeof part === "number" && (!Number.isSafeInteger(part) || part < 0)))) {
    throw new PipelineProtocolError("Invalid property path", "InvalidPath")
  }
}

const scopedWithin = (scope: string | undefined, owner: string, index: ReadonlyMap<string, PipelineNode>): boolean => {
  while (scope !== undefined) {
    if (scope === owner) return true
    scope = index.get(scope)?.scope
  }
  return false
}

// A map waits for external closures and sequencing barriers, while its own
// template nodes execute separately for each item.
const requiredFor = (node: PipelineNode, index: ReadonlyMap<string, PipelineNode>): ReadonlyArray<string> => {
  const refs = new Set([...node.dependencies, ...expressionsFor(node).flatMap((expr) => [...refsIn(expr)])])
  if (node._tag === "map") {
    for (const child of index.values()) {
      if (scopedWithin(child.scope, node.id, index)) {
        for (const ref of child.dependencies) refs.add(ref)
        for (const expr of expressionsFor(child)) for (const ref of refsIn(expr)) refs.add(ref)
      }
    }
    for (const ref of refs) if (scopedWithin(index.get(ref)?.scope, node.id, index)) refs.delete(ref)
  }
  return [...refs]
}

const executeRegion = (
  nodes: ReadonlyArray<PipelineNode>,
  values: Map<string, unknown>,
  execute: (node: PipelineNode) => Effect.Effect<void, unknown, any>,
  required: ReadonlyMap<string, ReadonlyArray<string>>,
  concurrency: number
): Effect.Effect<void, unknown, any> => Effect.suspend(() => {
  const pending = [...nodes]
  const next = (): Effect.Effect<void, unknown, any> => {
    if (pending.length === 0) return Effect.void
    const ready = pending.filter((node) => required.get(node.id)!.every((id) => values.has(id)))
    if (ready.length === 0) return Effect.fail(new PipelineProtocolError("Unresolved pipeline dependency", "InvalidReference"))
    for (const node of ready) pending.splice(pending.indexOf(node), 1)
    return Effect.forEach(ready, execute, { concurrency, discard: true }).pipe(Effect.flatMap(next))
  }
  return next()
})

const decodeRequest = (input: unknown, limits: ExecutionLimits): PipelineRequest => {
  // Bound the structure before recursive schema decoding or graph traversal.
  const pending = [{ value: input, depth: 0 }]
  let count = 0
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!
    if (++count > limits.maxExpressionNodes || depth > limits.maxDepth) throw new PipelineProtocolError("Pipeline structure limit exceeded", "LimitExceeded")
    if (value !== null && typeof value === "object") {
      const entries = Object.values(value)
      if (entries.length + count + pending.length > limits.maxExpressionNodes) throw new PipelineProtocolError("Pipeline structure limit exceeded", "LimitExceeded")
      for (const child of entries) pending.push({ value: child, depth: depth + 1 })
    }
  }
  try {
    return Schema.decodeUnknownSync(PipelineRequestSchema)(input)
  } catch {
    throw new PipelineProtocolError("Malformed pipeline request", "InvalidPipeline")
  }
}

const compilePipeline = <R extends Rpc.Any>(
  group: RpcGroup.RpcGroup<R>,
  request: PipelineRequest,
  options?: ServerOptions<any>
): Effect.Effect<ExecutionPlan<R>, PipelineProtocolError> => Effect.try({
  try: () => {
    const definition: ServerDefinition<R> = { id: options?.id ?? "default", root: group }
    const limits = executionLimits(options)
    if (request.version !== 1 || request.definitionId !== definition.id) throw new PipelineProtocolError("Unsupported pipeline definition or version")
    if (request.nodes.length > limits.maxNodes) throw new PipelineProtocolError("Pipeline node limit exceeded", "LimitExceeded")
    const nodeIndex = new Map(request.nodes.map((node) => [node.id, node]))
    if (nodeIndex.size !== request.nodes.length) throw new PipelineProtocolError("Duplicate pipeline node id", "InvalidPipeline")

    const ancestors = (scope: string | undefined): Set<string | undefined> => {
      const out = new Set<string | undefined>([undefined])
      while (scope !== undefined) {
        if (out.has(scope)) throw new PipelineProtocolError("Cyclic map scopes", "InvalidReference")
        out.add(scope)
        if (out.size > limits.maxDepth) throw new PipelineProtocolError("Map scope depth limit exceeded", "LimitExceeded")
        const owner = nodeIndex.get(scope)
        if (owner?._tag !== "map") throw new PipelineProtocolError("Unknown map scope", "InvalidReference")
        scope = owner.scope
      }
      return out
    }
    const validateExpression = (expr: Expr, scope: string | undefined): void => {
      const allowed = ancestors(scope)
      const visit = (expression: Expr): void => {
        if (expression._tag === "ref") {
          const referenced = nodeIndex.get(expression.id)
          if (!referenced || !allowed.has(referenced.scope)) throw new PipelineProtocolError(`Out-of-scope or unknown ref ${expression.id}`, "InvalidReference")
          validatePath(expression.path)
        } else if (expression._tag === "item") {
          if (!allowed.has(expression.scope)) throw new PipelineProtocolError("Map item escaped its scope", "InvalidReference")
          validatePath(expression.path)
        } else if (expression._tag === "array") expression.values.forEach(visit)
        else if (expression._tag === "object") expression.entries.forEach(([, value]) => visit(value))
        else if (expression._tag === "some") visit(expression.value)
      }
      visit(expr)
    }
    for (const node of request.nodes) {
      const allowed = ancestors(node.scope)
      for (const dependency of node.dependencies) {
        const referenced = nodeIndex.get(dependency)
        if (!referenced || !allowed.has(referenced.scope)) throw new PipelineProtocolError(`Unknown or out-of-scope dependency ${dependency}`, "InvalidReference")
      }
      if (node._tag === "call") {
        validateExpression(node.payload, node.scope)
        if (node.target !== undefined) validateExpression(node.target, node.scope)
        else {
          const rpc = group.requests.get(node.method) as Rpc.AnyWithProps | undefined
          if (!rpc) throw new PipelineProtocolError(`Unknown RPC ${node.method}`, "UnknownMethod")
          if (RpcSchema.isStreamSchema(rpc.successSchema)) throw new PipelineProtocolError("Streaming RPCs are not supported in pipelines", "UnsupportedRpc")
        }
      } else {
        validateExpression(node.source, node.scope)
        validateExpression(node.template, node.id)
      }
    }
    validateExpression(request.selection, undefined)
    for (const id of request.discards) {
      if (!nodeIndex.has(id) || nodeIndex.get(id)!.scope !== undefined) throw new PipelineProtocolError(`Invalid discarded ref ${id}`, "InvalidReference")
    }
    // Resolve lexical dependencies once, rather than scanning descendants in
    // every scheduling wave and every mapped template invocation.
    const required = new Map(request.nodes.map((node) => [node.id, requiredFor(node, nodeIndex)]))
    const regions = new Map<string | undefined, Array<PipelineNode>>()
    for (const node of request.nodes) {
      const region = regions.get(node.scope)
      if (region === undefined) regions.set(node.scope, [node])
      else region.push(node)
    }
    // Validate every lexical region before invoking any handler.
    for (const scope of new Set([undefined, ...request.nodes.filter((node) => node._tag === "map").map((node) => node.id)])) {
      const remaining = [...(regions.get(scope) ?? [])]
      const resolved = new Set<string>()
      while (remaining.length > 0) {
        const ready = remaining.filter((node) => required.get(node.id)!.every((id) => nodeIndex.get(id)?.scope !== scope || resolved.has(id)))
        if (ready.length === 0) throw new PipelineProtocolError("Pipeline contains a cycle or unresolved dependency", "InvalidReference")
        for (const node of ready) {
          remaining.splice(remaining.indexOf(node), 1)
          resolved.add(node.id)
        }
      }
    }
    const executable = regions.get(undefined) ?? []

    return {
      definition,
      request,
      required,
      regions,
      executable,
      rpcTags: [...new Set(request.nodes.filter((node): node is Extract<PipelineNode, { readonly _tag: "call" }> => node._tag === "call").map((node) => node.method))],
      limits
    }
  },
  catch: (error) => error instanceof PipelineProtocolError
    ? error
    : new PipelineProtocolError(String(error))
})

const executeNode = <R extends Rpc.Any>(
  plan: ExecutionPlan<R>,
  node: PipelineNode,
  values: Map<string, unknown>,
  context: Context.Context<any>,
  metadata: RequestMetadata,
  middleware: ReadonlyArray<Middleware<any, any>>,
  executionContext: ExecutionContext<R>,
  invocationSequence: { value: number; readonly permits: Semaphore.Semaphore; readonly work: ExecutionWork },
  items: ReadonlyMap<string, unknown> = new Map()
): Effect.Effect<void, unknown, any> => invocationSequence.work.step.pipe(Effect.flatMap(() => {
  const { definition, limits } = plan
  const work = invocationSequence.work
  const required = plan.required.get(node.id)!
  for (const dependency of required) if (!values.has(dependency)) return Effect.fail(new PipelineProtocolError(`Unresolved dependency ${dependency}`, "InvalidReference"))
  if (node._tag === "map") {
    return Effect.try({ try: () => evalExpr(node.source, values, items, work), catch: (error) => error }).pipe(
      Effect.flatMap((source) => {
        const run = (item: unknown) => Effect.gen(function*() {
          yield* work.step
          const itemValues = new Map(values)
          const itemBindings = new Map(items).set(node.id, item)
          yield* executeRegion(
            plan.regions.get(node.id) ?? [],
            itemValues,
            (child) => executeNode(plan, child, itemValues, context, metadata, middleware, executionContext, invocationSequence, itemBindings),
            plan.required,
            limits.concurrency
          )
          return yield* Effect.try({ try: () => evalExpr(node.template, itemValues, itemBindings, work), catch: (error) => error })
        })
        if (Array.isArray(source)) {
          if (source.length > limits.maxMapItems) return Effect.fail(new PipelineProtocolError("Pipeline map item limit exceeded", "LimitExceeded"))
          return Effect.forEach(source, run, { concurrency: limits.concurrency }).pipe(Effect.map((result) => { values.set(node.id, result); return undefined }))
        }
        if (Option.isOption(source)) return Option.isNone(source) ? Effect.succeed(values.set(node.id, source) as unknown as void) : run(source.value).pipe(Effect.map((result) => { values.set(node.id, Option.some(result)); return undefined }))
        return Effect.fail(new PipelineProtocolError("Pipeline.map only supports arrays and Option", "InvalidMapInput"))
      })
    )
  }
  return Effect.try({ try: () => ({
    rawPayload: evalExpr(node.payload, values, items, work),
    rawTarget: node.target ? evalExpr(node.target, values, items, work) : undefined
  }), catch: (error) => error }).pipe(
    Effect.flatMap(({ rawPayload, rawTarget }) => {
      const duplex = Context.getOrUndefined(context, Duplex.Server)
      const resolvedPayload = duplex === undefined ? rawPayload : Duplex.resolveServerValue(duplex, metadata.client.id, rawPayload)
      const payload = resolvedPayload
      const target = duplex === undefined ? rawTarget : Duplex.resolveServerValue(duplex, metadata.client.id, rawTarget)
      if (target !== undefined && !isInstance(target)) return Effect.fail(new PipelineProtocolError("Call target is not a capability", "InvalidTarget"))
      if (target !== undefined) {
        const instance = target as CapabilityInstance
        const rpc = instance.group.requests.get(node.method) as Rpc.AnyWithProps | undefined
        if (!rpc) return Effect.fail(new PipelineProtocolError(`Unknown capability method ${node.method}`, "UnknownMethod"))
        const capabilityContext = Context.merge(context, instance.context)
        const invocation = Effect.gen(function*() {
          const decodedPayload = yield* decodePayload(rpc, payload)
          const access = yield* instance.group.accessHandler(node.method)
          const nodeMetadata = { ...metadata, requestId: `${String(metadata.requestId)}/${node.id}`, rpc, payload: decodedPayload } as any
          const invoked = (access as any)(decodedPayload, nodeMetadata)
          const base = Rpc.isWrapper(invoked) ? invoked.value : invoked
          if (!Effect.isEffect(base)) return yield* Effect.fail(new PipelineProtocolError("Streaming capability RPCs are not supported in pipelines", "UnsupportedRpc"))
          let program = base as Effect.Effect<unknown, unknown, any>
          for (const service of rpc.middlewares) {
            const rpcMiddleware = Context.getUnsafe(capabilityContext, service) as any
            program = rpcMiddleware(program, nodeMetadata)
          }
          const result = yield* program
          values.set(node.id, result)
        })
        if (invocationSequence.value >= limits.maxInvocations) return Effect.fail(new PipelineProtocolError("Pipeline invocation limit exceeded", "LimitExceeded"))
        return applyMiddleware(middleware, "invocation", invocation, {
          ...executionContext,
          nodeId: node.id,
          invocation: invocationSequence.value++,
          kind: "capability",
          rpc
        }).pipe(Effect.provideContext(capabilityContext), invocationSequence.permits.withPermit)
      }
      const rpc = definition.root.requests.get(node.method) as Rpc.AnyWithProps | undefined
      if (!rpc) return Effect.fail(new PipelineProtocolError(`Unknown RPC ${node.method}`, "UnknownMethod"))
      const invocation = Effect.gen(function*() {
        const decodedPayload = yield* decodePayload(rpc, payload)
        const access = yield* definition.root.accessHandler(node.method)
        const nodeMetadata = { ...metadata, requestId: `${String(metadata.requestId)}/${node.id}`, rpc, payload: decodedPayload } as any
        const invoked = (access as any)(decodedPayload, nodeMetadata)
        const base = Rpc.isWrapper(invoked) ? invoked.value : invoked
        if (!Effect.isEffect(base)) return yield* Effect.fail(new PipelineProtocolError("Streaming RPCs are not supported in pipelines", "UnsupportedRpc"))
        let program = base as Effect.Effect<unknown, unknown, any>
        for (const service of rpc.middlewares) {
          const rpcMiddleware = Context.getUnsafe(context, service) as any
          program = rpcMiddleware(program, nodeMetadata)
        }
        const result = yield* program
        values.set(node.id, result)
      })
      if (invocationSequence.value >= limits.maxInvocations) return Effect.fail(new PipelineProtocolError("Pipeline invocation limit exceeded", "LimitExceeded"))
      return applyMiddleware(middleware, "invocation", invocation, {
        ...executionContext,
        nodeId: node.id,
        invocation: invocationSequence.value++,
        kind: "root",
        rpc
      }).pipe(Effect.provideContext(context), invocationSequence.permits.withPermit)
    })
  )
}))

const executePipeline = <R extends Rpc.Any>(
  plan: ExecutionPlan<R>,
  context: Context.Context<any>,
  metadata: RequestMetadata,
  middleware: ReadonlyArray<Middleware<any, any>>,
  executionContext: ExecutionContext<R>
): Effect.Effect<unknown, unknown, never> => {
  const values = new Map<string, unknown>()
  const work = makeExecutionWork(plan.limits.maxExecutionSteps)
  const invocationSequence = { value: 0, permits: Semaphore.makeUnsafe(plan.limits.concurrency), work }
  return executeRegion(
    plan.executable,
    values,
    (node) => executeNode(plan, node, values, context, metadata, middleware, executionContext, invocationSequence),
    plan.required,
    plan.limits.concurrency
  ).pipe(
    Effect.flatMap(() => Effect.try({
      try: () => evalExpr(plan.request.selection, values, new Map(), work),
      catch: (error) => error
    }))
  ) as Effect.Effect<unknown, unknown, never>
}

const containsCapability = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (isInstance(value) || isRef(value)) return true
  if (value === null || typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Option.isOption(value)) return Option.isSome(value) && containsCapability(value.value, seen)
  if (Array.isArray(value)) return value.some((item) => containsCapability(item, seen))
  return Object.values(value).some((item) => containsCapability(item, seen))
}

const handleWithContext = <R extends Rpc.Any, M extends ReadonlyArray<Middleware<any, any>>>(
  group: RpcGroup.RpcGroup<R>,
  request: PipelineRequest,
  context: Context.Context<Requirements<R> | MiddlewaresRequirements<M>>,
  metadata: RequestMetadata,
  options?: ServerOptions<M>
): Effect.Effect<PipelineResponse, never, never> => Effect.suspend(() => {
  try {
    request = decodeRequest(request, executionLimits(options))
  } catch (error) {
    const failure = error instanceof PipelineProtocolError ? error : new PipelineProtocolError("Malformed pipeline request")
    return Effect.succeed({ _tag: "Failure" as const, error: encodeTransportValue(failure) })
  }
  const scopedContext = Context.add(context, RequestScope, makeScope())
  const middleware = options?.middleware ?? []
  const requestContext: RequestContext<R> = { definitionId: options?.id ?? "default", group, request, metadata }
  const program = Effect.flatMap(
    compilePipeline(group, request, options),
    (plan) => {
      const executionContext: ExecutionContext<R> = { ...requestContext, rpcTags: plan.rpcTags }
      return applyMiddleware(
        middleware,
        "execution",
        executePipeline(plan, scopedContext, metadata, middleware, executionContext),
        executionContext
      )
    }
  ).pipe(Effect.flatMap((value): Effect.Effect<PipelineResponse, PipelineProtocolError> => Effect.try({
    try: () => {
      const duplex = Context.getOrUndefined(scopedContext, Duplex.Server)
      if (duplex === undefined && containsCapability(value)) {
        throw new PipelineProtocolError("Capabilities require the WebSocket duplex transport", "UnsupportedRpc")
      }
      return {
        _tag: "Success" as const,
        value: encodeTransportValue(duplex === undefined ? value : Duplex.encodeServerValue(duplex, metadata.client.id, value))
      }
    },
    catch: (error) => error instanceof PipelineProtocolError ? error : new PipelineProtocolError("Pipeline result could not be serialized", "UnsupportedValue")
  })))
  return applyMiddleware(middleware, "request", program, requestContext).pipe(
    Effect.provideContext(scopedContext),
    Effect.catch((error): Effect.Effect<PipelineResponse> => Effect.sync(() => {
      try {
        return { _tag: "Failure", error: encodeTransportValue(error) }
      } catch {
        return { _tag: "Failure", error: encodeTransportValue(new PipelineExecutionError({ message: "Pipeline failure could not be serialized", code: "InvalidFailure", retryable: false })) }
      }
    }))
  ) as Effect.Effect<PipelineResponse, never, never>
})

/** Executes a pipeline using normal Effect RPC handlers and middleware from the environment. */
export const handle = <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(
  group: RpcGroup.RpcGroup<R>,
  request: PipelineRequest,
  options?: ServerOptions<M> & { readonly metadata?: RequestMetadata }
): Effect.Effect<PipelineResponse, never, Requirements<R> | MiddlewaresRequirements<M>> => Effect.context<Requirements<R> | MiddlewaresRequirements<M>>().pipe(Effect.flatMap((context) =>
  handleWithContext(group, request, context, options?.metadata ?? {
    client: new Rpc.ServerClient(0),
    requestId: "pipeline",
    headers: {} as Headers.Headers
  }, options)
))

export const augment = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>): RpcGroup.RpcGroup<R | typeof PipelineRpc> => {
  for (const tag of group.requests.keys()) {
    if (tag === "then" || tag.startsWith("__effect_rpc_pipeline_")) throw new Error(`RPC tag "${tag}" is reserved`)
  }
  return group.add(PipelineRpc)
}

export const augmentDuplex = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>) => augment(group)
  .add(Duplex.SessionRpc)
  .add(Duplex.ReplyRpc)
  .add(Duplex.CallServerCapabilityRpc)
  .add(Duplex.ReleaseCapabilityRpc)

const makePipelineHandlerContext = <R extends Rpc.Any, M extends ReadonlyArray<Middleware<any, any>>>(
  group: RpcGroup.RpcGroup<R>,
  context: Context.Context<Requirements<R> | MiddlewaresRequirements<M>>,
  options?: ServerOptions<M>
): Context.Context<Rpc.ToHandler<typeof PipelineRpc>> => {
  const handler = (request: PipelineRequest, metadata: RequestMetadata) => handleWithContext(group, request, context, metadata, options)
  return Context.makeUnsafe(new Map([[PipelineRpc.key, { tag: PipelineRpc._tag, handler, context }]])) as Context.Context<Rpc.ToHandler<typeof PipelineRpc>>
}

export const layer = <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(group: RpcGroup.RpcGroup<R>, options?: ServerOptions<M>): Layer.Layer<Rpc.ToHandler<typeof PipelineRpc>, never, Requirements<R> | MiddlewaresRequirements<M>> =>
  Layer.effectContext(Effect.map(
    Effect.context<Requirements<R> | MiddlewaresRequirements<M>>(),
    (context) => makePipelineHandlerContext(group, context, options)
  ))

export const layerHttp = <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(options: {
  readonly group: RpcGroup.RpcGroup<R>
  readonly path: string
} & ServerOptions<M>): Layer.Layer<
  never,
  never,
  RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>
> => {
  const AllHandlers = Layer.effectContext(Effect.map(
    Effect.context<Requirements<R> | MiddlewaresRequirements<M>>(),
    (context) => Context.merge(context, makePipelineHandlerContext(options.group, context, options))
  ))
  return RpcServer.layerHttp({
    group: augment(options.group),
    path: options.path as any,
    protocol: "http"
  }).pipe(Layer.provide(AllHandlers)) as Layer.Layer<
    never,
    never,
    RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>
  >
}

/** Serves pipelines, standard streaming RPCs, and bidirectional capabilities over Effect's WebSocket transport. */
export const layerWebSocket = <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(options: {
  readonly group: RpcGroup.RpcGroup<R>
  readonly path: string
} & ServerOptions<M>): Layer.Layer<
  never,
  never,
  RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>
> => Layer.unwrap(Effect.map(Duplex.makeServer, (duplex) => {
  const AllHandlers = Layer.effectContext(Effect.gen(function*() {
    const root = yield* Effect.context<Requirements<R> | MiddlewaresRequirements<M>>()
    const context = Context.add(root, Duplex.Server, duplex)
    const pipeline = makePipelineHandlerContext(options.group, context, options)
    const duplexHandlers = yield* Duplex.Rpcs.toHandlers(Duplex.handlers(duplex))
    return Context.merge(context, Context.merge(pipeline, duplexHandlers))
  }))
  return RpcServer.layerHttp({
    group: augmentDuplex(options.group),
    path: options.path as any,
    protocol: "websocket"
  }).pipe(
    Layer.provide(AllHandlers)
  )
})) as Layer.Layer<never, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>>

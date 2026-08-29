import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import type * as Headers from "effect/unstable/http/Headers"
import type * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as Schema from "effect/Schema"
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

type MiddlewareRequirements<M> = M extends Middleware<any, infer R> ? R : never
type MiddlewaresRequirements<M extends ReadonlyArray<Middleware<any, any>>> = MiddlewareRequirements<M[number]>

export interface ServerOptions<M extends ReadonlyArray<Middleware<any, any>> = readonly []> {
  readonly id?: string
  readonly middleware?: M
  readonly limits?: {
    readonly maxNodes?: number
    readonly maxMapItems?: number
    readonly maxInvocations?: number
    readonly concurrency?: number
  }
}

interface ExecutionLimits {
  readonly maxNodes: number
  readonly maxMapItems: number
  readonly maxInvocations: number
  readonly concurrency: number
}

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value < 1 ? fallback : Math.floor(value)

const executionLimits = (options?: ServerOptions<any>): ExecutionLimits => ({
  maxNodes: positiveLimit(options?.limits?.maxNodes, 1000),
  maxMapItems: positiveLimit(options?.limits?.maxMapItems, 1000),
  maxInvocations: positiveLimit(options?.limits?.maxInvocations, 10_000),
  concurrency: positiveLimit(options?.limits?.concurrency, 64)
})

const PathSchema = Schema.Array(Schema.Union([Schema.String, Schema.Number]))
export const ExprSchema: Schema.Schema<Expr> = Schema.suspend(() => Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("literal"), value: Schema.optionalKey(Schema.Json) }),
  Schema.Struct({ _tag: Schema.Literal("ref"), id: Schema.String, path: PathSchema }),
  Schema.Struct({ _tag: Schema.Literal("item"), path: PathSchema }),
  Schema.Struct({ _tag: Schema.Literal("array"), values: Schema.Array(ExprSchema) }),
  Schema.Struct({ _tag: Schema.Literal("object"), entries: Schema.Array(Schema.Tuple([Schema.String, ExprSchema])) }),
  Schema.Struct({ _tag: Schema.Literal("none") }),
  Schema.Struct({ _tag: Schema.Literal("some"), value: ExprSchema })
])) as Schema.Schema<Expr>
export const PipelineNodeSchema: Schema.Schema<PipelineNode> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("call"),
    id: Schema.String,
    target: Schema.optionalKey(ExprSchema),
    method: Schema.String,
    payload: ExprSchema,
    dependencies: Schema.Array(Schema.String)
  }),
  Schema.Struct({
    _tag: Schema.Literal("map"),
    id: Schema.String,
    source: ExprSchema,
    template: ExprSchema,
    dependencies: Schema.Array(Schema.String)
  })
]) as Schema.Schema<PipelineNode>
export const PipelineRequestSchema: Schema.Schema<PipelineRequest> = Schema.Struct({
  version: Schema.Literal(1),
  definitionId: Schema.String,
  nodes: Schema.Array(PipelineNodeSchema),
  selection: ExprSchema,
  discards: Schema.Array(Schema.String)
}) as Schema.Schema<PipelineRequest>

export const PipelineRpc = Rpc.make("__effect_rpc_pipeline_v1", {
  payload: PipelineRequestSchema,
  success: Schema.Unknown,
  error: Schema.Unknown
})

const pathValue = (value: unknown, path: ReadonlyArray<string | number>): unknown => {
  let current = value
  for (const part of path) {
    if (current === null || current === undefined) throw new PipelineProtocolError(`Cannot read ${String(part)} from nullish value`, "InvalidPath")
    current = (current as any)[part]
  }
  return current
}

const evalExpr = (expr: Expr, values: Map<string, unknown>, item?: unknown): unknown => {
  switch (expr._tag) {
    case "literal": return expr.value
    case "ref": {
      if (expr.id === "__item__") return pathValue(item, expr.path)
      if (expr.id === "__root__") throw new PipelineProtocolError("Root API cannot be used as a value", "InvalidReference")
      if (!values.has(expr.id)) throw new PipelineProtocolError(`Unknown or unresolved ref ${expr.id}`, "InvalidReference")
      return pathValue(values.get(expr.id), expr.path)
    }
    case "item": return pathValue(item, expr.path)
    case "array": return expr.values.map((value) => evalExpr(value, values, item))
    case "object": return Object.fromEntries(expr.entries.map(([key, value]) => [key, evalExpr(value, values, item)]))
    case "none": return Option.none()
    case "some": return Option.some(evalExpr(expr.value, values, item))
  }
}

// Pipeline expressions preserve Effect values so they can be selected and mapped.
// RPC payload schemas, however, decode from their encoded wire representation.
const encodePayloadOptions = (value: unknown): unknown => {
  if (Option.isOption(value)) return Option.isNone(value) ? null : encodePayloadOptions(value.value)
  if (Array.isArray(value)) return value.map(encodePayloadOptions)
  if (value !== null && typeof value === "object" && !isInstance(value) && !isRef(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodePayloadOptions(item)]))
  }
  return value
}

const encodeTransportValue = (value: unknown, ancestors = new WeakSet<object>()): unknown => {
  if (Option.isOption(value)) return Option.isNone(value)
    ? { _id: "Option", _tag: "None" }
    : { _id: "Option", _tag: "Some", value: encodeTransportValue(value.value, ancestors) }
  if (typeof value === "number" && !Number.isFinite(value)) return null
  if (typeof value === "bigint" || typeof value === "symbol") return String(value)
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[Circular]"
    ancestors.add(value)
    const encoded = value.map((item) => encodeTransportValue(item, ancestors))
    ancestors.delete(value)
    return encoded
  }
  if (value !== null && typeof value === "object") {
    if (ancestors.has(value)) return "[Circular]"
    ancestors.add(value)
    const encoded = Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
      item === undefined || typeof item === "function" ? [] : [[key, encodeTransportValue(item, ancestors)]]
    ))
    ancestors.delete(value)
    return encoded
  }
  return value
}

const dependencies = (node: PipelineNode): ReadonlyArray<string> => node.dependencies

const containsItem = (expr: Expr): boolean => {
  switch (expr._tag) {
    case "item": return true
    case "array": return expr.values.some(containsItem)
    case "object": return expr.entries.some(([, value]) => containsItem(value))
    default: return false
  }
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
  readonly nodeIndex: ReadonlyMap<string, PipelineNode>
  readonly executable: ReadonlyArray<PipelineNode>
  readonly rpcTags: ReadonlyArray<string>
  readonly limits: ExecutionLimits
}

const expressionsFor = (node: PipelineNode): ReadonlyArray<Expr> => node._tag === "map"
  ? [node.source, node.template]
  : node.target === undefined ? [node.payload] : [node.payload, node.target]

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

    for (const node of request.nodes) {
      for (const expression of expressionsFor(node)) {
        for (const ref of refsIn(expression)) {
          if (!nodeIndex.has(ref)) throw new PipelineProtocolError(`Unknown ref ${ref}`, "InvalidReference")
        }
      }
      for (const dependency of dependencies(node)) {
        if (!nodeIndex.has(dependency)) throw new PipelineProtocolError(`Unknown dependency ${dependency}`, "InvalidReference")
      }
    }
    for (const ref of refsIn(request.selection)) {
      if (!nodeIndex.has(ref)) throw new PipelineProtocolError(`Unknown selection ref ${ref}`, "InvalidReference")
    }

    const executable = request.nodes.filter((node) => !(
      node._tag === "call" && (containsItem(node.payload) || (node.target ? containsItem(node.target) : false))
    ))
    const remaining = [...executable]
    const resolved = new Set<string>()
    while (remaining.length > 0) {
      const ready = remaining.filter((node) => {
        const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
        return required.every((id) => resolved.has(id))
      })
      if (ready.length === 0) throw new PipelineProtocolError("Pipeline contains a cycle or unresolved dependency", "InvalidReference")
      for (const node of ready) {
        remaining.splice(remaining.indexOf(node), 1)
        resolved.add(node.id)
      }
    }

    return {
      definition,
      request,
      nodeIndex,
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
  definition: ServerDefinition<R>,
  node: PipelineNode,
  values: Map<string, unknown>,
  context: Context.Context<any>,
  metadata: RequestMetadata,
  middleware: ReadonlyArray<Middleware<any, any>>,
  executionContext: ExecutionContext<R>,
  invocationSequence: { value: number },
  limits: ExecutionLimits,
  item?: unknown,
  nodeIndex: ReadonlyMap<string, PipelineNode> = new Map()
): Effect.Effect<void, unknown, any> => {
  const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
  for (const dependency of required) if (!values.has(dependency)) return Effect.fail(new PipelineProtocolError(`Unresolved dependency ${dependency}`, "InvalidReference"))
  if (node._tag === "map") {
    return Effect.try({ try: () => evalExpr(node.source, values), catch: (error) => error }).pipe(
      Effect.flatMap((source) => {
        const run = (item: unknown) => Effect.gen(function*() {
          const itemValues = new Map(values)
          for (const ref of refsIn(node.template)) {
            const child = nodeIndex.get(ref)
            if (child && (!itemValues.has(ref) || (child._tag === "call" && (containsItem(child.payload) || (child.target ? containsItem(child.target) : false))))) {
              yield* executeNode(definition, child, itemValues, context, metadata, middleware, executionContext, invocationSequence, limits, item, nodeIndex)
            }
          }
          return yield* Effect.try({ try: () => evalExpr(node.template, itemValues, item), catch: (error) => error })
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
  return Effect.try({ try: () => evalExpr(node.payload, values, item), catch: (error) => error }).pipe(
    Effect.flatMap((rawPayload) => {
      const duplex = Context.getOrUndefined(context, Duplex.Server)
      const resolvedPayload = duplex === undefined ? rawPayload : Duplex.resolveServerValue(duplex, metadata.client.id, rawPayload)
      const payload = encodePayloadOptions(resolvedPayload)
      const rawTarget = node.target ? evalExpr(node.target, values, item) : undefined
      const target = duplex === undefined ? rawTarget : Duplex.resolveServerValue(duplex, metadata.client.id, rawTarget)
      if (target !== undefined && !isInstance(target)) return Effect.fail(new PipelineProtocolError("Call target is not a capability", "InvalidTarget"))
      if (target !== undefined) {
        const instance = target as CapabilityInstance
        const rpc = instance.group.requests.get(node.method) as Rpc.AnyWithProps | undefined
        if (!rpc) return Effect.fail(new PipelineProtocolError(`Unknown capability method ${node.method}`, "UnknownMethod"))
        const capabilityContext = Context.merge(context, instance.context)
        const invocation = Effect.gen(function*() {
          const decodedPayload = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(payload)
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
        }).pipe(Effect.provideContext(capabilityContext))
      }
      const rpc = definition.root.requests.get(node.method) as Rpc.AnyWithProps | undefined
      if (!rpc) return Effect.fail(new PipelineProtocolError(`Unknown RPC ${node.method}`, "UnknownMethod"))
      const invocation = Effect.gen(function*() {
        const decodedPayload = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(payload)
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
      }).pipe(Effect.provideContext(context))
    })
  )
}

const executePipeline = <R extends Rpc.Any>(
  plan: ExecutionPlan<R>,
  context: Context.Context<any>,
  metadata: RequestMetadata,
  middleware: ReadonlyArray<Middleware<any, any>>,
  executionContext: ExecutionContext<R>
): Effect.Effect<unknown, unknown, never> => {
  const values = new Map<string, unknown>()
  const pending = [...plan.executable]
  const invocationSequence = { value: 0 }
  const executeReady = (): Effect.Effect<void, unknown, any> => {
    if (pending.length === 0) return Effect.void
    const ready = pending.filter((node) => {
      const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
      return required.every((id) => values.has(id))
    })
    if (ready.length === 0) return Effect.fail(new PipelineProtocolError("Pipeline contains a cycle or unresolved dependency", "InvalidReference"))
    for (const node of ready) pending.splice(pending.indexOf(node), 1)
    return Effect.forEach(ready, (node) => executeNode(
      plan.definition,
      node,
      values,
      context,
      metadata,
      middleware,
      executionContext,
      invocationSequence,
      plan.limits,
      undefined,
      plan.nodeIndex
    ), {
      concurrency: plan.limits.concurrency
    }).pipe(Effect.flatMap(executeReady), Effect.asVoid)
  }
  return executeReady().pipe(
    Effect.flatMap(() => Effect.try({
      try: () => evalExpr(plan.request.selection, values),
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
): Effect.Effect<PipelineResponse, never, never> => {
  const scopedContext = Context.add(context, RequestScope, makeScope())
  const middleware = options?.middleware ?? []
  const requestContext: RequestContext<R> = { group, request, metadata }
  const wrapped = applyMiddleware(
    middleware,
    "request",
    Effect.flatMap(
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
    ),
    requestContext
  )
  return wrapped.pipe(
    Effect.provideContext(scopedContext),
    Effect.flatMap((value): Effect.Effect<PipelineResponse, PipelineProtocolError> => {
      const duplex = Context.getOrUndefined(scopedContext, Duplex.Server)
      if (duplex === undefined && containsCapability(value)) {
        return Effect.fail(new PipelineProtocolError("Capabilities require the WebSocket duplex transport", "UnsupportedRpc"))
      }
      return Effect.succeed({
        _tag: "Success",
        value: encodeTransportValue(duplex === undefined ? value : Duplex.encodeServerValue(duplex, metadata.client.id, value))
      })
    }),
    Effect.catch((error): Effect.Effect<PipelineResponse> => Effect.succeed({ _tag: "Failure", error: encodeTransportValue(error) }))
  ) as Effect.Effect<PipelineResponse, never, never>
}

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

export const augment = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>): RpcGroup.RpcGroup<R | typeof PipelineRpc> => group.add(PipelineRpc)

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

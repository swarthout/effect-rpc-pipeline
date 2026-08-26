import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import type * as Headers from "effect/unstable/http/Headers"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import type { CapabilityInstance } from "./Capability.js"
import { isInstance } from "./Capability.js"
import { PipelineProtocolError, type Expr, type PipelineNode, type PipelineRequest } from "./Pipeline.js"
import type { PipelineResponse } from "./PipelineClient.js"

export { PipelineProtocolError }

type ServerDefinition<R extends Rpc.Any> = { readonly id: string; readonly root: RpcGroup.RpcGroup<R> }
type RequestMetadata = {
  readonly client: Rpc.ServerClient
  readonly requestId: unknown
  readonly headers: Headers.Headers
}
export type Requirements<R extends Rpc.Any> = Rpc.ToHandler<R> | Rpc.Middleware<R> | Rpc.ServicesServer<R>

const PathSchema = Schema.Array(Schema.Union([Schema.String, Schema.Number]))
export const ExprSchema: Schema.Schema<Expr> = Schema.suspend(() => Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("literal"), value: Schema.optionalKey(Schema.Unknown) }),
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

const executeNode = <R extends Rpc.Any>(definition: ServerDefinition<R>, node: PipelineNode, values: Map<string, unknown>, context: Context.Context<Requirements<R>>, metadata: RequestMetadata, item?: unknown, nodeIndex = new Map<string, PipelineNode>()): Effect.Effect<void, unknown, any> => {
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
              yield* executeNode(definition, child, itemValues, context, metadata, item, nodeIndex)
            }
          }
          return yield* Effect.try({ try: () => evalExpr(node.template, itemValues, item), catch: (error) => error })
        })
        if (Array.isArray(source)) return Effect.forEach(source, run, { concurrency: "unbounded" }).pipe(Effect.map((result) => { values.set(node.id, result); return undefined }))
        if (Option.isOption(source)) return Option.isNone(source) ? Effect.succeed(values.set(node.id, source) as unknown as void) : run(source.value).pipe(Effect.map((result) => { values.set(node.id, Option.some(result)); return undefined }))
        return Effect.fail(new PipelineProtocolError("Pipeline.map only supports arrays and Option", "InvalidMapInput"))
      })
    )
  }
  return Effect.try({ try: () => evalExpr(node.payload, values, item), catch: (error) => error }).pipe(
    Effect.flatMap((payload) => {
      const target = node.target ? evalExpr(node.target, values, item) : undefined
      if (target !== undefined && !isInstance(target)) return Effect.fail(new PipelineProtocolError("Call target is not a capability", "InvalidTarget"))
      if (target !== undefined) {
        const instance = target as CapabilityInstance
        const rpc = instance.group.requests.get(node.method) as Rpc.AnyWithProps | undefined
        if (!rpc) return Effect.fail(new PipelineProtocolError(`Unknown capability method ${node.method}`, "UnknownMethod"))
        const capabilityContext = Context.merge(context, instance.context)
        return Effect.gen(function*() {
          const decodedPayload = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(payload)
          const access = yield* instance.group.accessHandler(node.method)
          const nodeMetadata = { ...metadata, requestId: `${String(metadata.requestId)}/${node.id}`, rpc, payload: decodedPayload } as any
          const invoked = (access as any)(decodedPayload, nodeMetadata)
          const base = Rpc.isWrapper(invoked) ? invoked.value : invoked
          if (!Effect.isEffect(base)) return yield* Effect.fail(new PipelineProtocolError("Streaming capability RPCs are not supported in pipelines", "UnsupportedRpc"))
          let program = base as Effect.Effect<unknown, unknown, any>
          for (const service of rpc.middlewares) {
            const middleware = Context.getUnsafe(capabilityContext, service) as any
            program = middleware(program, nodeMetadata)
          }
          const result = yield* program
          values.set(node.id, result)
        }).pipe(Effect.provideContext(capabilityContext))
      }
      return Effect.gen(function*() {
        const rpc = definition.root.requests.get(node.method) as Rpc.AnyWithProps | undefined
        if (!rpc) return yield* Effect.fail(new PipelineProtocolError(`Unknown RPC ${node.method}`, "UnknownMethod"))
        const decodedPayload = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(payload)
        const access = yield* definition.root.accessHandler(node.method)
        const nodeMetadata = { ...metadata, requestId: `${String(metadata.requestId)}/${node.id}`, rpc, payload: decodedPayload } as any
        const invoked = (access as any)(decodedPayload, nodeMetadata)
        const base = Rpc.isWrapper(invoked) ? invoked.value : invoked
        if (!Effect.isEffect(base)) return yield* Effect.fail(new PipelineProtocolError("Streaming RPCs are not supported in pipelines", "UnsupportedRpc"))
        let program = base as Effect.Effect<unknown, unknown, any>
        for (const service of rpc.middlewares) {
          const middleware = Context.getUnsafe(context, service) as any
          program = middleware(program, nodeMetadata)
        }
        const result = yield* program
        values.set(node.id, result)
      }).pipe(Effect.provideContext(context))
    })
  )
}

const handleWithContext = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>, request: PipelineRequest, context: Context.Context<Requirements<R>>, metadata: RequestMetadata, options?: { readonly id?: string }): Effect.Effect<PipelineResponse, never, never> => {
  const definition: ServerDefinition<R> = { id: options?.id ?? "default", root: group }
  const failure = (error: unknown): Effect.Effect<PipelineResponse> => Effect.succeed({ _tag: "Failure", error })
  if (request.version !== 1 || request.definitionId !== definition.id) return failure(new PipelineProtocolError("Unsupported pipeline definition or version"))
  if (request.nodes.length > 1000) return failure(new PipelineProtocolError("Pipeline node limit exceeded", "LimitExceeded"))
  const values = new Map<string, unknown>()
  const nodeIndex = new Map(request.nodes.map((node) => [node.id, node]))
  if (nodeIndex.size !== request.nodes.length) return failure(new PipelineProtocolError("Duplicate pipeline node id", "InvalidPipeline"))
  const pending = request.nodes.filter((node) => !(
    node._tag === "call" && (containsItem(node.payload) || (node.target ? containsItem(node.target) : false))
  ))
  const executeReady = (): Effect.Effect<void, unknown, any> => {
    if (pending.length === 0) return Effect.void
    const ready = pending.filter((node) => {
      const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
      return required.every((id) => values.has(id))
    })
    if (ready.length === 0) return Effect.fail(new PipelineProtocolError("Pipeline contains a cycle or unresolved dependency", "InvalidReference"))
    for (const node of ready) pending.splice(pending.indexOf(node), 1)
    return Effect.forEach(ready, (node) => executeNode(definition, node, values, context, metadata, undefined, nodeIndex), {
      concurrency: "unbounded"
    }).pipe(Effect.flatMap(executeReady), Effect.asVoid)
  }
  return executeReady().pipe(
    Effect.flatMap(() => Effect.try({
      try: (): PipelineResponse => ({ _tag: "Success", value: evalExpr(request.selection, values) }),
      catch: (error) => error
    })),
    Effect.catch((error): Effect.Effect<PipelineResponse> => Effect.succeed({ _tag: "Failure", error }))
  ) as Effect.Effect<PipelineResponse, never, never>
}

/** Executes a pipeline using normal Effect RPC handlers and middleware from the environment. */
export const handle = <R extends Rpc.Any>(
  group: RpcGroup.RpcGroup<R>,
  request: PipelineRequest,
  options?: { readonly id?: string; readonly metadata?: RequestMetadata }
): Effect.Effect<PipelineResponse, never, Requirements<R>> => Effect.context<Requirements<R>>().pipe(Effect.flatMap((context) =>
  handleWithContext(group, request, context, options?.metadata ?? {
    client: new Rpc.ServerClient(0),
    requestId: "pipeline",
    headers: {} as Headers.Headers
  }, options?.id === undefined ? undefined : { id: options.id })
))

export const augment = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>): RpcGroup.RpcGroup<R | typeof PipelineRpc> => group.add(PipelineRpc)

export const layer = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>, options?: { readonly id?: string }): Layer.Layer<Rpc.ToHandler<typeof PipelineRpc>, never, Requirements<R>> =>
  Layer.effectContext(Effect.gen(function*() {
    const context = yield* Effect.context<Requirements<R>>()
    const handler = (request: PipelineRequest, metadata: RequestMetadata) => handleWithContext(group, request, context, metadata, options)
    return Context.makeUnsafe(new Map([[PipelineRpc.key, { tag: PipelineRpc._tag, handler, context }]]))
  }))

export const layerHttp = <R extends Rpc.Any>(options: {
  readonly group: RpcGroup.RpcGroup<R>
  readonly path: string
  readonly id?: string
  readonly protocol?: "http" | "websocket"
}) => {
  return RpcServer.layerHttp({
    group: augment(options.group),
    path: options.path as any,
    protocol: options.protocol ?? "http"
  }).pipe(Layer.provide(layer(options.group, options.id === undefined ? undefined : { id: options.id })))
}

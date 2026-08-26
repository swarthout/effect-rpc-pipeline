import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import type { CapabilityInstance } from "./Capability.js"
import { isInstance } from "./Capability.js"
import type { Expr, PipelineDefinition, PipelineNode, PipelineRequest } from "./Pipeline.js"
import { PipelineDefinitionTypeId } from "./Pipeline.js"
import type { PipelineResponse } from "./PipelineClient.js"

export class PipelineError extends Error {
  readonly _tag = "PipelineError"
  constructor(message: string, readonly code = "InvalidPipeline") { super(message) }
}

export const PipelineRpc = Rpc.make("__effect_rpc_pipeline_v1", {
  payload: Schema.Unknown,
  success: Schema.Unknown,
  error: Schema.Unknown
})

const pathValue = (value: unknown, path: ReadonlyArray<string | number>): unknown => {
  let current = value
  for (const part of path) {
    if (current === null || current === undefined) throw new PipelineError(`Cannot read ${String(part)} from nullish value`, "InvalidPath")
    current = (current as any)[part]
  }
  return current
}

const evalExpr = (expr: Expr, values: Map<string, unknown>, item?: unknown): unknown => {
  switch (expr._tag) {
    case "literal": return expr.value
    case "ref": {
      if (expr.id === "__item__") return pathValue(item, expr.path)
      if (expr.id === "__root__") throw new PipelineError("Root API cannot be used as a value", "InvalidReference")
      if (!values.has(expr.id)) throw new PipelineError(`Unknown or unresolved ref ${expr.id}`, "InvalidReference")
      return pathValue(values.get(expr.id), expr.path)
    }
    case "item": return item
    case "array": return expr.values.map((value) => evalExpr(value, values, item))
    case "object": return Object.fromEntries(expr.entries.map(([key, value]) => [key, evalExpr(value, values, item)]))
  }
}

const dependencies = (node: PipelineNode): ReadonlyArray<string> => node.dependencies

const containsItem = (expr: Expr): boolean => {
  switch (expr._tag) {
    case "ref": return expr.id === "__item__"
    case "array": return expr.values.some(containsItem)
    case "object": return expr.entries.some(([, value]) => containsItem(value))
    default: return false
  }
}

const refsIn = (expr: Expr, out = new Set<string>()): Set<string> => {
  if (expr._tag === "ref") { if (expr.id !== "__item__" && expr.id !== "__root__") out.add(expr.id); return out }
  if (expr._tag === "array") for (const value of expr.values) refsIn(value, out)
  if (expr._tag === "object") for (const [, value] of expr.entries) refsIn(value, out)
  return out
}

const executeNode = <R extends Rpc.Any>(definition: PipelineDefinition<R>, node: PipelineNode, values: Map<string, unknown>, context: Context.Context<any>, item?: unknown, nodeIndex = new Map<string, PipelineNode>()): Effect.Effect<void, unknown, any> => {
  const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
  for (const dependency of required) if (!values.has(dependency)) return Effect.fail(new PipelineError(`Unresolved dependency ${dependency}`, "InvalidReference"))
  if (node._tag === "map") {
    return Effect.try({ try: () => evalExpr(node.source, values), catch: (error) => error }).pipe(
      Effect.flatMap((source) => {
        const run = (item: unknown) => Effect.gen(function*() {
          const itemValues = new Map(values)
          for (const ref of refsIn(node.template)) {
            const child = nodeIndex.get(ref)
            if (child && (!itemValues.has(ref) || (child._tag === "call" && (containsItem(child.payload) || (child.target ? containsItem(child.target) : false))))) {
              yield* executeNode(definition, child, itemValues, context, item, nodeIndex)
            }
          }
          return yield* Effect.try({ try: () => evalExpr(node.template, itemValues, item), catch: (error) => error })
        })
        if (Array.isArray(source)) return Effect.forEach(source, run, { concurrency: "unbounded" }).pipe(Effect.map((result) => { values.set(node.id, result); return undefined }))
        if (Option.isOption(source)) return Option.isNone(source) ? Effect.succeed(values.set(node.id, source) as unknown as void) : run(source.value).pipe(Effect.map((result) => { values.set(node.id, Option.some(result)); return undefined }))
        return Effect.fail(new PipelineError("Pipeline.map only supports arrays and Option", "InvalidMapInput"))
      })
    )
  }
  return Effect.try({ try: () => evalExpr(node.payload, values, item), catch: (error) => error }).pipe(
    Effect.flatMap((payload) => {
      const target = node.target ? evalExpr(node.target, values, item) : undefined
      if (target !== undefined && !isInstance(target)) return Effect.fail(new PipelineError("Call target is not a capability", "InvalidTarget"))
      if (target !== undefined) {
        const instance = target as CapabilityInstance
        const handler = instance.handlers[node.method]
        if (!handler) return Effect.fail(new PipelineError(`Unknown capability method ${node.method}`, "UnknownMethod"))
        return Effect.suspend(() => handler(payload)).pipe(Effect.map((result) => { values.set(node.id, result); return undefined }))
      }
      return Effect.gen(function*() {
        const access = yield* definition.root.accessHandler(node.method)
        const result = yield* (access as any)(payload, { client: new Rpc.ServerClient(0), requestId: node.id, headers: {}, rpc: undefined } as any)
        values.set(node.id, result)
      }).pipe(Effect.provideContext(context))
    })
  )
}

export const handle = <R extends Rpc.Any>(definition: PipelineDefinition<R>, request: PipelineRequest, context: Context.Context<any> = Context.empty() as any): Effect.Effect<PipelineResponse, unknown, never> => {
  if (request.version !== 1 || request.definitionId !== definition.id) return Effect.fail(new PipelineError("Unsupported pipeline definition or version"))
  if (request.nodes.length > 1000) return Effect.fail(new PipelineError("Pipeline node limit exceeded", "LimitExceeded"))
  const values = new Map<string, unknown>()
  const nodeIndex = new Map(request.nodes.map((node) => [node.id, node]))
  if (nodeIndex.size !== request.nodes.length) return Effect.fail(new PipelineError("Duplicate pipeline node id", "InvalidPipeline"))
  const pending = request.nodes.filter((node) => !(
    node._tag === "call" && (containsItem(node.payload) || (node.target ? containsItem(node.target) : false))
  ))
  const executeReady = (): Effect.Effect<void, unknown, any> => {
    if (pending.length === 0) return Effect.void
    const ready = pending.filter((node) => {
      const required = node._tag === "map" ? [...refsIn(node.source)] : dependencies(node)
      return required.every((id) => values.has(id))
    })
    if (ready.length === 0) return Effect.fail(new PipelineError("Pipeline contains a cycle or unresolved dependency", "InvalidReference"))
    for (const node of ready) pending.splice(pending.indexOf(node), 1)
    return Effect.forEach(ready, (node) => executeNode(definition, node, values, context, undefined, nodeIndex), {
      concurrency: "unbounded"
    }).pipe(Effect.flatMap(executeReady), Effect.asVoid)
  }
  return executeReady().pipe(
    Effect.flatMap(() => Effect.try({ try: () => ({ value: evalExpr(request.selection, values) }), catch: (error) => error }))
  ) as Effect.Effect<PipelineResponse, unknown, never>
}

export const augment = <R extends Rpc.Any>(definition: PipelineDefinition<R>): RpcGroup.RpcGroup<R | typeof PipelineRpc> => definition.root.add(PipelineRpc)

export const layer = <R extends Rpc.Any>(definition: PipelineDefinition<R>): Layer.Layer<Rpc.ToHandler<typeof PipelineRpc>, never, Rpc.ToHandler<R>> =>
  Layer.effectContext(Effect.gen(function*() {
    const context = yield* Effect.context<any>()
    const handler = (request: PipelineRequest) => handle(definition, request, context)
    return Context.makeUnsafe(new Map([[PipelineRpc.key, { tag: PipelineRpc._tag, handler, context }]]))
  }))

export const layerHttp = <R extends Rpc.Any>(options: {
  readonly group: RpcGroup.RpcGroup<R>
  readonly path: string
  readonly id?: string
  readonly protocol?: "http" | "websocket"
}) => {
  const definition = {
    [PipelineDefinitionTypeId]: true,
    id: options.id ?? "default",
    root: options.group,
    capabilities: []
  } as PipelineDefinition<R>
  return RpcServer.layerHttp({
    group: augment(definition),
    path: options.path as any,
    protocol: options.protocol ?? "http"
  }).pipe(Layer.provide(layer(definition)))
}

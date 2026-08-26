import * as Effect from "effect/Effect"
import * as Effectable from "effect/Effectable"
import * as Option from "effect/Option"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { CapabilityGroupTypeId } from "./Capability.js"

export const PipelineRefTypeId = Symbol.for("effect-rpc-pipeline/PipelineRef")
const OperationTypeId = Symbol.for("effect-rpc-pipeline/Operation")

export class PipelineClientError extends Error {
  readonly _tag = "PipelineClientError"
  constructor(message: string, readonly cause?: unknown) { super(message) }
}

export type Expr =
  | { readonly _tag: "literal"; readonly value?: unknown }
  | { readonly _tag: "ref"; readonly id: string; readonly path: ReadonlyArray<string | number> }
  | { readonly _tag: "item"; readonly path: ReadonlyArray<string | number> }
  | { readonly _tag: "array"; readonly values: ReadonlyArray<Expr> }
  | { readonly _tag: "object"; readonly entries: ReadonlyArray<readonly [string, Expr]> }
  | { readonly _tag: "none" }
  | { readonly _tag: "some"; readonly value: Expr }

export type CallNode = { readonly _tag: "call"; readonly id: string; readonly target?: Expr; readonly method: string; readonly payload: Expr; readonly dependencies: ReadonlyArray<string> }
export type MapNode = { readonly _tag: "map"; readonly id: string; readonly source: Expr; readonly template: Expr; readonly dependencies: ReadonlyArray<string> }
export type PipelineNode = CallNode | MapNode
export type PipelineRequest = { readonly version: 1; readonly definitionId: string; readonly nodes: ReadonlyArray<PipelineNode>; readonly selection: Expr; readonly discards: ReadonlyArray<string> }
export type PipelineTransport = (request: PipelineRequest) => Effect.Effect<{ readonly value: unknown }, unknown, never>

type Runtime = { readonly definitionId: string; readonly execute: (request: PipelineRequest) => Effect.Effect<unknown, PipelineClientError, never>; nextId(): string }
type Graph = { readonly runtime: Runtime; readonly nodes: ReadonlyArray<PipelineNode>; readonly selection: Expr; readonly discards: ReadonlyArray<string> }
type InternalOperation = Effect.Effect<any, any, any> & { readonly [OperationTypeId]: true; readonly [PipelineRefTypeId]: true; readonly graph: Graph }
type CapabilityClient<A, E, R> = A extends { readonly [CapabilityGroupTypeId]: infer Group extends RpcGroup.RpcGroup<any> } ? ClientApi<RpcGroup.Rpcs<Group>, E, R> : unknown
type RemoteFields<A, E, R> = A extends Option.Option<any> | ReadonlyArray<any> ? unknown : A extends object ? { readonly [K in keyof A as A[K] extends (...args: any[]) => any ? never : K]: Remote<A[K], E, R> } : unknown

/** A remote value that composes without I/O and is also a normal Effect when yielded. */
export type Remote<A, E = unknown, R = never> = Effect.Effect<A, E, R> & { readonly [PipelineRefTypeId]: true; readonly readonlyType?: A } & CapabilityClient<A, E, R> & RemoteFields<A, E, R>
export type PipelineOperation<A, E = unknown, R = never> = Remote<A, E, R>
type PipelineMethod<R extends Rpc.Any, E, Env> = (input: PipelineInput<Rpc.PayloadConstructor<R>>) => Remote<Rpc.Success<R>, Rpc.Error<R> | E | PipelineClientError, Rpc.ServicesClient<R> | Env>

/** Exact RPC tags become client keys. Dots have no special meaning. */
export type ClientApi<Rpcs extends Rpc.Any, E = never, Env = never> = { readonly [R in Rpcs as R["_tag"]]: PipelineMethod<R, E, Env> }
export type PipelineInput<A> = A | Remote<A, any, any> | (A extends ReadonlyArray<infer I> ? ReadonlyArray<PipelineInput<I>> : A extends Option.Option<infer I> ? Option.Option<PipelineInput<I>> : A extends object ? { readonly [K in keyof A]: PipelineInput<A[K]> } : never)
export type Resolved<A> = A extends Effect.Effect<infer Success, any, any> ? Success
  : A extends Option.Option<infer I> ? Option.Option<Resolved<I>>
  : A extends ReadonlyArray<infer I> ? ReadonlyArray<Resolved<I>>
  : A extends object ? { readonly [K in keyof A]: Resolved<A[K]> }
  : A
type ErrorsIn<A> = A extends Effect.Effect<any, infer E, any> ? E
  : A extends Option.Option<infer I> ? ErrorsIn<I>
  : A extends ReadonlyArray<infer I> ? ErrorsIn<I>
  : A extends object ? { readonly [K in keyof A]: ErrorsIn<A[K]> }[keyof A]
  : never
type ServicesIn<A> = A extends Effect.Effect<any, any, infer R> ? R
  : A extends Option.Option<infer I> ? ServicesIn<I>
  : A extends ReadonlyArray<infer I> ? ServicesIn<I>
  : A extends object ? { readonly [K in keyof A]: ServicesIn<A[K]> }[keyof A]
  : never

const isOperation = (u: unknown): u is InternalOperation => (typeof u === "object" || typeof u === "function") && u !== null && (u as any)[OperationTypeId] === true
const refsIn = (expr: Expr, out = new Set<string>()): Set<string> => {
  switch (expr._tag) {
    case "ref": out.add(expr.id); break
    case "array": for (const value of expr.values) refsIn(value, out); break
    case "object": for (const [, value] of expr.entries) refsIn(value, out); break
    case "some": refsIn(expr.value, out); break
  }
  return out
}
const mergeNodes = (...graphs: ReadonlyArray<Graph>): ReadonlyArray<PipelineNode> => {
  const nodes = new Map<string, PipelineNode>()
  for (const graph of graphs) for (const node of graph.nodes) nodes.set(node.id, node)
  return [...nodes.values()]
}
const assertRuntime = (runtime: Runtime, graph: Graph) => { if (runtime !== graph.runtime) throw new Error("Remote values from different pipeline clients cannot be combined") }
const encodeValue = (value: unknown, runtime: Runtime, graphs: Graph[]): Expr => {
  if (isOperation(value)) { assertRuntime(runtime, value.graph); graphs.push(value.graph); return value.graph.selection }
  if (Option.isOption(value)) return Option.isNone(value) ? { _tag: "none" } : { _tag: "some", value: encodeValue(value.value, runtime, graphs) }
  if (Array.isArray(value)) return { _tag: "array", values: value.map((item) => encodeValue(item, runtime, graphs)) }
  if (value !== null && typeof value === "object") return { _tag: "object", entries: Object.keys(value).map((key) => [key, encodeValue((value as any)[key], runtime, graphs)] as const) }
  return { _tag: "literal", value }
}
const requestFor = (graph: Graph): PipelineRequest => ({ version: 1, definitionId: graph.runtime.definitionId, nodes: graph.nodes, selection: graph.selection, discards: graph.discards })

const OperationProto = Effectable.Prototype({
  label: "PipelineOperation",
  evaluate() {
    const operation = this as unknown as InternalOperation
    return operation.graph.runtime.execute(requestFor(operation.graph))
  }
})
const project = (expr: Expr, property: string): Expr => {
  if (expr._tag === "ref" || expr._tag === "item") return { ...expr, path: [...expr.path, property] }
  throw new Error("Only a remote reference can be projected")
}
const makeRemote = <A, E = unknown, R = never>(graph: Graph): Remote<A, E, R> => {
  const operation = Object.assign(() => undefined, {
    [OperationTypeId]: true as const,
    [PipelineRefTypeId]: true as const,
    graph
  })
  Object.setPrototypeOf(operation, OperationProto)
  return new Proxy(operation as any, {
    get(target, property, receiver) {
      if (property === OperationTypeId || property === PipelineRefTypeId || property === "graph") return Reflect.get(target, property, receiver)
      if (property === "then") return undefined
      if (typeof property === "symbol" || property in target) {
        const value = Reflect.get(target, property, receiver)
        return typeof value === "function" ? value.bind(target) : value
      }
      return makeRemote({ ...graph, selection: project(graph.selection, property) })
    },
    apply(_target, _thisArg, args: ReadonlyArray<unknown>) {
      const selected = graph.selection
      if (selected._tag !== "ref" || selected.path.length === 0) throw new Error("Only a remote capability method can be called")
      const method = selected.path[selected.path.length - 1]
      if (typeof method !== "string") throw new Error("Invalid capability method")
      const target: Expr = { ...selected, path: selected.path.slice(0, -1) }
      const extra: Graph[] = []
      const payload = encodeValue(args.length === 0 ? undefined : args.length === 1 ? args[0] : args, graph.runtime, extra)
      const id = graph.runtime.nextId()
      const node: CallNode = { _tag: "call", id, target, method, payload, dependencies: [...new Set([...refsIn(target), ...refsIn(payload)])] }
      return makeRemote({ runtime: graph.runtime, nodes: [...mergeNodes(graph, ...extra), node], selection: { _tag: "ref", id, path: [] }, discards: [] })
    }
  })
}

export const makeClient = <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, definitionId: string, execute: Runtime["execute"]): ClientApi<Rpcs> => {
  let sequence = 0
  const runtime: Runtime = { definitionId, execute, nextId: () => `$${sequence++}` }
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string" || !group.requests.has(property)) return undefined
      return (input?: unknown) => {
        const extra: Graph[] = []
        const payload = encodeValue(input, runtime, extra)
        const id = runtime.nextId()
        const node: CallNode = { _tag: "call", id, method: property, payload, dependencies: [...refsIn(payload)] }
        return makeRemote({ runtime, nodes: [...mergeNodes(...extra), node], selection: { _tag: "ref", id, path: [] }, discards: [] })
      }
    }
  }) as ClientApi<Rpcs>
}

/** Combines structured remote values into one request. */
export const all = <A>(value: A): Remote<Resolved<A>, ErrorsIn<A>, ServicesIn<A>> => {
  const operations: InternalOperation[] = []
  const find = (current: unknown): void => {
    if (isOperation(current)) { operations.push(current); return }
    if (Option.isOption(current)) { if (Option.isSome(current)) find(current.value); return }
    if (Array.isArray(current)) { for (const item of current) find(item); return }
    if (current && typeof current === "object") for (const item of Object.values(current)) find(item)
  }
  find(value)
  if (operations.length === 0) throw new Error("Pipeline.all requires at least one remote operation")
  const runtime = operations[0]!.graph.runtime
  const graphs: Graph[] = []
  const selection = encodeValue(value, runtime, graphs)
  return makeRemote({ runtime, nodes: mergeNodes(...graphs), selection, discards: [] }) as Remote<Resolved<A>, ErrorsIn<A>, ServicesIn<A>>
}

export function map<A, B, E, R>(source: Remote<ReadonlyArray<A>, E, R>, mapper: (item: Remote<A, E, R>) => B): Remote<ReadonlyArray<Resolved<B>>, E | PipelineClientError, R>
export function map<A, B, E, R>(source: Remote<Option.Option<A>, E, R>, mapper: (item: Remote<A, E, R>) => B): Remote<Option.Option<Resolved<B>>, E | PipelineClientError, R>
export function map(source: Remote<any, any, any>, mapper: (item: Remote<any, any, any>) => unknown): Remote<any, any, any> {
  if (!isOperation(source)) throw new Error("Pipeline.map requires a remote array or Option")
  const sourceGraph = source.graph
  const placeholder = makeRemote({ runtime: sourceGraph.runtime, nodes: [], selection: { _tag: "item", path: [] }, discards: [] })
  const extra: Graph[] = []
  const template = encodeValue(mapper(placeholder), sourceGraph.runtime, extra)
  const id = sourceGraph.runtime.nextId()
  const node: MapNode = { _tag: "map", id, source: sourceGraph.selection, template, dependencies: [...new Set([...refsIn(sourceGraph.selection), ...refsIn(template)])] }
  return makeRemote({ runtime: sourceGraph.runtime, nodes: [...mergeNodes(sourceGraph, ...extra), node], selection: { _tag: "ref", id, path: [] }, discards: [] })
}

/** Orders `right` after `left` while retaining only the right-hand result. */
export const zipRight = <A, B, E, E2, R, R2>(left: Remote<A, E, R>, right: Remote<B, E2, R2>): Remote<B, E | E2, R | R2> => {
  if (!isOperation(left) || !isOperation(right)) throw new Error("Pipeline.zipRight requires two remote operations")
  assertRuntime(left.graph.runtime, right.graph)
  const leftIds = refsIn(left.graph.selection)
  const leftNodeIds = new Set(left.graph.nodes.map((node) => node.id))
  const orderedRight: Graph = { ...right.graph, nodes: right.graph.nodes.map((node) => leftNodeIds.has(node.id) ? node : ({ ...node, dependencies: [...new Set([...node.dependencies, ...leftIds])] })) }
  return makeRemote({ runtime: left.graph.runtime, nodes: mergeNodes(left.graph, orderedRight), selection: right.graph.selection, discards: [...leftIds] })
}

export const isPipelineRef = isOperation
export const isOption = Option.isOption

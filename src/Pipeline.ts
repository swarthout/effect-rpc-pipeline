import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"

export const PipelineRefTypeId = Symbol.for("effect-rpc-pipeline/PipelineRef")
export const PipelineDefinitionTypeId = Symbol.for("effect-rpc-pipeline/PipelineDefinition")
export const PipelineClientTypeId = Symbol.for("effect-rpc-pipeline/PipelineClient")
const PipelineSelectionTypeId = Symbol.for("effect-rpc-pipeline/PipelineSelection")

export type CapabilityDescriptor = {
  readonly _tag: "CapabilityDescriptor"
  readonly id: string
  readonly group: RpcGroup.RpcGroup<any>
}

export type Expr =
  | { readonly _tag: "literal"; readonly value: unknown }
  | { readonly _tag: "ref"; readonly id: string; readonly path: ReadonlyArray<string | number> }
  | { readonly _tag: "item" }
  | { readonly _tag: "array"; readonly values: ReadonlyArray<Expr> }
  | { readonly _tag: "object"; readonly entries: ReadonlyArray<readonly [string, Expr]> }

export type CallNode = {
  readonly _tag: "call"
  readonly id: string
  readonly target: Expr | undefined
  readonly method: string
  readonly payload: Expr
  readonly dependencies: ReadonlyArray<string>
}

export type MapNode = {
  readonly _tag: "map"
  readonly id: string
  readonly source: Expr
  readonly template: Expr
  readonly dependencies: ReadonlyArray<string>
}

export type PipelineNode = CallNode | MapNode

export type PipelineRequest = {
  readonly version: 1
  readonly definitionId: string
  readonly nodes: ReadonlyArray<PipelineNode>
  readonly selection: Expr
  readonly discards: ReadonlyArray<string>
}

export type PipelineDefinition<Rpcs extends Rpc.Any = any> = {
  readonly [PipelineDefinitionTypeId]: true
  readonly id: string
  readonly root: RpcGroup.RpcGroup<Rpcs>
  readonly capabilities: ReadonlyArray<CapabilityDescriptor>
}

export type PipelineRef<T = unknown> = {
  readonly [PipelineRefTypeId]: true
  readonly readonlyType?: T
}

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends
  ((value: infer I) => void) ? I : never

type ClientEntry<R extends Rpc.Any> = R["_tag"] extends `${infer Head}.${infer Tail}`
  ? { readonly [K in Head]: ClientPath<R, Tail> }
  : { readonly [K in R["_tag"]]: PipelineMethod<R> }

type ClientPath<R extends Rpc.Any, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? { readonly [K in Head]: ClientPath<R, Tail> }
  : { readonly [K in Path]: PipelineMethod<R> }

type PipelineMethod<R extends Rpc.Any> = (
  input: PipelineInput<Rpc.PayloadConstructor<R>>
) => PipelineOperation<Rpc.Success<R>>

/** A typed, nested proxy surface derived from the tags in an Effect RpcGroup. */
export type ClientApi<Rpcs extends Rpc.Any> = UnionToIntersection<Rpcs extends unknown ? ClientEntry<Rpcs> : never>

/** Allows unresolved pipeline values anywhere a concrete RPC payload value is accepted. */
export type PipelineInput<A> = A | PipelineOperation<A> |
  (A extends ReadonlyArray<infer I> ? ReadonlyArray<PipelineInput<I>> :
    A extends object ? { readonly [K in keyof A]: PipelineInput<A[K]> } : never)

type CapabilityClient<A> = A extends { readonly group: RpcGroup.RpcGroup<infer Rpcs> }
  ? ClientApi<Rpcs>
  : unknown

type PipelineMap<A> = A extends ReadonlyArray<infer Item>
  ? { readonly map: <B>(mapper: (item: PipelineValue<Item>) => B) => PipelineOperation<ReadonlyArray<Resolved<B>>> }
  : A extends Option.Option<infer Item>
  ? { readonly map: <B>(mapper: (item: PipelineValue<Item>) => B) => PipelineOperation<Option.Option<Resolved<B>>> }
  : unknown

/** The value shape visible while a graph is being recorded. */
export type PipelineValue<A> = A extends { readonly group: RpcGroup.RpcGroup<any> }
  ? CapabilityClient<A>
  : A

/** A lazy remote operation. It is callable through capability proxies and yieldable in Pipeline.run. */
export type PipelineOperation<A> = PipelineRef<A> & CapabilityClient<A> & PipelineMap<A> & {
  readonly [Symbol.iterator]: () => Generator<PipelineOperation<A>, PipelineValue<A>, unknown>
}

/** Resolves operations embedded in an output structure to their actual server values. */
export type Resolved<A> = A extends PipelineRef<infer T> ? T
  : A extends ReadonlyArray<infer I> ? ReadonlyArray<Resolved<I>>
  : A extends object ? { readonly [K in keyof A]: Resolved<A[K]> }
  : A

export type RunnableClient<D extends PipelineDefinition = PipelineDefinition> = {
  readonly definition: D
  readonly [PipelineClientTypeId]: {
    readonly execute: (request: PipelineRequest) => Effect.Effect<unknown, unknown, never>
  }
}

type Selection<A> = {
  readonly [PipelineSelectionTypeId]: true
  readonly value: A
  readonly [Symbol.iterator]: () => Generator<Selection<A>, A, unknown>
}

type InternalRef = PipelineRef & {
  readonly __expr: Expr
  readonly __context: Recorder
}

type Recorder = {
  readonly nodes: PipelineNode[]
  readonly contextId: symbol
  nextId(): string
  explicitDeps: Set<string> | undefined
  discards: Set<string>
}

const isRef = (u: unknown): u is InternalRef =>
  (typeof u === "object" || typeof u === "function") && u !== null && (u as any)[PipelineRefTypeId] === true

const collectRefs = (expr: Expr, out = new Set<string>()): Set<string> => {
  switch (expr._tag) {
    case "ref": if (expr.id !== "__item__" && expr.id !== "__root__") out.add(expr.id); break
    case "array": for (const item of expr.values) collectRefs(item, out); break
    case "object": for (const [, item] of expr.entries) collectRefs(item, out); break
  }
  return out
}

const toExpr = (value: unknown, ctx: Recorder): Expr => {
  if (isRef(value)) {
    if (value.__context !== ctx) throw new Error("Pipeline refs cannot be used across execute calls")
    return value.__expr
  }
  if (Array.isArray(value)) return { _tag: "array", values: value.map((v) => toExpr(v, ctx)) }
  if (value && typeof value === "object") {
    return {
      _tag: "object",
      entries: Object.keys(value as object).map((key) => [key, toExpr((value as any)[key], ctx)] as const)
    }
  }
  return { _tag: "literal", value }
}

const makeRef = (ctx: Recorder, expr: Expr): InternalRef => {
  const callable = (() => undefined) as any
  let proxy: InternalRef
  proxy = new Proxy(callable, {
    get(_target, property: string | symbol) {
      if (property === PipelineRefTypeId) return true
      if (property === "__expr") return expr
      if (property === "__context") return ctx
      if (property === "then") return undefined
      if (property === Symbol.iterator) {
        return () => {
          let yielded = false
          return {
            next: () => yielded
              ? { done: true as const, value: proxy }
              : (yielded = true, { done: false as const, value: proxy }),
            [Symbol.iterator]() { return this }
          }
        }
      }
      if (property === "map") {
        return (mapper: (item: unknown) => unknown) => {
          const previous = ctx.explicitDeps
          ctx.explicitDeps = new Set(collectRefs(expr))
          try {
            const mapped = mapper(makeRef(ctx, { _tag: "ref", id: "__item__", path: [] }))
            const template = toExpr(mapped, ctx)
            const id = ctx.nextId()
            const dependencies = new Set<string>([...collectRefs(expr), ...collectRefs(template)])
            ctx.nodes.push({ _tag: "map", id, source: expr, template, dependencies: [...dependencies] })
            return makeRef(ctx, { _tag: "ref", id, path: [] })
          } finally {
            ctx.explicitDeps = previous
          }
        }
      }
      if (property === "toJSON" || property === Symbol.toPrimitive) {
        throw new Error("Pipeline refs cannot be coerced or iterated while recording")
      }
      if (typeof property === "symbol") return undefined
      return makeRef(ctx, { _tag: "ref", id: expr._tag === "ref" ? expr.id : "__root__", path: expr._tag === "ref" ? [...expr.path, property] : [property] })
    },
    apply(_target, _thisArg, args: ReadonlyArray<unknown>) {
      if (expr._tag !== "ref") throw new Error("Only RPC method refs can be called")
      const last = expr.path.at(-1)
      if (typeof last !== "string") throw new Error("Invalid RPC method")
      const isRoot = expr.id === "__root__"
      const method = isRoot ? expr.path.join(".") : last
      const target = isRoot ? undefined : { _tag: "ref", id: expr.id, path: expr.path.slice(0, -1) } as Expr
      const payload: Expr = args.length === 0
        ? { _tag: "literal", value: undefined }
        : args.length === 1
        ? toExpr(args[0], ctx)
        : { _tag: "array", values: args.map((a) => toExpr(a, ctx)) }
      const id = ctx.nextId()
      const deps = new Set<string>([...collectRefs(payload), ...(target ? collectRefs(target) : []), ...(ctx.explicitDeps ?? [])])
      ctx.nodes.push({ _tag: "call", id, target, method, payload, dependencies: [...deps] })
      return makeRef(ctx, { _tag: "ref", id, path: [] })
    }
  }) as InternalRef
  return proxy
}

export const makeRecorder = <Rpcs extends Rpc.Any = Rpc.Any>(): { readonly context: Recorder; readonly root: ClientApi<Rpcs> } => {
  const ctx: Recorder = {
    nodes: [],
    contextId: Symbol("pipeline-context"),
    explicitDeps: undefined,
    discards: new Set(),
    nextId: () => `$${ctx.nodes.length}`
  }
  const root = makeRef(ctx, { _tag: "ref", id: "__root__", path: [] })
  return { context: ctx, root: root as unknown as ClientApi<Rpcs> }
}

export const make = <Rpcs extends Rpc.Any>(options: {
  readonly id?: string
  readonly root: RpcGroup.RpcGroup<Rpcs>
  readonly capabilities?: ReadonlyArray<CapabilityDescriptor>
}): PipelineDefinition<Rpcs> => ({
  [PipelineDefinitionTypeId]: true,
  id: options.id ?? "default",
  root: options.root,
  capabilities: options.capabilities ?? []
})

/** @deprecated Prefer generator sequencing with Pipeline.run. */
export const after = <A, B>(dependency: PipelineRef<A>, thunk: () => B): B => {
  if (!isRef(dependency)) throw new Error("Pipeline.after requires a ref from the current pipeline evaluation")
  const ctx = dependency.__context
  const previous = ctx.explicitDeps
  ctx.explicitDeps = new Set(collectRefs(dependency.__expr))
  try { return thunk() } finally { ctx.explicitDeps = previous }
}

export const discard = (ref: PipelineRef): void => {
  if (!isRef(ref) || ref.__expr._tag !== "ref") throw new Error("Pipeline.discard requires a call ref")
  ref.__context.discards.add(ref.__expr.id)
}

export const requestFrom = <R extends Rpc.Any, A>(definition: PipelineDefinition<R>, builder: (api: ClientApi<R>) => A): PipelineRequest => {
  const { context, root } = makeRecorder<R>()
  const selection = toExpr(builder(root), context)
  for (const node of context.nodes) {
    if (node._tag === "call" && node.target?._tag === "ref" && node.target.id === "__root__") {
      // Root method refs are represented by their method path on the call expression.
    }
  }
  const reachable = new Set(collectRefs(selection))
  for (const id of context.discards) reachable.add(id)
  let changed = true
  while (changed) {
    changed = false
    for (const node of context.nodes) {
      if (reachable.has(node.id)) for (const dep of node.dependencies) {
        if (!reachable.has(dep)) { reachable.add(dep); changed = true }
      }
    }
  }
  const orphan = context.nodes.filter((n) => !reachable.has(n.id) && n._tag === "call")
  if (orphan.length > 0) throw new Error(`Unreachable pipeline calls: ${orphan.map((n) => n.id).join(", ")}`)
  return { version: 1, definitionId: definition.id, nodes: context.nodes, selection, discards: [...context.discards] }
}

const isSelection = (value: unknown): value is Selection<unknown> =>
  typeof value === "object" && value !== null && (value as any)[PipelineSelectionTypeId] === true

const yieldedValue = (value: unknown): unknown => isSelection(value) ? value.value : value

/** Marks a group of operations as parallel siblings when it is yielded inside Pipeline.run. */
export const all = <A>(value: A): Selection<A> => {
  const selection: Selection<A> = {
    [PipelineSelectionTypeId]: true,
    value,
    [Symbol.iterator]: function*() {
      yield selection
      return value
    }
  }
  return selection
}

const requestFromGenerator = <R extends Rpc.Any, A>(
  definition: PipelineDefinition<R>,
  program: (api: ClientApi<R>) => Generator<PipelineRef | Selection<unknown>, A, unknown>
): PipelineRequest => {
  const { context, root } = makeRecorder<R>()
  const iterator = program(root)
  let step = iterator.next()
  while (!step.done) {
    const value = yieldedValue(step.value)
    const expr = toExpr(value, context)
    const yieldedRefs = collectRefs(expr)
    for (const id of yieldedRefs) context.discards.add(id)
    context.explicitDeps = yieldedRefs
    step = iterator.next(value)
  }
  const selection = toExpr(step.value, context)
  const reachable = new Set(collectRefs(selection))
  for (const id of context.discards) reachable.add(id)
  let changed = true
  while (changed) {
    changed = false
    for (const node of context.nodes) if (reachable.has(node.id)) for (const dep of node.dependencies) {
      if (!reachable.has(dep)) { reachable.add(dep); changed = true }
    }
  }
  const orphan = context.nodes.filter((node) => node._tag === "call" && !reachable.has(node.id))
  if (orphan.length > 0) throw new Error(`Unreachable pipeline calls: ${orphan.map((node) => node.id).join(", ")}`)
  return { version: 1, definitionId: definition.id, nodes: context.nodes, selection, discards: [...context.discards] }
}

/** Builds a Cap'n Web-style graph and resolves its selected outputs in one request. */
export const resolve = <D extends PipelineDefinition<any>, A>(
  client: RunnableClient<D>,
  builder: (api: ClientApi<D["root"] extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never>) => A
): Effect.Effect<Resolved<A>, unknown, never> =>
  Effect.try({ try: () => requestFrom(client.definition, builder), catch: (error) => error }).pipe(
    Effect.flatMap((request) => client[PipelineClientTypeId].execute(request)),
    Effect.map((value) => value as Resolved<A>)
  )

/** Records an ordered generator program and evaluates the resulting graph in one request. */
export const run = <D extends PipelineDefinition<any>, A>(
  client: RunnableClient<D>,
  program: (api: ClientApi<D["root"] extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never>) =>
    Generator<PipelineRef | Selection<unknown>, A, unknown>
): Effect.Effect<Resolved<A>, unknown, never> =>
  Effect.try({ try: () => requestFromGenerator(client.definition, program), catch: (error) => error }).pipe(
    Effect.flatMap((request) => client[PipelineClientTypeId].execute(request)),
    Effect.map((value) => value as Resolved<A>)
  )

export const isPipelineRef = isRef
export const isDefinition = (u: unknown): u is PipelineDefinition =>
  typeof u === "object" && u !== null && (u as any)[PipelineDefinitionTypeId] === true

export const isOption = Option.isOption

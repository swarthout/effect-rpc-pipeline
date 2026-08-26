import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcClient from "effect/unstable/rpc/RpcClient"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcSchema from "effect/unstable/rpc/RpcSchema"
import * as Schema from "effect/Schema"

export const CapabilityGroupTypeId = Symbol.for("effect-rpc-pipeline/CapabilityGroup")

export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()("CapabilityUnavailable", {
  capabilityId: Schema.String,
  reason: Schema.String
}) {}

export class CapabilityTransportError extends Schema.TaggedError<CapabilityTransportError>()("CapabilityTransportError", {
  capabilityId: Schema.String,
  reason: Schema.String
}) {}

export const CapabilityRefTag = "EffectRpcPipelineCapabilityRef" as const

export type CapabilityRef = {
  readonly _tag: typeof CapabilityRefTag
  readonly definitionId: string
  readonly capabilityId: string
  readonly owner: "client" | "server"
}

type InstanceBase<Group extends RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityInstance"
  readonly capabilityId: string
  readonly definitionId: string
  readonly group: Group
  readonly [CapabilityGroupTypeId]: Group
  readonly owner: "local" | "remote"
  readonly context: Context.Context<
    Rpc.ToHandler<RpcGroup.Rpcs<Group>> | Rpc.Middleware<RpcGroup.Rpcs<Group>> | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>
  >
  readonly invoke: (method: string, payload: unknown) => Effect.Effect<unknown, unknown>
  readonly release: Effect.Effect<void, unknown>
}

export type CapabilityInstance<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> =
  InstanceBase<Group> & RpcClient.RpcClient<RpcGroup.Rpcs<Group>, CapabilityUnavailable | CapabilityTransportError>

export type CapabilityDefinition<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityDescriptor"
  readonly id: string
  readonly group: Group
  readonly schema: Schema.declare<CapabilityInstance<Group>>
  readonly fromHandlers: {
    <Handlers extends RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>>(handlers: Handlers): Effect.Effect<
      CapabilityInstance<Group>,
      never,
      | RpcGroup.HandlersServices<RpcGroup.Rpcs<Group>, Handlers>
      | Rpc.Middleware<RpcGroup.Rpcs<Group>>
      | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>
    >
    <Handlers extends RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>, E, R>(handlers: Effect.Effect<Handlers, E, R>): Effect.Effect<
      CapabilityInstance<Group>,
      E,
      | R
      | RpcGroup.HandlersServices<RpcGroup.Rpcs<Group>, Handlers>
      | Rpc.Middleware<RpcGroup.Rpcs<Group>>
      | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>
    >
  }
}

export const TypeId = Symbol.for("effect-rpc-pipeline/Capability")

const definitions = new Map<string, CapabilityDefinition<any>>()
let sequence = 0

const proxy = <Group extends RpcGroup.RpcGroup<any>>(base: InstanceBase<Group>): CapabilityInstance<Group> => new Proxy(base as CapabilityInstance<Group>, {
  get(target, property, receiver) {
    if (typeof property !== "string" || !target.group.requests.has(property)) return Reflect.get(target, property, receiver)
    return (payload?: unknown) => target.invoke(property, payload)
  }
})

export const invokeLocal = (
  instance: CapabilityInstance,
  method: string,
  payload: unknown,
  metadata?: Parameters<Rpc.Handler<string>["handler"]>[1]
): Effect.Effect<unknown, unknown> => Effect.gen(function*() {
  const rpc = instance.group.requests.get(method) as unknown as Rpc.AnyWithProps | undefined
  if (rpc === undefined) return yield* Effect.fail(new CapabilityUnavailable({ capabilityId: instance.capabilityId, reason: `Unknown method ${method}` }))
  if (RpcSchema.isStreamSchema(rpc.successSchema)) {
    return yield* Effect.fail(new CapabilityUnavailable({ capabilityId: instance.capabilityId, reason: "Streaming capability methods are not supported" }))
  }
  const decoded = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(payload)
  const access = yield* instance.group.accessHandler(method)
  const options = metadata ?? {
    client: new (class { readonly id = 0; annotations = Context.empty() })() as any,
    requestId: `capability/${instance.capabilityId}` as any,
    headers: {} as any,
    rpc
  }
  const invoked = (access as any)(decoded, { ...options, rpc, payload: decoded })
  const base = Rpc.isWrapper(invoked) ? invoked.value : invoked
  if (!Effect.isEffect(base)) return yield* Effect.fail(new CapabilityUnavailable({ capabilityId: instance.capabilityId, reason: "Invalid capability handler" }))
  let effect = base as Effect.Effect<unknown, unknown, any>
  for (const service of rpc.middlewares) {
    const middleware = Context.getUnsafe(instance.context, service) as any
    effect = middleware(effect, { ...options, rpc, payload: decoded })
  }
  return yield* effect
}).pipe(Effect.provideContext(instance.context)) as Effect.Effect<unknown, unknown>

export const toRef = (instance: CapabilityInstance, owner: CapabilityRef["owner"]): CapabilityRef => ({
  _tag: CapabilityRefTag,
  definitionId: instance.definitionId,
  capabilityId: instance.capabilityId,
  owner
})

export const isRef = (u: unknown): u is CapabilityRef => typeof u === "object" && u !== null &&
  (u as any)._tag === CapabilityRefTag && typeof (u as any).definitionId === "string" && typeof (u as any).capabilityId === "string"

export const fromRemoteRef = (
  ref: CapabilityRef,
  invoke: (method: string, payload: unknown) => Effect.Effect<unknown, unknown>,
  release: Effect.Effect<void, unknown> = Effect.void
): CapabilityInstance => {
  const definition = definitions.get(ref.definitionId)
  if (definition === undefined) throw new CapabilityUnavailable({ capabilityId: ref.capabilityId, reason: `Unknown definition ${ref.definitionId}` })
  return proxy({
    _tag: "CapabilityInstance",
    capabilityId: ref.capabilityId,
    definitionId: ref.definitionId,
    group: definition.group,
    [CapabilityGroupTypeId]: definition.group,
    owner: "remote",
    context: Context.empty(),
    invoke,
    release
  })
}

/** Defines a typed, batch-local capability surface using standard RpcGroup handlers. */
export const make = <Group extends RpcGroup.RpcGroup<any>>(id: string, group: Group): CapabilityDefinition<Group> => {
  const descriptor: CapabilityDefinition<Group> = {
    _tag: "CapabilityDescriptor",
    id,
    group,
    schema: Schema.declare<CapabilityInstance<Group>>((value): value is CapabilityInstance<Group> => isInstance(value)),
    fromHandlers: (handlers: unknown) => Effect.gen(function*() {
      const ambient = yield* Effect.context<any>()
      const handlerContext = yield* group.toHandlers(handlers as any)
      const capabilityId = `${id}:${++sequence}`
      const base: InstanceBase<Group> = {
        _tag: "CapabilityInstance" as const,
        capabilityId,
        definitionId: id,
        group,
        [CapabilityGroupTypeId]: group,
        owner: "local",
        context: Context.merge(ambient, handlerContext),
        invoke: (method, payload) => invokeLocal(instance, method, payload),
        release: Effect.void
      }
      const instance = proxy(base)
      return instance
    }) as any
  }
  definitions.set(id, descriptor)
  return descriptor
}

export const isInstance = (u: unknown): u is CapabilityInstance =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilityInstance"

export const isSchema = (u: unknown): boolean =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilitySchema"

/** Explicitly releases a remote capability before the connection scope closes. */
export const release = (instance: CapabilityInstance): Effect.Effect<void, unknown> => instance.release

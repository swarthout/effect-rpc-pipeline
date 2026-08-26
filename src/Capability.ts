import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Schema from "effect/Schema"

export const CapabilityGroupTypeId = Symbol.for("effect-rpc-pipeline/CapabilityGroup")

export type CapabilityInstance<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityInstance"
  readonly capabilityId: string
  readonly group: Group
  readonly [CapabilityGroupTypeId]: Group
  readonly context: Context.Context<
    Rpc.ToHandler<RpcGroup.Rpcs<Group>> | Rpc.Middleware<RpcGroup.Rpcs<Group>> | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>
  >
}

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
      return {
        _tag: "CapabilityInstance" as const,
        capabilityId: id,
        group,
        [CapabilityGroupTypeId]: group,
        context: Context.merge(ambient, handlerContext)
      }
    }) as any
  }
  return descriptor
}

export const isInstance = (u: unknown): u is CapabilityInstance =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilityInstance"

export const isSchema = (u: unknown): boolean =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilitySchema"

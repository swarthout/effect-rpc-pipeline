import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Schema from "effect/Schema"

export const CapabilityGroupTypeId = Symbol.for("effect-rpc-pipeline/CapabilityGroup")

export type CapabilityInstance<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityInstance"
  readonly capabilityId: string
  readonly group: Group
  readonly [CapabilityGroupTypeId]: Group
  readonly handlers: RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>
}

export type CapabilityDefinition<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityDescriptor"
  readonly id: string
  readonly group: Group
  readonly schema: Schema.declare<CapabilityInstance<Group>>
  readonly make: (handlers: RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>) => CapabilityInstance<Group>
  readonly of: (handlers: RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>) => CapabilityInstance<Group>
}

export const TypeId = Symbol.for("effect-rpc-pipeline/Capability")

/** Defines a typed, batch-local capability surface using standard RpcGroup handlers. */
export const make = <Group extends RpcGroup.RpcGroup<any>>(id: string, group: Group): CapabilityDefinition<Group> => {
  const descriptor: CapabilityDefinition<Group> = {
    _tag: "CapabilityDescriptor",
    id,
    group,
    schema: Schema.declare<CapabilityInstance<Group>>((value): value is CapabilityInstance<Group> => isInstance(value)),
    make: (handlers) => ({ _tag: "CapabilityInstance", capabilityId: id, group, [CapabilityGroupTypeId]: group, handlers }),
    of: (handlers) => ({ _tag: "CapabilityInstance", capabilityId: id, group, [CapabilityGroupTypeId]: group, handlers })
  }
  return descriptor
}

export const isInstance = (u: unknown): u is CapabilityInstance =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilityInstance"

export const isSchema = (u: unknown): boolean =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilitySchema"

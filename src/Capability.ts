import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Schema from "effect/Schema"
import { PipelineDefinitionTypeId, type CapabilityDescriptor } from "./Pipeline.js"

export type CapabilityInstance<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
  readonly _tag: "CapabilityInstance"
  readonly capabilityId: string
  readonly group: Group
  readonly handlers: Record<string, (...args: any[]) => any>
}

export type CapabilityDefinition<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = CapabilityDescriptor & {
  readonly group: Group
  readonly schema: Schema.Schema<CapabilityInstance<Group>>
  readonly make: (handlers: Record<string, (...args: any[]) => any>) => CapabilityInstance<Group>
  readonly of: (handlers: Record<string, (...args: any[]) => any>) => CapabilityInstance<Group>
}

export const TypeId = Symbol.for("effect-rpc-pipeline/Capability")

/** Defines a batch-local capability surface. The schema is intentionally branded; the server validates its group. */
export const make = <Group extends RpcGroup.RpcGroup<any>>(id: string, group: Group): CapabilityDefinition<Group> => {
  const descriptor: CapabilityDefinition<Group> = {
    _tag: "CapabilityDescriptor",
    id,
    group,
    schema: Schema.Any as unknown as Schema.Schema<CapabilityInstance<Group>>,
    make: (handlers) => ({ _tag: "CapabilityInstance", capabilityId: id, group, handlers }),
    of: (handlers) => ({ _tag: "CapabilityInstance", capabilityId: id, group, handlers })
  }
  return descriptor
}

export const isInstance = (u: unknown): u is CapabilityInstance =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilityInstance"

export const isSchema = (u: unknown): boolean =>
  typeof u === "object" && u !== null && (u as any)._tag === "CapabilitySchema"

export { PipelineDefinitionTypeId }

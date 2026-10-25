# Capability

Define finite capability groups with make and create instances with fromHandlers. Release remote handles with release. Predicates inspect definitions, instances and wire refs. invokeLocal, invokeWire, toRef and fromRemoteRef are adapter-level APIs.

Import from `effect-rpc-pipeline/Capability`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Rpc from "effect/rpc/Rpc";
import type * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
export declare const CapabilityGroupTypeId: unique symbol;
declare const CapabilityUnavailable_base: Schema.Class<CapabilityUnavailable, Schema.TaggedStruct<"CapabilityUnavailable", {
    readonly capabilityId: Schema.String;
    readonly reason: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class CapabilityUnavailable extends CapabilityUnavailable_base {
}
declare const CapabilityTransportError_base: Schema.Class<CapabilityTransportError, Schema.TaggedStruct<"CapabilityTransportError", {
    readonly capabilityId: Schema.String;
    readonly reason: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class CapabilityTransportError extends CapabilityTransportError_base {
}
export declare const CapabilityRefTag: "EffectRpcPipelineCapabilityRef";
export type CapabilityRef = {
    readonly _tag: typeof CapabilityRefTag;
    readonly definitionId: string;
    readonly capabilityId: string;
    readonly owner: "client" | "server";
};
type InstanceBase<Group extends RpcGroup.RpcGroup<any>> = {
    readonly _tag: "CapabilityInstance";
    readonly capabilityId: string;
    readonly definitionId: string;
    readonly group: Group;
    readonly [CapabilityGroupTypeId]: Group;
    readonly owner: "local" | "remote";
    readonly context: Context.Context<Rpc.ToHandler<RpcGroup.Rpcs<Group>> | Rpc.Middleware<RpcGroup.Rpcs<Group>> | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>>;
    readonly invoke: (method: string, payload: unknown) => Effect.Effect<unknown, unknown>;
    readonly release: Effect.Effect<void, unknown>;
};
export type CapabilityInstance<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = InstanceBase<Group> & RpcClient.RpcClient<RpcGroup.Rpcs<Group>, CapabilityUnavailable | CapabilityTransportError>;
export type CapabilityDefinition<Group extends RpcGroup.RpcGroup<any> = RpcGroup.RpcGroup<any>> = {
    readonly _tag: "CapabilityDescriptor";
    readonly id: string;
    readonly group: Group;
    readonly schema: Schema.declare<CapabilityInstance<Group>>;
    readonly fromHandlers: {
        <Handlers extends RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>>(handlers: Handlers): Effect.Effect<CapabilityInstance<Group>, never, RpcGroup.HandlersServices<RpcGroup.Rpcs<Group>, Handlers> | Rpc.Middleware<RpcGroup.Rpcs<Group>> | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>>;
        <Handlers extends RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>, E, R>(handlers: Effect.Effect<Handlers, E, R>): Effect.Effect<CapabilityInstance<Group>, E, R | RpcGroup.HandlersServices<RpcGroup.Rpcs<Group>, Handlers> | Rpc.Middleware<RpcGroup.Rpcs<Group>> | Rpc.ServicesServer<RpcGroup.Rpcs<Group>>>;
    };
};
export declare const TypeId: unique symbol;
export declare const invokeLocal: (instance: CapabilityInstance, method: string, payload: unknown, metadata?: Parameters<Rpc.Handler<string>["handler"]>[1]) => Effect.Effect<unknown, unknown>;
/** Invokes a local capability and encodes its declared success or failure for transport. */
export declare const invokeWire: (instance: CapabilityInstance, method: string, payload: unknown, metadata?: Parameters<Rpc.Handler<string>["handler"]>[1]) => Effect.Effect<unknown, unknown>;
export declare const toRef: (instance: CapabilityInstance, owner: CapabilityRef["owner"]) => CapabilityRef;
export declare const isRef: (u: unknown) => u is CapabilityRef;
export declare const fromRemoteRef: (ref: CapabilityRef, invoke: (method: string, payload: unknown) => Effect.Effect<unknown, unknown>, release?: Effect.Effect<void, unknown>) => CapabilityInstance;
/** Defines a typed, batch-local capability surface using standard RpcGroup handlers. */
export declare const make: <Group extends RpcGroup.RpcGroup<any>>(id: string, group: Group) => CapabilityDefinition<Group>;
export declare const isInstance: (u: unknown) => u is CapabilityInstance;
export declare const isSchema: (u: unknown) => boolean;
/** Explicitly releases a remote capability before the connection scope closes. */
export declare const release: (instance: CapabilityInstance) => Effect.Effect<void, unknown>;
export {};
```

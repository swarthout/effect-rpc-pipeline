# PipelineClient

Create a typed client from an Effect RPC group. Choose the transport and lifetime that fit the caller.

## Common tasks

| Task | API |
| --- | --- |
| Execute finite graphs over HTTP | `makeHttp` |
| Use a shared connection for calls, streams, and handles | `makeWebSocket` |
| Run through the server in the same process | `makeInProcess` |
| Provide a client as an Effect service | `layerClient*` helpers |
| Supply a custom transport | `make`, protocol helpers, `transportFromHandler` |

HTTP clients are reusable. WebSocket clients need an owning scope. In-process clients support finite graphs.

Import from `effect-rpc-pipeline/PipelineClient`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

## Complete signatures

These signatures come from the package declarations. Relative imports refer to other package modules.

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as RpcClient from "effect/rpc/RpcClient";
import { RpcClientError } from "effect/rpc/RpcClientError";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import type { ClientApi, PipelineRequest, PipelineTransport } from "./Pipeline.js";
import * as PipelineServer from "./PipelineServer.js";
/** The generated pipeline client type for an Effect RpcGroup. */
export type Client<Group extends RpcGroup.RpcGroup<any>> = ClientApi<RpcGroup.Rpcs<Group>>;
export type PipelineResponse = {
    readonly _tag: "Success";
    readonly value: unknown;
} | {
    readonly _tag: "Failure";
    readonly error: unknown;
};
export { type PipelineTransport };
/** Effect-native HTTP protocol using the platform HttpClient. */
export declare const layerProtocolHttp: (options: {
    readonly url: string;
    readonly transformClient?: <E, R>(client: import("effect/http/HttpClient").HttpClient.With<E, R>) => import("effect/http/HttpClient").HttpClient.With<E, R>;
    readonly batch?: {
        readonly window: import("effect/Duration").Input;
        readonly maxSize?: number | undefined;
    } | undefined;
}) => Layer.Layer<RpcClient.Protocol, never, RpcSerialization.RpcSerialization | import("effect/http/HttpClient").HttpClient>;
/** Effect-native HTTP protocol using globalThis.fetch. */
export declare const layerHttp: (options: Parameters<typeof RpcClient.layerProtocolHttp>[0]) => Layer.Layer<RpcClient.Protocol, never, RpcSerialization.RpcSerialization>;
/** Effect-native WebSocket protocol using an Effect Socket. */
export declare const layerProtocolWebSocket: (options?: {
    readonly pingInterval?: import("effect/Duration").Input | undefined;
    readonly pingTimeout?: import("effect/Duration").Input | undefined;
    readonly retryTransientErrors?: boolean | undefined;
    readonly retryPolicy?: import("effect/Schedule").Schedule<any, Socket.SocketError> | undefined;
    readonly onTransientError?: ((error: RpcClientError) => Effect.Effect<void>) | undefined;
    readonly onPingTimeout?: Effect.Effect<void> | undefined;
}) => Layer.Layer<RpcClient.Protocol, never, Socket.Socket | RpcSerialization.RpcSerialization>;
/** Effect-native WebSocket protocol using Socket.layerWebSocket. */
export declare const layerWebSocket: (options: {
    readonly url: string | Effect.Effect<string>;
    readonly openTimeout?: Parameters<typeof Socket.layerWebSocket>[1] extends infer O ? O extends {
        readonly openTimeout?: infer A;
    } ? A : never : never;
    readonly protocols?: string | Array<string>;
    readonly closeCodeIsError?: (code: number) => boolean;
    readonly retryTransientErrors?: boolean;
    readonly onTransientError?: (error: RpcClientError) => Effect.Effect<void>;
}) => Layer.Layer<RpcClient.Protocol, never, RpcSerialization.RpcSerialization | Socket.WebSocketConstructor>;
/**
 * Creates a reusable HTTP client facade. Each pipeline execution owns a fresh
 * internal scope; the returned facade itself is not scoped.
 */
export declare const makeHttp: <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, options: Parameters<typeof layerHttp>[0] & {
    readonly id?: string;
}) => Effect.Effect<ClientApi<Rpcs>, never, RpcSerialization.RpcSerialization | Rpc.MiddlewareClient<Rpcs>>;
/** Creates a WebSocket client whose connection and capabilities live in Scope. */
export declare const makeWebSocket: <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, options: Parameters<typeof layerWebSocket>[0] & {
    readonly id?: string;
}) => Effect.Effect<ClientApi<Rpcs>, never, RpcSerialization.RpcSerialization | Socket.WebSocketConstructor | Rpc.MiddlewareClient<Rpcs> | Scope.Scope>;
export interface InProcessOptions<M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []> {
    readonly id?: string;
    readonly middleware?: M;
    readonly limits?: PipelineServer.ServerOptions<M>["limits"];
}
/** Creates a transport-free client that runs the normal pipeline server locally. */
export declare const makeInProcess: <Rpcs extends Rpc.Any, const M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []>(group: RpcGroup.RpcGroup<Rpcs>, options?: InProcessOptions<M>) => Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs> | PipelineServer.Requirements<Rpcs> | PipelineServer.MiddlewaresRequirements<M>>;
type ClientService<I, Rpcs extends Rpc.Any> = Context.Key<I, ClientApi<Rpcs>>;
/** Provides a resource-safe HTTP pipeline client as an Effect service. */
export declare const layerClientHttp: <I, Rpcs extends Rpc.Any>(service: ClientService<I, Rpcs>, group: RpcGroup.RpcGroup<Rpcs>, options: Parameters<typeof layerHttp>[0] & {
    readonly id?: string;
}) => Layer.Layer<I, never, RpcSerialization.RpcSerialization | Rpc.MiddlewareClient<Rpcs>>;
/** Provides one scoped WebSocket connection as an Effect service. */
export declare const layerClientWebSocket: <I, Rpcs extends Rpc.Any>(service: ClientService<I, Rpcs>, group: RpcGroup.RpcGroup<Rpcs>, options: Parameters<typeof layerWebSocket>[0] & {
    readonly id?: string;
}) => Layer.Layer<I, never, RpcSerialization.RpcSerialization | Socket.WebSocketConstructor | Rpc.MiddlewareClient<Rpcs>>;
/** Provides an in-process pipeline client as an Effect service. */
export declare const layerClientInProcess: <I, Rpcs extends Rpc.Any, const M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []>(service: ClientService<I, Rpcs>, group: RpcGroup.RpcGroup<Rpcs>, options?: InProcessOptions<M>) => Layer.Layer<I, never, Rpc.MiddlewareClient<Rpcs> | PipelineServer.Requirements<Rpcs> | PipelineServer.MiddlewaresRequirements<M>>;
/** Creates a client using a supplied transport or the Effect-native Protocol service. */
export declare function make<Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, options: {
    readonly transport: PipelineTransport;
    readonly id?: string;
}): Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs>>;
export declare function make<Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, options?: {
    readonly id?: string;
}): Effect.Effect<ClientApi<Rpcs>, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope>;
export declare const transportFromHandler: (handler: (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown>) => PipelineTransport;
```

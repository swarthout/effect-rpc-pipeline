# PipelineServer

Serve pipeline requests or execute them directly in the same process.

## Common tasks

| Task | API |
| --- | --- |
| Install an HTTP route | `layerHttp` |
| Install a WebSocket route | `layerWebSocket` |
| Validate and execute a request directly | `handle` |
| Set work limits and middleware | `ServerOptions` |
| Wrap request, execution, or invocation work | `makeMiddleware` |

Adapter authors can use `augment`, `layer`, protocol schemas, and `PipelineRpc` for lower-level integration.

Import from `effect-rpc-pipeline/PipelineServer`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

## Complete signatures

These signatures come from the package declarations. Relative imports refer to other package modules.

```ts
import * as Effect from "effect/Effect";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import type * as RpcSerialization from "effect/rpc/RpcSerialization";
import type * as Headers from "effect/http/Headers";
import type * as HttpRouter from "effect/http/HttpRouter";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as Layer from "effect/Layer";
import * as Duplex from "./Duplex.js";
import { PipelineExecutionError, PipelineProtocolError, type Expr, type PipelineNode, type PipelineRequest } from "./Pipeline.js";
import type { PipelineResponse } from "./PipelineClient.js";
export { PipelineExecutionError, PipelineProtocolError };
export type RequestMetadata = {
    readonly client: Rpc.ServerClient;
    readonly requestId: unknown;
    readonly headers: Headers.Headers;
};
export type Requirements<R extends Rpc.Any> = Rpc.ToHandler<R> | Rpc.Middleware<R> | Rpc.ServicesServer<R>;
export interface RequestContext<R extends Rpc.Any = any> {
    /** Configured server definition, independent of untrusted request metadata. */
    readonly definitionId: string;
    readonly group: RpcGroup.RpcGroup<R>;
    readonly request: PipelineRequest;
    readonly metadata: RequestMetadata;
}
export interface ExecutionContext<R extends Rpc.Any = any> extends RequestContext<R> {
    readonly rpcTags: ReadonlyArray<string>;
}
export interface InvocationContext<R extends Rpc.Any = any> extends ExecutionContext<R> {
    readonly nodeId: string;
    readonly invocation: number;
    readonly kind: "root" | "capability";
    readonly rpc: Rpc.Any;
}
type Around<C, EX, RX> = <A, E, R>(effect: Effect.Effect<A, E, R>, context: C) => Effect.Effect<A, E | EX, R | RX>;
/** Advanced lifecycle middleware. Built-in integrations construct this value for normal use. */
export interface Middleware<EX = never, RX = never> {
    readonly request?: Around<RequestContext, EX, RX>;
    readonly execution?: Around<ExecutionContext, EX, RX>;
    readonly invocation?: Around<InvocationContext, EX, RX>;
}
export declare const makeMiddleware: <RX = never, EX = never>(middleware: Middleware<EX, RX>) => Middleware<EX, RX>;
export type MiddlewareRequirements<M> = M extends Middleware<any, infer R> ? R : never;
export type MiddlewaresRequirements<M extends ReadonlyArray<Middleware<any, any>>> = MiddlewareRequirements<M[number]>;
export interface ServerOptions<M extends ReadonlyArray<Middleware<any, any>> = readonly []> {
    readonly id?: string;
    readonly middleware?: M;
    readonly limits?: {
        readonly maxNodes?: number;
        readonly maxMapItems?: number;
        readonly maxInvocations?: number;
        readonly concurrency?: number;
        readonly maxDepth?: number;
        readonly maxExpressionNodes?: number;
        readonly maxExecutionSteps?: number;
    };
}
export declare const ExprSchema: Schema.Codec<Expr>;
export declare const PipelineNodeSchema: Schema.Codec<PipelineNode>;
export declare const PipelineRequestSchema: Schema.Codec<PipelineRequest>;
export declare const PipelineRpc: Rpc.Rpc<"__effect_rpc_pipeline_v1", Schema.declare<PipelineRequest, PipelineRequest>, Schema.Unknown, Schema.Unknown, never, never>;
/** Executes a pipeline using normal Effect RPC handlers and middleware from the environment. */
export declare const handle: <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(group: RpcGroup.RpcGroup<R>, request: PipelineRequest, options?: ServerOptions<M> & {
    readonly metadata?: RequestMetadata;
}) => Effect.Effect<PipelineResponse, never, Requirements<R> | MiddlewaresRequirements<M>>;
export declare const augment: <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>) => RpcGroup.RpcGroup<R | typeof PipelineRpc>;
export declare const augmentDuplex: <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>) => RpcGroup.RpcGroup<R | Rpc.Rpc<"__effect_rpc_pipeline_capability_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
    method: Schema.String;
    payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly value: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Unknown, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_release_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
}>, Schema.Void, Schema.Never, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_reply_v1", Schema.Struct<{
    sessionId: Schema.String;
    callId: Schema.String;
    exit: Schema.Struct<{
        readonly _tag: Schema.Union<readonly [Schema.Literal<"Success">, Schema.Literal<"Failure">]>;
        readonly value: Schema.optionalKey<Schema.Unknown>;
    }>;
}>, Schema.Void, typeof Duplex.DuplexError, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_session_v1", Schema.Struct<{
    sessionId: Schema.String;
}>, RpcSchema.Stream<Schema.Union<readonly [Schema.Struct<{
    readonly _tag: Schema.Literal<"Ready">;
    readonly sessionId: Schema.String;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Invoke">;
    readonly callId: Schema.String;
    readonly definitionId: Schema.String;
    readonly capabilityId: Schema.String;
    readonly method: Schema.String;
    readonly payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Cancel">;
    readonly callId: Schema.String;
}>]>, typeof Duplex.DuplexError>, Schema.Never, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_v1", Schema.declare<PipelineRequest, PipelineRequest>, Schema.Unknown, Schema.Unknown, never, never>>;
export declare const layer: <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(group: RpcGroup.RpcGroup<R>, options?: ServerOptions<M>) => Layer.Layer<Rpc.ToHandler<typeof PipelineRpc>, never, Requirements<R> | MiddlewaresRequirements<M>>;
export declare const layerHttp: <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(options: {
    readonly group: RpcGroup.RpcGroup<R>;
    readonly path: string;
} & ServerOptions<M>) => Layer.Layer<never, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>>;
/** Serves pipelines, standard streaming RPCs, and bidirectional capabilities over Effect's WebSocket transport. */
export declare const layerWebSocket: <R extends Rpc.Any, const M extends ReadonlyArray<Middleware<any, any>> = readonly []>(options: {
    readonly group: RpcGroup.RpcGroup<R>;
    readonly path: string;
} & ServerOptions<M>) => Layer.Layer<never, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter | Requirements<R> | MiddlewaresRequirements<M>>;
```

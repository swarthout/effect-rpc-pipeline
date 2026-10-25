# Auth

Extract redacted bearer credentials, provide native server/client middleware, and assert authentication coverage. The application owns token verification and authorization. BearerOptions.maxLength defaults to 8192 characters including the scheme.

Import from `effect-rpc-pipeline/Auth`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Headers from "effect/http/Headers";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type * as RpcMiddleware from "effect/rpc/RpcMiddleware";
export type UnauthorizedReason = "Missing" | "Malformed" | "TooLong";
export interface BearerOptions {
    readonly maxLength?: number;
}
/** Strictly extracts an RFC 6750 bearer credential and immediately redacts it. */
export declare const bearerToken: (headers: Headers.Headers | Readonly<Record<string, string | undefined>>, options?: BearerOptions) => Option.Option<Redacted.Redacted<string>>;
export interface BearerLayerOptions<PrincipalId, Principal, E, R> extends BearerOptions {
    readonly principal: Context.Key<PrincipalId, Principal>;
    readonly authenticate: (token: Redacted.Redacted<string>) => Effect.Effect<Principal, E, R>;
    readonly unauthorized: (reason: UnauthorizedReason) => E;
}
/** Builds a native RpcMiddleware service from an application-owned credential verifier. */
export declare const layerBearer: <MiddlewareId, PrincipalId, Principal, E, R>(middleware: Context.Key<MiddlewareId, RpcMiddleware.RpcMiddleware<PrincipalId, E, R>>, options: BearerLayerOptions<PrincipalId, Principal, E, R>) => Layer.Layer<MiddlewareId>;
export interface ClientBearerOptions<R> {
    /** Evaluated for every pipeline execution so refreshed credentials are observed. */
    readonly token: Effect.Effect<Option.Option<string | Redacted.Redacted<string>>, never, R>;
}
/**
 * Supplies required client middleware while allowing anonymous calls in a
 * mixed public/authenticated RpcGroup. `None` sends no credential; server
 * middleware remains the authority for protected invocations.
 */
export declare const layerClientBearer: <MiddlewareId, Service, R>(middleware: Context.Key<MiddlewareId, Service>, options: ClientBearerOptions<R>) => Layer.Layer<RpcMiddleware.ForClient<MiddlewareId>, never, R>;
declare const UncoveredRpcs_base: Schema.Class<UncoveredRpcs, Schema.TaggedStruct<"UncoveredRpcs", {
    readonly rpcs: Schema.$Array<Schema.String>;
}>, import("effect/Cause").YieldableError>;
export declare class UncoveredRpcs extends UncoveredRpcs_base {
}
export interface CoverageOptions {
    readonly public?: ReadonlyArray<string | Rpc.AnyWithProps>;
    readonly protectedBy: Context.Key<any, unknown> | ReadonlyArray<Context.Key<any, unknown>>;
}
/** Fails when an RPC is neither explicitly public nor protected by an expected middleware. */
export declare const assertCoverage: <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, options: CoverageOptions) => Effect.Effect<void, UncoveredRpcs>;
export {};
```

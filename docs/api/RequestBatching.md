# RequestBatching

Create request-local partitioned caches backed by native Effect RequestResolvers. Construct each cache descriptor once in a service. Pipeline execution supplies RequestScope; native standalone RPCs can use Middleware and layer. makeScope supports custom adapters.

Import from `effect-rpc-pipeline/RequestBatching`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

```ts
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import type * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import * as Semaphore from "effect/Semaphore";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
type AnyCache = Cache.Cache<any, any, any, any>;
type ScopeState = {
    readonly lock: Semaphore.Semaphore;
    readonly caches: WeakMap<object, MutableHashMap.MutableHashMap<unknown, AnyCache>>;
};
declare const RequestScope_base: Context.ServiceClass<RequestScope, "effect-rpc-pipeline/RequestScope", ScopeState>;
/** A resolver and cache boundary shared by every node in one RPC request. */
export declare class RequestScope extends RequestScope_base {
}
declare const Middleware_base: RpcMiddleware.ServiceClass<Middleware, "effect-rpc-pipeline/RequestBatching", RequestScope, import("effect/Schema").Never, never, never, false>;
/**
 * Standard Effect RPC middleware that supplies a request scope. Pipeline
 * execution already installs one around the complete graph, so every node
 * reuses the same scope.
 */
export declare class Middleware extends Middleware_base {
}
export declare const makeScope: () => RequestScope["Service"];
/** Server implementation for {@link Middleware}. */
export declare const layer: Layer.Layer<Middleware>;
export interface CacheOptions<A extends Request.Any, R = never> {
    readonly capacity: number;
    readonly timeToLive?: ((exit: Exit.Exit<Request.Success<A>, Request.Error<A>>, request: A) => Duration.Input) | undefined;
    /**
     * Further isolates a cache inside one pipeline, for example by tenant or
     * authenticated capability. The partition value uses Effect equality.
     */
    readonly partition?: Effect.Effect<unknown, never, R> | undefined;
}
/**
 * Lazily creates one native Effect Cache per request scope and partition.
 * Cache misses retain normal RequestResolver batching behavior.
 */
export declare function cache<A extends Request.Any, R = never>(resolver: RequestResolver.RequestResolver<A>, options: CacheOptions<A, R>): Effect.Effect<Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>, never, RequestScope | R>;
export declare function cache<A extends Request.Any, EX, RX, R = never>(resolver: Effect.Effect<RequestResolver.RequestResolver<A>, EX, RX>, options: CacheOptions<A, R>): Effect.Effect<Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>, EX, RequestScope | R | RX>;
export {};
```

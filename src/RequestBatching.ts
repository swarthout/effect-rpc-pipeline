import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as MutableHashMap from "effect/MutableHashMap"
import * as Option from "effect/Option"
import type * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"
import * as Semaphore from "effect/Semaphore"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"

type AnyCache = Cache.Cache<any, any, any, any>

type ScopeState = {
  readonly lock: Semaphore.Semaphore
  readonly caches: WeakMap<object, MutableHashMap.MutableHashMap<unknown, AnyCache>>
}

/** A resolver and cache boundary shared by every node in one RPC request. */
export class RequestScope extends Context.Service<RequestScope, ScopeState>()(
  "effect-rpc-pipeline/RequestScope"
) {}

/**
 * Standard Effect RPC middleware that supplies a request scope. Pipeline
 * execution already installs one around the complete graph, so every node
 * reuses the same scope.
 */
export class Middleware extends RpcMiddleware.Service<Middleware, {
  readonly provides: RequestScope
}>()("effect-rpc-pipeline/RequestBatching") {}

export const makeScope = (): RequestScope["Service"] => ({
  lock: Semaphore.makeUnsafe(1),
  caches: new WeakMap()
})

/** Server implementation for {@link Middleware}. */
export const layer: Layer.Layer<Middleware> = Layer.succeed(
  Middleware,
  ((effect: Effect.Effect<any, any, RequestScope>) => Effect.flatMap(
    Effect.serviceOption(RequestScope),
    Option.match({
      onNone: () => Effect.provideService(effect, RequestScope, makeScope()),
      onSome: (scope) => Effect.provideService(effect, RequestScope, scope)
    })
  )) as Middleware["Service"]
)

const cloneResolver = <A extends Request.Any>(
  resolver: RequestResolver.RequestResolver<A>
): RequestResolver.RequestResolver<A> => RequestResolver.makeWith({
  batchKey: (entry) => resolver.batchKey(entry),
  preCheck: resolver.preCheck,
  delay: resolver.delay,
  collectWhile: (entries) => resolver.collectWhile(entries),
  runAll: (entries, key) => resolver.runAll(entries, key)
})

export interface CacheOptions<A extends Request.Any, R = never> {
  readonly capacity: number
  readonly timeToLive?: ((exit: Exit.Exit<Request.Success<A>, Request.Error<A>>, request: A) => Duration.Input) | undefined
  /**
   * Further isolates a cache inside one pipeline, for example by tenant or
   * authenticated capability. The partition value uses Effect equality.
   */
  readonly partition?: Effect.Effect<unknown, never, R> | undefined
}

/**
 * Lazily creates one native Effect Cache per request scope and partition.
 * Cache misses retain normal RequestResolver batching behavior.
 */
export function cache<A extends Request.Any, R = never>(
  resolver: RequestResolver.RequestResolver<A>,
  options: CacheOptions<A, R>
): Effect.Effect<
  Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>,
  never,
  RequestScope | R
>
export function cache<A extends Request.Any, EX, RX, R = never>(
  resolver: Effect.Effect<RequestResolver.RequestResolver<A>, EX, RX>,
  options: CacheOptions<A, R>
): Effect.Effect<
  Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>,
  EX,
  RequestScope | R | RX
>
export function cache<A extends Request.Any, EX, RX, R = never>(
  resolver: RequestResolver.RequestResolver<A> | Effect.Effect<RequestResolver.RequestResolver<A>, EX, RX>,
  options: CacheOptions<A, R>
): Effect.Effect<
  Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>,
  EX,
  RequestScope | R | RX
> {
  const descriptor = {}
  const defaultPartition = {}
  return Effect.gen(function*() {
    const scope = yield* RequestScope
    const partition = options.partition === undefined ? defaultPartition : yield* options.partition
    return yield* scope.lock.withPermit(Effect.gen(function*() {
      let partitions = scope.caches.get(descriptor)
      if (partitions === undefined) {
        partitions = MutableHashMap.empty()
        scope.caches.set(descriptor, partitions)
      }
      const existing = MutableHashMap.get(partitions, partition)
      if (Option.isSome(existing)) {
        return existing.value as Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>
      }
      const baseResolver = Effect.isEffect(resolver) ? yield* resolver : resolver
      const scopedResolver = cloneResolver(baseResolver)
      const created = yield* RequestResolver.asCache(scopedResolver, {
        capacity: options.capacity,
        timeToLive: options.timeToLive,
        requireServicesAt: "lookup"
      })
      MutableHashMap.set(partitions, partition, created)
      return created
    }))
  }) as Effect.Effect<
    Cache.Cache<A, Request.Success<A>, Request.Error<A>, Request.Services<A>>,
    EX,
    RequestScope | R | RX
  >
}

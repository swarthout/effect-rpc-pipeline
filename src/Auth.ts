import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Headers from "effect/unstable/http/Headers"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import * as RpcMiddlewareRuntime from "effect/unstable/rpc/RpcMiddleware"

export type UnauthorizedReason = "Missing" | "Malformed" | "TooLong"

export interface BearerOptions {
  readonly maxLength?: number
}

const bearerPattern = /^[A-Za-z0-9._~+\/-]+=*$/

/** Strictly extracts an RFC 6750 bearer credential and immediately redacts it. */
export const bearerToken = (
  headers: Headers.Headers | Readonly<Record<string, string | undefined>>,
  options?: BearerOptions
): Option.Option<Redacted.Redacted<string>> => {
  const authorization = headers.authorization ?? Object.entries(headers).find(([name]) => name.toLowerCase() === "authorization")?.[1]
  const maxLength = options?.maxLength ?? 8192
  if (authorization === undefined || authorization.length > maxLength) return Option.none()
  const separator = authorization.indexOf(" ")
  if (separator < 0 || authorization.slice(0, separator).toLowerCase() !== "bearer") return Option.none()
  let start = separator
  while (authorization.charCodeAt(start) === 32) start++
  if (start === authorization.length) return Option.none()
  const credential = authorization.slice(start)
  return bearerPattern.test(credential) ? Option.some(Redacted.make(credential)) : Option.none()
}

export interface BearerLayerOptions<PrincipalId, Principal, E, R> extends BearerOptions {
  readonly principal: Context.Key<PrincipalId, Principal>
  readonly authenticate: (token: Redacted.Redacted<string>) => Effect.Effect<Principal, E, R>
  readonly unauthorized: (reason: UnauthorizedReason) => E
}

/** Builds a native RpcMiddleware service from an application-owned credential verifier. */
export const layerBearer = <MiddlewareId, PrincipalId, Principal, E, R>(
  middleware: Context.Key<MiddlewareId, RpcMiddleware.RpcMiddleware<PrincipalId, E, R>>,
  options: BearerLayerOptions<PrincipalId, Principal, E, R>
): Layer.Layer<MiddlewareId> => Layer.succeed(middleware, ((effect, { headers }) => {
  const authorization = headers.authorization
  const maxLength = options.maxLength ?? 8192
  const reason: UnauthorizedReason = authorization === undefined
    ? "Missing"
    : authorization.length > maxLength
      ? "TooLong"
      : "Malformed"
  return Option.match(bearerToken(headers, options), {
    onNone: () => Effect.fail(options.unauthorized(reason)),
    onSome: (token) => Effect.flatMap(
      options.authenticate(token),
      (principal) => Effect.provideService(effect, options.principal, principal)
    )
  })
}) as RpcMiddleware.RpcMiddleware<PrincipalId, E, R>)

export interface ClientBearerOptions<R> {
  /** Evaluated for every pipeline execution so refreshed credentials are observed. */
  readonly token: Effect.Effect<Option.Option<string | Redacted.Redacted<string>>, never, R>
}

/**
 * Supplies required client middleware while allowing anonymous calls in a
 * mixed public/authenticated RpcGroup. `None` sends no credential; server
 * middleware remains the authority for protected invocations.
 */
export const layerClientBearer = <MiddlewareId, Service, R>(
  middleware: Context.Key<MiddlewareId, Service>,
  options: ClientBearerOptions<R>
): Layer.Layer<RpcMiddleware.ForClient<MiddlewareId>, never, R> =>
  RpcMiddlewareRuntime.layerClient(middleware as any, ({ request, next }: any) =>
    Effect.flatMap(options.token, Option.match({
      onNone: () => next(request),
      onSome: (token) => next({
        ...request,
        headers: Headers.set(
          request.headers,
          "authorization",
          `Bearer ${Redacted.isRedacted(token) ? Redacted.value(token) : token}`
        )
      })
    }))) as any

export class UncoveredRpcs extends Schema.TaggedError<UncoveredRpcs>()("UncoveredRpcs", {
  rpcs: Schema.Array(Schema.String)
}) {}

export interface CoverageOptions {
  readonly public?: ReadonlyArray<string | Rpc.AnyWithProps>
  readonly protectedBy: Context.Key<any, unknown> | ReadonlyArray<Context.Key<any, unknown>>
}

/** Fails when an RPC is neither explicitly public nor protected by an expected middleware. */
export const assertCoverage = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: CoverageOptions
): Effect.Effect<void, UncoveredRpcs> => Effect.suspend(() => {
  const publicTags = new Set((options.public ?? []).map((rpc) => typeof rpc === "string" ? rpc : rpc._tag))
  const expected = Array.isArray(options.protectedBy) ? options.protectedBy : [options.protectedBy]
  const uncovered = [...group.requests.values()]
    .map((rpc) => rpc as unknown as Rpc.AnyWithProps)
    .filter((rpc) => !publicTags.has(rpc._tag) && !expected.some((middleware) => rpc.middlewares.has(middleware as any)))
    .map((rpc) => rpc._tag)
  return uncovered.length === 0 ? Effect.void : Effect.fail(new UncoveredRpcs({ rpcs: uncovered }))
})

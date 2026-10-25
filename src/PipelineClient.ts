import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Headers from "effect/http/Headers"
import type * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import * as RpcClient from "effect/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { RequestId } from "effect/rpc/RpcMessage"
import * as Socket from "effect/socket/Socket"
import type { ClientApi, PipelineRequest, PipelineTransport } from "./Pipeline.js"
import { makeClient } from "./Pipeline.js"
import * as Duplex from "./Duplex.js"
import * as PipelineServer from "./PipelineServer.js"

const { PipelineRpc } = PipelineServer

/** The generated pipeline client type for an Effect RpcGroup. */
export type Client<Group extends RpcGroup.RpcGroup<any>> = ClientApi<RpcGroup.Rpcs<Group>>

export type PipelineResponse =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly error: unknown }
export { type PipelineTransport }

const revive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    if (object._id === "effect-rpc-pipeline/Undefined") return undefined
    if (object._tag === "None" && object._id === "Option") return Option.none()
    if (object._tag === "Some" && object._id === "Option") return Option.some(revive(object.value))
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, revive(item)]))
  }
  return value
}

/** Effect-native HTTP protocol using the platform HttpClient. */
export const layerProtocolHttp = RpcClient.layerProtocolHttp

/** Effect-native HTTP protocol using globalThis.fetch. */
export const layerHttp = (options: Parameters<typeof RpcClient.layerProtocolHttp>[0]): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization
> => RpcClient.layerProtocolHttp(options).pipe(Layer.provide(FetchHttpClient.layer))

/** Effect-native WebSocket protocol using an Effect Socket. */
export const layerProtocolWebSocket = RpcClient.layerProtocolSocket

/** Effect-native WebSocket protocol using Socket.layerWebSocket. */
export const layerWebSocket = (options: {
  readonly url: string | Effect.Effect<string>
  readonly openTimeout?: Parameters<typeof Socket.layerWebSocket>[1] extends infer O ? O extends { readonly openTimeout?: infer A } ? A : never : never
  readonly protocols?: string | Array<string>
  readonly closeCodeIsError?: (code: number) => boolean
  readonly retryTransientErrors?: boolean
  readonly onTransientError?: (error: RpcClientError) => Effect.Effect<void>
}): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization | Socket.WebSocketConstructor
> => RpcClient.layerProtocolSocket({
  ...(options.retryTransientErrors === undefined ? {} : { retryTransientErrors: options.retryTransientErrors }),
  ...(options.onTransientError === undefined ? {} : { onTransientError: options.onTransientError })
}).pipe(
  Layer.provide(Socket.layerWebSocket(options.url, {
    ...(options.openTimeout === undefined ? {} : { openTimeout: options.openTimeout }),
    ...(options.protocols === undefined ? {} : { protocols: options.protocols }),
    ...(options.closeCodeIsError === undefined ? {} : { closeCodeIsError: options.closeCodeIsError })
  })),
  Layer.merge(Layer.succeed(Duplex.Enabled, true))
) as any

const applyClientMiddleware = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  services: Context.Context<Rpc.MiddlewareClient<Rpcs>>,
  request: PipelineRequest,
  headers: Headers.Headers,
  send: (headers: Headers.Headers) => Effect.Effect<PipelineResponse, unknown>
): Effect.Effect<PipelineResponse, unknown> => {
  const entries: Array<{ readonly rpc: Rpc.AnyWithProps; readonly middleware: RpcMiddleware.RpcMiddlewareClient<any, any, any> }> = []
  const seen = new Set<string>()
  for (const node of request.nodes) {
    if (node._tag !== "call" || node.target !== undefined) continue
    const rpc = group.requests.get(node.method) as Rpc.AnyWithProps | undefined
    if (!rpc) continue
    for (const service of rpc.middlewares) {
      if (seen.has(service.key)) continue
      const middleware = services.mapUnsafe.get(`${service.key}/Client`) as RpcMiddleware.RpcMiddlewareClient<any, any, any> | undefined
      if (!middleware) continue
      seen.add(service.key)
      entries.push({ rpc, middleware })
    }
  }
  const loop = (index: number, currentHeaders: Headers.Headers): Effect.Effect<PipelineResponse, unknown> => {
    if (index < 0) return send(currentHeaders)
    const entry = entries[index]!
    const syntheticRequest = {
      _tag: "Request",
      id: `pipeline-client/${index}`,
      tag: entry.rpc._tag,
      payload: request,
      headers: currentHeaders
    }
    return entry.middleware({
      rpc: entry.rpc,
      request: syntheticRequest as any,
      next: (nextRequest: any) => loop(index - 1, nextRequest.headers ?? currentHeaders) as any
    }) as unknown as Effect.Effect<PipelineResponse, unknown>
  }
  return loop(entries.length - 1, headers)
}

/** Creates a pipeline client directly from the same RpcGroup used by Effect RPC. */
const makeWithTransport = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  transport: PipelineTransport,
  id: string
): Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs>> => Effect.gen(function*() {
  const middlewareServices = yield* Effect.context<Rpc.MiddlewareClient<Rpcs>>()
  const execute = (request: PipelineRequest) => Effect.gen(function*() {
    const headers = yield* RpcClient.CurrentHeaders
    const response = yield* applyClientMiddleware(group, middlewareServices, request, headers, (headers) => transport(request, { headers }))
    return yield* response._tag === "Success"
      ? Effect.succeed(revive(response.value))
      : Effect.fail(revive(response.error))
  }).pipe(Effect.mapError((cause) => cause && typeof cause === "object" && "_tag" in cause
    ? cause
    : new RpcClientError({ reason: new RpcClientDefect({ message: "Pipeline request failed", cause }) })))
  return makeClient(group, id, execute)
})

const makeNativeResources = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  id: string,
  middlewareServices: Context.Context<Rpc.MiddlewareClient<Rpcs>>
) => Effect.gen(function*() {
  let requestSequence = 0
  const combined = group
    .add(PipelineRpc)
    .add(Duplex.SessionRpc)
    .add(Duplex.ReplyRpc)
    .add(Duplex.CallServerCapabilityRpc)
    .add(Duplex.ReleaseCapabilityRpc)
  const client = yield* RpcClient.make(combined, {
    generateRequestId: () => RequestId(`pipeline:${requestSequence++}`)
  })
  const duplexEnabled = yield* Duplex.Enabled
  const session = duplexEnabled ? yield* Duplex.makeClientSession(client as any) : undefined
  if (session !== undefined) yield* Effect.orDie(session.ready)
  const execute = (request: PipelineRequest) => Effect.gen(function*() {
    const headers = yield* RpcClient.CurrentHeaders
    const response = yield* applyClientMiddleware(
      group,
      middlewareServices,
      request,
      headers,
      (nextHeaders) => (client as any)[PipelineRpc._tag](request, { headers: nextHeaders }) as Effect.Effect<PipelineResponse, unknown>
    )
    return yield* response._tag === "Success"
      ? Effect.succeed(session?.decode(revive(response.value)) ?? revive(response.value))
      : Effect.fail(revive(response.error))
  }).pipe(Effect.mapError((cause) => cause && typeof cause === "object" && "_tag" in cause
    ? cause
    : new RpcClientError({ reason: new RpcClientDefect({ message: "Pipeline request failed", cause }) })))
  return {
    execute,
    streamClient: client as Record<string, (...args: ReadonlyArray<any>) => unknown>,
    ...(session === undefined ? {} : { encodeLiteral: session.encodeLiteral })
  }
})

const makeNative = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  id: string
): Effect.Effect<ClientApi<Rpcs>, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope> => Effect.gen(function*() {
  const middlewareServices = yield* Effect.context<Rpc.MiddlewareClient<Rpcs>>()
  const resources = yield* makeNativeResources(group, id, middlewareServices)
  return makeClient(group, id, resources.execute, {
    streamClient: resources.streamClient,
    ...("encodeLiteral" in resources ? { encodeLiteral: resources.encodeLiteral } : {})
  })
})

const makeResourceSafe = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  id: string,
  protocol: Layer.Layer<RpcClient.Protocol, never, any>
): Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs> | Exclude<Layer.Services<typeof protocol>, Scope.Scope>> => Effect.gen(function*() {
  const middlewareServices = yield* Effect.context<Rpc.MiddlewareClient<Rpcs>>()
  const serialization = yield* RpcSerialization.RpcSerialization
  const acquire = makeNativeResources(group, id, middlewareServices).pipe(
    Effect.provide(protocol),
    Effect.provideService(Duplex.Enabled, false),
    Effect.provideService(RpcSerialization.RpcSerialization, serialization)
  )
  const execute = (request: PipelineRequest) => Effect.scoped(Effect.flatMap(acquire, (resources) => resources.execute(request)))
  const streamClient = new Proxy({}, {
    get: (_target, property) => (...args: ReadonlyArray<any>) => Stream.unwrap(
      Effect.map(acquire, (resources) => (resources.streamClient as any)[property](...args))
    )
  }) as Record<string, (...args: ReadonlyArray<any>) => unknown>
  return makeClient(group, id, execute as any, { streamClient })
}) as any

/**
 * Creates a reusable HTTP client facade. Each pipeline execution owns a fresh
 * internal scope; the returned facade itself is not scoped.
 */
export const makeHttp = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: Parameters<typeof layerHttp>[0] & { readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>, never, RpcSerialization.RpcSerialization | Rpc.MiddlewareClient<Rpcs>> =>
  makeResourceSafe(group, options.id ?? "default", layerHttp(options)) as any

/** Creates a WebSocket client whose connection and capabilities live in Scope. */
export const makeWebSocket = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: Parameters<typeof layerWebSocket>[0] & { readonly id?: string }
): Effect.Effect<
  ClientApi<Rpcs>,
  never,
  RpcSerialization.RpcSerialization | Socket.WebSocketConstructor | Rpc.MiddlewareClient<Rpcs> | Scope.Scope
> => Effect.gen(function*() {
  const root = yield* Effect.context<
    RpcSerialization.RpcSerialization | Socket.WebSocketConstructor | Rpc.MiddlewareClient<Rpcs> | Scope.Scope
  >()
  const protocol = yield* Layer.build(layerWebSocket(options))
  return yield* makeNative(group, options.id ?? "default").pipe(
    Effect.provideContext(Context.merge(root, protocol) as any)
  )
}) as any

export interface InProcessOptions<M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []> {
  readonly id?: string
  readonly middleware?: M
  readonly limits?: PipelineServer.ServerOptions<M>["limits"]
}

/** Creates a transport-free client that runs the normal pipeline server locally. */
export const makeInProcess = <Rpcs extends Rpc.Any, const M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: InProcessOptions<M> = {}
): Effect.Effect<
  ClientApi<Rpcs>,
  never,
  Rpc.MiddlewareClient<Rpcs> | PipelineServer.Requirements<Rpcs> | PipelineServer.MiddlewaresRequirements<M>
> => Effect.gen(function*() {
  const context = yield* Effect.context<Rpc.MiddlewareClient<Rpcs> | PipelineServer.Requirements<Rpcs> | PipelineServer.MiddlewaresRequirements<M>>()
  let requestSequence = 0
  return yield* makeWithTransport(group, (request, transportOptions) => PipelineServer.handle(group, request, {
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.middleware === undefined ? {} : { middleware: options.middleware }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    metadata: {
      client: new Rpc.ServerClient(0),
      requestId: `in-process:${requestSequence++}`,
      headers: transportOptions?.headers ?? Headers.empty
    }
  }).pipe(Effect.provideContext(context as any)), options.id ?? "default").pipe(Effect.provideContext(context as any))
}) as any

type ClientService<I, Rpcs extends Rpc.Any> = Context.Key<I, ClientApi<Rpcs>>

/** Provides a resource-safe HTTP pipeline client as an Effect service. */
export const layerClientHttp = <I, Rpcs extends Rpc.Any>(
  service: ClientService<I, Rpcs>,
  group: RpcGroup.RpcGroup<Rpcs>,
  options: Parameters<typeof layerHttp>[0] & { readonly id?: string }
): Layer.Layer<I, never, RpcSerialization.RpcSerialization | Rpc.MiddlewareClient<Rpcs>> =>
  Layer.effect(service, makeHttp(group, options))

/** Provides one scoped WebSocket connection as an Effect service. */
export const layerClientWebSocket = <I, Rpcs extends Rpc.Any>(
  service: ClientService<I, Rpcs>,
  group: RpcGroup.RpcGroup<Rpcs>,
  options: Parameters<typeof layerWebSocket>[0] & { readonly id?: string }
): Layer.Layer<
  I,
  never,
  RpcSerialization.RpcSerialization | Socket.WebSocketConstructor | Rpc.MiddlewareClient<Rpcs>
> => Layer.effect(service, makeWebSocket(group, options))

/** Provides an in-process pipeline client as an Effect service. */
export const layerClientInProcess = <I, Rpcs extends Rpc.Any, const M extends ReadonlyArray<PipelineServer.Middleware<any, any>> = readonly []>(
  service: ClientService<I, Rpcs>,
  group: RpcGroup.RpcGroup<Rpcs>,
  options: InProcessOptions<M> = {}
): Layer.Layer<I, never, Rpc.MiddlewareClient<Rpcs> | PipelineServer.Requirements<Rpcs> | PipelineServer.MiddlewaresRequirements<M>> =>
  Layer.effect(service, makeInProcess(group, options))

/** Creates a client using a supplied transport or the Effect-native Protocol service. */
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { readonly transport: PipelineTransport; readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs>>
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: { readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope>
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: ({ readonly transport: PipelineTransport; readonly id?: string } | { readonly id?: string }) = {}
): Effect.Effect<ClientApi<Rpcs>, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope> {
  if ("transport" in options) return makeWithTransport(group, options.transport, options.id ?? "default")
  return makeNative(group, options.id ?? "default")
}

export const transportFromHandler = (handler: (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown>): PipelineTransport => handler as PipelineTransport

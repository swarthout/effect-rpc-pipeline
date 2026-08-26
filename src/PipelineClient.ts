import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as Headers from "effect/unstable/http/Headers"
import type * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/unstable/rpc/RpcClientError"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import { RequestId } from "effect/unstable/rpc/RpcMessage"
import * as Socket from "effect/unstable/socket/Socket"
import type { ClientApi, PipelineRequest, PipelineTransport } from "./Pipeline.js"
import { makeClient } from "./Pipeline.js"
import * as Duplex from "./Duplex.js"
import { PipelineRpc } from "./PipelineServer.js"

export type PipelineResponse =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly error: unknown }
export { type PipelineTransport }

const revive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    if (object._tag === "None" && (object._id === "Option" || Object.keys(object).length <= 2)) return Option.none()
    if (object._tag === "Some" && (object._id === "Option" || "value" in object)) return Option.some(revive(object.value))
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

const makeNative = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  id: string
): Effect.Effect<ClientApi<Rpcs>, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope> => Effect.gen(function*() {
  const middlewareServices = yield* Effect.context<Rpc.MiddlewareClient<Rpcs>>()
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
  return makeClient(group, id, execute, {
    streamClient: client as any,
    ...(session === undefined ? {} : { encodeLiteral: session.encodeLiteral })
  })
})

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

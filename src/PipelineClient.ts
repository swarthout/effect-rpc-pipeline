import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Headers from "effect/unstable/http/Headers"
import type * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/unstable/rpc/RpcClientError"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type { ClientApi, PipelineRequest, PipelineTransport } from "./Pipeline.js"
import { makeClient } from "./Pipeline.js"

export type PipelineResponse =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly error: unknown }
export { type PipelineTransport }

export class Protocol extends Context.Service<Protocol, PipelineTransport>()("effect-rpc-pipeline/Protocol") {}

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

const makeTransport = (url: string): PipelineTransport => (request, options) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...options?.headers, "content-type": "application/json" },
      body: JSON.stringify(request)
    })
    if (!response.ok) throw new Error(`Pipeline HTTP ${response.status}`)
    return await response.json() as PipelineResponse
  },
  catch: (error) => error
})

export const layerTransport = (transport: PipelineTransport): Layer.Layer<Protocol> => Layer.succeed(Protocol, transport)
export const layerHttp = (options: { readonly url: string }): Layer.Layer<Protocol> => layerTransport(makeTransport(options.url))

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

/** Creates a client using a supplied transport or the Effect-native Protocol service. */
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: ({ readonly transport: PipelineTransport } | { readonly url: string }) & { readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>, never, Rpc.MiddlewareClient<Rpcs>>
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: { readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>, never, Protocol | Rpc.MiddlewareClient<Rpcs>>
export function make<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: (({ readonly transport: PipelineTransport } | { readonly url: string }) & { readonly id?: string }) | { readonly id?: string } = {}
): Effect.Effect<ClientApi<Rpcs>, never, Protocol | Rpc.MiddlewareClient<Rpcs>> {
  if ("transport" in options) return makeWithTransport(group, options.transport, options.id ?? "default")
  if ("url" in options) return makeWithTransport(group, makeTransport(options.url), options.id ?? "default")
  return Effect.flatMap(Protocol, (transport) => makeWithTransport(group, transport, options.id ?? "default"))
}

export const transportFromHandler = (handler: (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown>): PipelineTransport => handler as PipelineTransport

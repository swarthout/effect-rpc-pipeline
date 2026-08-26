import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type { ClientApi, PipelineRequest, PipelineTransport } from "./Pipeline.js"
import { makeClient, PipelineClientError } from "./Pipeline.js"

export type PipelineResponse = { readonly value: unknown }
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

const makeTransport = (url: string): PipelineTransport => (request) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) })
    if (!response.ok) throw new Error(`Pipeline HTTP ${response.status}`)
    return await response.json() as PipelineResponse
  },
  catch: (error) => error
})

/** Creates a pipeline client directly from the same RpcGroup used by Effect RPC. */
export const make = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: ({ readonly transport: PipelineTransport } | { readonly url: string }) & { readonly id?: string }
): Effect.Effect<ClientApi<Rpcs>> => {
  const transport = "transport" in options ? options.transport : makeTransport(options.url)
  const execute = (request: PipelineRequest) => transport(request).pipe(
    Effect.map((response) => revive(response.value)),
    Effect.mapError((cause) => cause instanceof PipelineClientError ? cause : new PipelineClientError("Pipeline request failed", cause))
  )
  return Effect.succeed(makeClient(group, options.id ?? "default", execute))
}

export const transportFromHandler = (handler: (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown>): PipelineTransport => handler as PipelineTransport

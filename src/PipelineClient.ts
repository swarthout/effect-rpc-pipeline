import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { ClientApi, PipelineDefinition, PipelineRequest, Resolved, RunnableClient } from "./Pipeline.js"
import { PipelineClientTypeId, requestFrom } from "./Pipeline.js"

export type PipelineResponse = { readonly value: unknown }
export type PipelineTransport = (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown, never>

type RpcsOf<D> = D extends PipelineDefinition<infer Rpcs> ? Rpcs : never

export type Client<D extends PipelineDefinition = PipelineDefinition> = RunnableClient<D> & {
  readonly definition: D
  /** @deprecated Use Pipeline.resolve(client, builder). */
  readonly execute: <A>(builder: (api: ClientApi<RpcsOf<D>>) => A) => Effect.Effect<Resolved<A>, unknown, never>
}

const makeTransport = (url: string): PipelineTransport => (request) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      })
      if (!response.ok) throw new Error(`Pipeline HTTP ${response.status}`)
      return await response.json() as PipelineResponse
    },
    catch: (error) => error
  })

export const make = <D extends PipelineDefinition>(
  definition: D,
  options: { readonly transport: PipelineTransport } | { readonly url: string }
): Effect.Effect<Client<D>> => {
  const transport = "transport" in options ? options.transport : makeTransport(options.url)
  const executeRequest = (request: PipelineRequest) => transport(request).pipe(Effect.map((response) => response.value))
  return Effect.succeed({
    definition,
    [PipelineClientTypeId]: { execute: executeRequest },
    execute: <A>(builder: (api: ClientApi<RpcsOf<D>>) => A) =>
      Effect.try({ try: () => requestFrom(definition, builder), catch: (error) => error }).pipe(
        Effect.flatMap(executeRequest),
        Effect.map((value) => value as Resolved<A>)
      ) as Effect.Effect<Resolved<A>, unknown, never>
  })
}

export const transportFromHandler = <D extends PipelineDefinition>(
  handler: (request: PipelineRequest) => Effect.Effect<PipelineResponse, unknown>
): PipelineTransport => handler as PipelineTransport

export { Option }

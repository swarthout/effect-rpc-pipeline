import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import { AppRpcs, type BlogEvent } from "../../shared/contracts.js"
import { makeEvents } from "../events.js"
import { makeTokenServiceLayer } from "../security.js"
import { makeAdminHandlers } from "./admin.js"
import { makeContentHandlers } from "./content.js"
import { makePublicHandlers } from "./public.js"

export const makeApplicationLayer = Effect.fn("makeApplicationLayer")(function*(changes: PubSub.PubSub<BlogEvent>) {
  const events = makeEvents(changes)
  const handlers = AppRpcs.of({
    ...(yield* makePublicHandlers(changes)),
    ...(yield* makeContentHandlers(events)),
    ...(yield* makeAdminHandlers(events))
  })
  return Layer.mergeAll(Layer.effectContext(AppRpcs.toHandlers(handlers)), RequestBatching.layer)
})

export { makeTokenServiceLayer }

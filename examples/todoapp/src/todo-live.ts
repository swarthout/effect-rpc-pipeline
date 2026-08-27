import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"
import { AccessTokenVerifierLive, AuthenticatedLive } from "./todo-auth.js"
import { AppRpcs, Authenticated, HealthRpc, makeTodoHandlers, makeTodoStore, type TodoChange } from "./todo.js"

/**
 * Native Effect RPC routes. POST /rpc serves finite HTTP pipelines and
 * GET /rpc upgrades to a persistent WebSocket for streams and capabilities.
 */
export const TodoLiveRoutes = Layer.unwrap(Effect.gen(function*() {
  yield* PipelineAuth.assertCoverage(AppRpcs, { public: [HealthRpc], protectedBy: Authenticated }).pipe(Effect.orDie)
  const changes = yield* PubSub.unbounded<TodoChange>()
  const handlers = Layer.effectContext(AppRpcs.toHandlers(makeTodoHandlers(makeTodoStore(), changes))).pipe(
    Layer.provide(AccessTokenVerifierLive)
  )
  const services = Layer.merge(Layer.merge(handlers, AuthenticatedLive), AccessTokenVerifierLive)
  const telemetry = PipelineTelemetry.make({ metrics: { prefix: "todo_rpc" } })
  return Layer.merge(
    PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc", id: "todo-mvc", middleware: [telemetry] }),
    PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc", id: "todo-mvc", middleware: [telemetry] })
  ).pipe(Layer.provide(services))
}))

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { makeTodoHandlers, makeTodoStore, TodoRpcs } from "./todo.js"

/**
 * Native Effect RPC routes. POST /rpc serves finite HTTP pipelines and
 * GET /rpc upgrades to a persistent WebSocket for streams and capabilities.
 */
export const TodoLiveRoutes = Layer.unwrap(Effect.map(PubSub.unbounded<"created" | "updated" | "deleted" | "reset">(), (changes) => {
  const handlers = Layer.effectContext(TodoRpcs.toHandlers(makeTodoHandlers(makeTodoStore(), changes)))
  return Layer.merge(
    PipelineServer.layerHttp({ group: TodoRpcs, path: "/rpc", id: "todo-mvc" }),
    PipelineServer.layerWebSocket({ group: TodoRpcs, path: "/rpc", id: "todo-mvc" })
  ).pipe(Layer.provide(handlers))
}))

import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Socket from "effect/unstable/socket/Socket"
import { makeLiveTodoClient } from "./todo-client.js"

const program = Effect.scoped(Effect.gen(function*() {
  const todos = yield* makeLiveTodoClient()
  const events = yield* todos.watch().pipe(
    Stream.runForEach((event) => Effect.log("todo update", event)),
    Effect.forkScoped
  )

  yield* todos.add("Learn Effect WebSockets")
  yield* todos.add("Ship live TodoMVC")
  yield* Effect.sleep("500 millis")
  yield* Fiber.interrupt(events)
})).pipe(
  Effect.provide(PipelineClient.layerWebSocket({ url: "ws://127.0.0.1:8787/rpc" })),
  Effect.provide(RpcSerialization.layerJson),
  Effect.provide(Socket.layerWebSocketConstructorGlobal)
)

Effect.runPromise(program)

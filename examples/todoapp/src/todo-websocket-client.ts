import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Socket from "effect/unstable/socket/Socket"
import { makeLiveTodoClient } from "./todo-client.js"
import { makeAccessToken } from "./todo-auth.js"

const program = Effect.scoped(Effect.gen(function*() {
  const token = yield* Effect.promise(() => makeAccessToken({ id: "user-1", name: "Ada" }))
  const todos = yield* makeLiveTodoClient(token)
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

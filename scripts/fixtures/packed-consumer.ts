import assert from "node:assert/strict"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { Duplex, Pipeline, PipelineClient, PipelineServer } from "effect-rpc-pipeline"

const Rpcs = RpcGroup.make(
  Rpc.make("numbers", { success: Schema.Array(Schema.Number) }),
  Rpc.make("double", { payload: { value: Schema.Number }, success: Schema.Number }),
  Rpc.make("unit", { success: Schema.Void }),
  Rpc.make("option", { success: Schema.Option(Schema.String) }),
  Rpc.make("events", { success: Schema.String, stream: true })
)
const Handlers = Rpcs.toLayer({
  numbers: () => Effect.succeed([1, 2]),
  double: ({ value }) => Effect.succeed(value * 2),
  unit: () => Effect.void,
  option: () => Effect.succeed(Option.some("value")),
  events: () => Stream.make("ready")
})

await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const Routes = Layer.merge(
    PipelineServer.layerHttp({ group: Rpcs, path: "/rpc" }),
    PipelineServer.layerWebSocket({ group: Rpcs, path: "/rpc" })
  ).pipe(Layer.provide(Handlers), Layer.provide(RpcSerialization.layerJson))
  const Server = HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" }))
  )
  const context = yield* Layer.build(Server)
  const server = Context.get(context, HttpServer.HttpServer)
  if (server.address._tag === "UnixPathAddress") throw new Error("Expected TCP server")
  const http = yield* PipelineClient.makeHttp(Rpcs, { url: `http://127.0.0.1:${server.address.port}/rpc` })
  assert.deepEqual(yield* Pipeline.map(http.numbers(), (value) => http.double({ value: http.double({ value }) })), [4, 8])
  assert.deepEqual(yield* Pipeline.all({ unit: http.unit(), array: [http.unit()], option: http.option() }), { unit: undefined, array: [undefined], option: Option.some("value") })
  const ws = yield* PipelineClient.makeWebSocket(Rpcs, { url: `ws://127.0.0.1:${server.address.port}/rpc` })
  assert.equal(yield* ws.double({ value: 21 }), 42)
  assert.deepEqual(yield* Stream.runCollect(ws.events()), ["ready"])
})).pipe(
  // An ambient WebSocket protocol must not turn HTTP resource acquisition into
  // a duplex handshake on an HTTP-only endpoint.
  Effect.provideService(Duplex.Enabled, true),
  Effect.provide(RpcSerialization.layerJson), Effect.provide(Socket.layerWebSocketConstructorGlobal)
))

console.log("Packed consumer: HTTP graph, undefined/Options, WebSocket and stream passed")

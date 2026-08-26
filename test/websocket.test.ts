import { NodeHttpServer } from "@effect/platform-node"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Socket from "effect/unstable/socket/Socket"
import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

describe("native Effect WebSocket transport", () => {
  it("runs pipelines, streams, and typed callbacks over one connection", async () => {
    const ApprovalRpcs = RpcGroup.make(Rpc.make("approve", {
      payload: { title: Schema.String },
      success: Schema.Boolean
    }))
    const Approval = Capability.make("websocket/Approval", ApprovalRpcs)
    const AuthedRpcs = RpcGroup.make(Rpc.make("currentUser", { success: Schema.String }))
    const AuthedApi = Capability.make("websocket/AuthedApi", AuthedRpcs)
    const App = RpcGroup.make(
      Rpc.make("add", { payload: { title: Schema.String }, success: Schema.Number }),
      Rpc.make("list", { success: Schema.Array(Schema.String) }),
      Rpc.make("watch", { success: Schema.String, stream: true }),
      Rpc.make("confirmAdd", {
        payload: { title: Schema.String, approval: Approval.schema },
        success: Schema.Boolean,
        error: Schema.Union([Capability.CapabilityUnavailable, Capability.CapabilityTransportError])
      }),
      Rpc.make("authenticate", {
        payload: { token: Schema.String },
        success: AuthedApi.schema
      })
    )

    const program = Effect.scoped(Effect.gen(function*() {
      const values: Array<string> = []
      const changes = yield* PubSub.unbounded<string>()
      const subscribed = yield* Deferred.make<void>()
      const handlers = App.of({
        add: ({ title }) => Effect.gen(function*() {
          values.push(title)
          yield* PubSub.publish(changes, title)
          return values.length
        }),
        list: () => Effect.sync(() => [...values]),
        watch: () => Stream.unwrap(Effect.as(Deferred.succeed(subscribed, undefined), Stream.fromPubSub(changes))),
        confirmAdd: ({ title, approval }) => approval.approve({ title }),
        authenticate: ({ token }) => AuthedApi.fromHandlers({
          currentUser: () => Effect.succeed(token === "secret" ? "user-1" : "guest")
        })
      })
      const HandlerLive = Layer.effectContext(App.toHandlers(handlers) as Effect.Effect<Context.Context<any>>)
      const Routes = Layer.merge(
        PipelineServer.layerHttp({ group: App, path: "/rpc", id: "ws-test" }),
        PipelineServer.layerWebSocket({ group: App, path: "/rpc", id: "ws-test" })
      )
      const ServerLive = HttpRouter.serve(Routes, {
        disableLogger: true,
        disableListenLog: true
      }).pipe(
        Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
        Layer.provide(HandlerLive),
        Layer.provide(RpcSerialization.layerJson)
      )
      const serverContext = yield* Layer.build(ServerLive as Layer.Layer<HttpServer.HttpServer, unknown>)
      const server = Context.get(serverContext, HttpServer.HttpServer)
      if (server.address._tag !== "TcpAddress") return yield* Effect.die("Expected TCP test server")
      const httpUrl = `http://127.0.0.1:${server.address.port}/rpc`
      const url = `ws://127.0.0.1:${server.address.port}/rpc`

      const httpInitial = yield* Effect.scoped(Effect.gen(function*() {
        const httpClient = yield* PipelineClient.make(App, { id: "ws-test" })
        return yield* httpClient.list()
      })).pipe(
        Effect.provide(PipelineClient.layerHttp({ url: httpUrl })),
        Effect.provide(RpcSerialization.layerJson)
      )

      return yield* Effect.gen(function*() {
        const client = yield* PipelineClient.make(App, { id: "ws-test" })
        const initial = yield* client.list()

        const watched = yield* client.watch().pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        yield* Deferred.await(subscribed)
        const state = yield* client.add({ title: "one" }).pipe(
          Pipeline.andThen((count) => ({ count, values: client.list() }))
        )
        const events = Array.from(yield* Fiber.join(watched))

        const approval = yield* Approval.fromHandlers({
          approve: ({ title }) => Effect.succeed(title !== "blocked")
        })
        const accepted = yield* client.confirmAdd({ title: "two", approval })
        const rejected = yield* client.confirmAdd({ title: "blocked", approval })
        const authed = yield* client.authenticate({ token: "secret" })
        const currentUser = yield* authed.currentUser()
        return { httpInitial, initial, state, events, accepted, rejected, currentUser }
      }).pipe(
        Effect.provide(PipelineClient.layerWebSocket({ url })),
        Effect.provide(RpcSerialization.layerJson),
        Effect.provide(Socket.layerWebSocketConstructorGlobal)
      )
    }))

    const result = await Effect.runPromise(program)
    expect(result).toEqual({
      httpInitial: [],
      initial: [],
      state: { count: 1, values: ["one"] },
      events: ["one"],
      accepted: true,
      rejected: false,
      currentUser: "user-1"
    })
  }, 20_000)
})

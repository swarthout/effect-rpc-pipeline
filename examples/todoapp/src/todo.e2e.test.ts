import { NodeHttpServer } from "@effect/platform-node"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Socket from "effect/unstable/socket/Socket"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer } from "node:http"
import { createTodoHttpServer } from "./todo-server.js"
import { makeLiveTodoClient, makeTodoClient } from "./todo-client.js"
import type { TodoClient } from "./todo-client.js"
import type { Server } from "node:http"
import { TodoLiveRoutes } from "./todo-live.js"

describe("TodoMVC end-to-end", () => {
  let server: Server
  let client: TodoClient
  let requestCount: () => number
  beforeAll(async () => {
    const app = createTodoHttpServer()
    server = app.server
    requestCount = app.requestCount
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Server did not expose a port")
    client = await Effect.runPromise(makeTodoClient(`http://127.0.0.1:${address.port}/rpc`))
  })
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) })

  it("supports the complete TodoMVC workflow", async () => {
    const startRequests = requestCount()
    let state = await Effect.runPromise(client.snapshot())
    expect(requestCount() - startRequests).toBe(1)
    expect(state.todos).toEqual([])
    expect(state.remaining).toBe(0)

    const beforeAdd = requestCount()
    state = await Effect.runPromise(client.add("  Learn Effect  "))
    expect(requestCount() - beforeAdd).toBe(1)
    const learn = state.todos[0]!
    expect(learn.title).toBe("Learn Effect")
    expect(state.remaining).toBe(1)

    state = await Effect.runPromise(client.add("Ship pipeline"))
    const ship = state.todos.find((todo) => todo.title === "Ship pipeline")!
    expect(state.todos).toHaveLength(2)

    const beforeToggle = requestCount()
    state = await Effect.runPromise(client.toggle(learn))
    expect(requestCount() - beforeToggle).toBe(1)
    expect(state.todos.find((todo) => todo.id === learn.id)?.completed).toBe(true)
    expect(state.remaining).toBe(1)

    state = await Effect.runPromise(client.snapshot("completed"))
    expect(state.todos.map((todo) => todo.title)).toEqual(["Learn Effect"])
    state = await Effect.runPromise(client.snapshot("active"))
    expect(state.todos.map((todo) => todo.title)).toEqual(["Ship pipeline"])

    state = await Effect.runPromise(client.edit(ship, "Ship pipelined TodoMVC"))
    expect(state.todos.map((todo) => todo.title)).toContain("Ship pipelined TodoMVC")

    state = await Effect.runPromise(client.toggleAll(true))
    expect(state.todos.every((todo) => todo.completed)).toBe(true)
    expect(state.remaining).toBe(0)

    state = await Effect.runPromise(client.clearCompleted())
    expect(state.todos).toEqual([])

    state = await Effect.runPromise(client.add("Keep me"))
    const keep = state.todos[0]!
    state = await Effect.runPromise(client.remove(keep))
    expect(state.todos).toEqual([])
  })

  it("rejects blank titles and reports missing todos", async () => {
    const invalid = await Effect.runPromise(Effect.flip(client.add("   ")))
    expect(invalid).toMatchObject({ _tag: "InvalidTodoTitle", title: "   " })
    const before = await Effect.runPromise(client.snapshot())
    const state = await Effect.runPromise(client.remove({ id: "missing" }))
    expect(state.todos).toEqual(before.todos)
  })

  it("streams TodoMVC changes over the native WebSocket transport", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const ServerLive = HttpRouter.serve(TodoLiveRoutes, {
        disableLogger: true,
        disableListenLog: true
      }).pipe(
        Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
        Layer.provide(RpcSerialization.layerJson)
      )
      const serverContext = yield* Layer.build(ServerLive as Layer.Layer<HttpServer.HttpServer, unknown>)
      const liveServer = Context.get(serverContext, HttpServer.HttpServer)
      if (liveServer.address._tag !== "TcpAddress") return yield* Effect.die("Expected TCP test server")
      const url = `ws://127.0.0.1:${liveServer.address.port}/rpc`

      return yield* Effect.gen(function*() {
        const todos = yield* makeLiveTodoClient()
        const events = yield* Queue.unbounded<unknown>()
        yield* todos.watch().pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped
        )
        const initial = yield* Queue.take(events)
        yield* todos.add("Live update")
        const changed = yield* Queue.take(events)
        return { initial, changed }
      }).pipe(
        Effect.provide(PipelineClient.layerWebSocket({ url })),
        Effect.provide(RpcSerialization.layerJson),
        Effect.provide(Socket.layerWebSocketConstructorGlobal)
      )
    })))

    expect(result.initial).toMatchObject({ version: 0, kind: "reset", todos: [] })
    expect(result.changed).toMatchObject({ version: 1, kind: "created" })
  }, 20_000)
})

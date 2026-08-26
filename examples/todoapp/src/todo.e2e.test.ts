import * as Effect from "effect/Effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTodoHttpServer } from "./todo-server.js"
import { makeTodoClient } from "./todo-client.js"
import type { TodoClient } from "./todo-client.js"
import type { Server } from "node:http"

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
})

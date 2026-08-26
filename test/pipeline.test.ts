import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { describe, expect, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

const App = RpcGroup.make(
  Rpc.make("people.greet", { payload: { name: Schema.String }, success: Schema.String }),
  Rpc.make("people.ids", { success: Schema.Array(Schema.String) })
)
const Definition = Pipeline.make({ id: "test", root: App })

const contextFor = async () => Effect.runPromise(App.toHandlers({
  "people.greet": ({ name }) => Effect.succeed(`Hello ${name}`),
  "people.ids": () => Effect.succeed(["a", "b", "c"])
}))

describe("pipeline recorder and interpreter", () => {
  it("records dependent calls and evaluates a single transport request", async () => {
    const context = await contextFor()
    let requests = 0
    const client = await Effect.runPromise(PipelineClient.make(Definition, {
      transport: (request) => {
        requests++
        return PipelineServer.handle(Definition, request, context)
      }
    }))
    const result = await Effect.runPromise(Pipeline.resolve(client, (rpc) => {
      const ids = rpc.people.ids()
      return ids.map((id) => ({ id, greeting: rpc.people.greet({ name: id }) }))
    }))
    expect(requests).toBe(1)
    expect(result).toEqual([
      { id: "a", greeting: "Hello a" },
      { id: "b", greeting: "Hello b" },
      { id: "c", greeting: "Hello c" }
    ])
  })

  it("supports explicit ordering and rejects orphan calls", () => {
    expect(() => Pipeline.requestFrom(Definition, (api) => {
      api.people.greet({ name: "orphan" })
      return api.people.ids()
    })).toThrow(/Unreachable/)
  })

  it("uses generator yields for ordering and Pipeline.all for parallel siblings", async () => {
    const Ordered = RpcGroup.make(
      Rpc.make("todos.add", { payload: { title: Schema.String }, success: Schema.String }),
      Rpc.make("todos.list", { success: Schema.Array(Schema.String) }),
      Rpc.make("todos.count", { success: Schema.Number })
    )
    const definition = Pipeline.make({ id: "ordered", root: Ordered })
    const values: string[] = []
    const context = await Effect.runPromise(Ordered.toHandlers({
      "todos.add": ({ title }) => Effect.sync(() => { values.push(title); return title }),
      "todos.list": () => Effect.sync(() => [...values]),
      "todos.count": () => Effect.sync(() => values.length)
    }))
    let captured: Pipeline.PipelineRequest | undefined
    const client = await Effect.runPromise(PipelineClient.make(definition, {
      transport: (request) => {
        captured = request
        return PipelineServer.handle(definition, request, context)
      }
    }))

    const result = await Effect.runPromise(Pipeline.run(client, function* (rpc) {
      yield* rpc.todos.add({ title: "one" })
      return yield* Pipeline.all({
        todos: rpc.todos.list(),
        count: rpc.todos.count()
      })
    }))

    expect(result).toEqual({ todos: ["one"], count: 1 })
    expect(captured?.nodes).toHaveLength(3)
    expect(captured?.nodes[1]?.dependencies).toEqual(["$0"])
    expect(captured?.nodes[2]?.dependencies).toEqual(["$0"])
  })

  it("executes yielded operations even when they are not part of the returned value", async () => {
    const Commands = RpcGroup.make(Rpc.make("commands.record", {
      payload: { value: Schema.String },
      success: Schema.Void
    }))
    const definition = Pipeline.make({ id: "commands", root: Commands })
    const recorded: string[] = []
    const context = await Effect.runPromise(Commands.toHandlers({
      "commands.record": ({ value }) => Effect.sync(() => { recorded.push(value) })
    }))
    const client = await Effect.runPromise(PipelineClient.make(definition, {
      transport: (request) => PipelineServer.handle(definition, request, context)
    }))

    const result = await Effect.runPromise(Pipeline.run(client, function* (rpc) {
      yield* rpc.commands.record({ value: "kept" })
      return { ok: true }
    }))

    expect(result).toEqual({ ok: true })
    expect(recorded).toEqual(["kept"])
  })

  it("runs independent ready nodes concurrently", async () => {
    const Parallel = RpcGroup.make(
      Rpc.make("work.left", { success: Schema.String }),
      Rpc.make("work.right", { success: Schema.String })
    )
    const definition = Pipeline.make({ id: "parallel", root: Parallel })
    let active = 0
    let maximum = 0
    const work = (value: string) => Effect.gen(function*() {
      yield* Effect.sync(() => { active++; maximum = Math.max(maximum, active) })
      yield* Effect.sleep("5 millis")
      yield* Effect.sync(() => { active-- })
      return value
    })
    const context = await Effect.runPromise(Parallel.toHandlers({
      "work.left": () => work("left"),
      "work.right": () => work("right")
    }))
    const client = await Effect.runPromise(PipelineClient.make(definition, {
      transport: (request) => PipelineServer.handle(definition, request, context)
    }))

    const result = await Effect.runPromise(Pipeline.resolve(client, (rpc) => ({
      left: rpc.work.left(),
      right: rpc.work.right()
    })))

    expect(result).toEqual({ left: "left", right: "right" })
    expect(maximum).toBe(2)
  })

  it("rejects duplicate node identifiers before execution", async () => {
    const context = await contextFor()
    const request = Pipeline.requestFrom(Definition, (rpc) => rpc.people.ids())
    const duplicated = { ...request, nodes: [...request.nodes, request.nodes[0]!] }
    await expect(Effect.runPromise(PipelineServer.handle(Definition, duplicated, context))).rejects.toThrow(/Duplicate/)
  })

  it("maps Effect Options", async () => {
    const OptionApp = RpcGroup.make(Rpc.make("value", { success: Schema.Option(Schema.String) }))
    const definition = Pipeline.make({ id: "option", root: OptionApp })
    const context = await Effect.runPromise(OptionApp.toHandlers({ value: () => Effect.succeed(Option.some("x")) }))
    const client = await Effect.runPromise(PipelineClient.make(definition, { transport: (request) => PipelineServer.handle(definition, request, context) }))
    const result = await Effect.runPromise(Pipeline.resolve(client, (rpc) => rpc.value().map(() => rpc.value())))
    expect(result).toEqual(Option.some(Option.some("x")))
  })
})

describe("capability descriptors", () => {
  it("creates a batch-local capability value", () => {
    const Group = RpcGroup.make(Rpc.make("ping", { success: Schema.String }))
    const descriptor = Capability.make("Ping", Group)
    const instance = descriptor.of({ ping: () => Effect.succeed("pong") })
    expect(Capability.isInstance(instance)).toBe(true)
    expect(instance.capabilityId).toBe("Ping")
  })

  it("pipelines calls through a returned capability", async () => {
    const Group = RpcGroup.make(Rpc.make("ping", { success: Schema.String }))
    const descriptor = Capability.make("Ping", Group)
    const Root = RpcGroup.make(Rpc.make("cap", { success: descriptor.schema }))
    const definition = Pipeline.make({ id: "capability", root: Root, capabilities: [descriptor] })
    const context = await Effect.runPromise(Root.toHandlers({ cap: () => Effect.succeed(descriptor.of({ ping: () => Effect.succeed("pong") })) }))
    const client = await Effect.runPromise(PipelineClient.make(definition, { transport: (request) => PipelineServer.handle(definition, request, context) }))
    const result = await Effect.runPromise(Pipeline.resolve(client, (rpc) => rpc.cap().ping()))
    expect(result).toBe("pong")
  })
})

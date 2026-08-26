import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import { describe, expect, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

const local = async <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, handlers: any, id = "default") => {
  const context = await Effect.runPromise(group.toHandlers(handlers) as Effect.Effect<any>)
  let requests = 0
  let last: Pipeline.PipelineRequest | undefined
  const client = await Effect.runPromise(PipelineClient.make(group, { id, transport: (request) => {
    requests++
    last = request
    return PipelineServer.handle(group, request, context, { id })
  } }))
  return { client, requests: () => requests, last: () => last }
}

describe("Effect-native pipeline client", () => {
  it("keeps exact tags and makes every call a yieldable Effect", async () => {
    const App = RpcGroup.make(Rpc.make("people.greet", { payload: { name: Schema.String }, success: Schema.String }))
    const { client, requests } = await local(App, { "people.greet": ({ name }: { name: string }) => Effect.succeed(`Hello ${name}`) })
    const result = await Effect.runPromise(Effect.gen(function*() { return yield* client["people.greet"]({ name: "Ada" }) }))
    expect(result).toBe("Hello Ada")
    expect(requests()).toBe(1)
    expect((client as any).people).toBeUndefined()
  })

  it("batches independent calls", async () => {
    const App = RpcGroup.make(Rpc.make("left", { success: Schema.String }), Rpc.make("right", { success: Schema.Number }))
    const { client, requests } = await local(App, { left: () => Effect.succeed("L"), right: () => Effect.succeed(2) })
    expect(await Effect.runPromise(Pipeline.all({ left: client.left(), right: client.right() }))).toEqual({ left: "L", right: 2 })
    expect(requests()).toBe(1)
  })

  it("pipelines object fields through plain-object authentication", async () => {
    const User = Schema.Struct({ id: Schema.String, name: Schema.String })
    const App = RpcGroup.make(
      Rpc.make("authenticate", { payload: { token: Schema.String }, success: User }),
      Rpc.make("profile", { payload: { id: Schema.String }, success: Schema.String })
    )
    const { client, requests } = await local(App, {
      authenticate: () => Effect.succeed({ id: "u1", name: "Ada" }),
      profile: ({ id }: { id: string }) => Effect.succeed(`profile:${id}`)
    })
    const user = client.authenticate({ token: "secret" })
    expect(await Effect.runPromise(Pipeline.all({ user, profile: client.profile({ id: user.id }) }))).toEqual({ user: { id: "u1", name: "Ada" }, profile: "profile:u1" })
    expect(requests()).toBe(1)
  })

  it("maps arrays with per-element RPC calls in one request", async () => {
    const App = RpcGroup.make(
      Rpc.make("ids", { success: Schema.Array(Schema.String) }),
      Rpc.make("greet", { payload: { name: Schema.String }, success: Schema.String })
    )
    const { client, requests } = await local(App, {
      ids: () => Effect.succeed(["a", "b"]),
      greet: ({ name }: { name: string }) => Effect.succeed(`Hello ${name}`)
    })
    const result = await Effect.runPromise(Pipeline.map(client.ids(), (id) => ({ id, greeting: client.greet({ name: id }) })))
    expect(result).toEqual([{ id: "a", greeting: "Hello a" }, { id: "b", greeting: "Hello b" }])
    expect(requests()).toBe(1)
  })

  it("maps Some and preserves None", async () => {
    const App = RpcGroup.make(Rpc.make("maybe", { payload: { found: Schema.Boolean }, success: Schema.Option(Schema.String) }))
    const { client } = await local(App, { maybe: ({ found }: { found: boolean }) => Effect.succeed(found ? Option.some("x") : Option.none()) })
    expect(await Effect.runPromise(Pipeline.map(client.maybe({ found: true }), (value) => ({ value })))).toEqual(Option.some({ value: "x" }))
    expect(await Effect.runPromise(Pipeline.map(client.maybe({ found: false }), (value) => ({ value })))).toEqual(Option.none())
  })

  it("orders a mutation before a combined query", async () => {
    const App = RpcGroup.make(
      Rpc.make("addTodo", { payload: { title: Schema.String }, success: Schema.Void }),
      Rpc.make("listTodos", { success: Schema.Array(Schema.String) }),
      Rpc.make("todoCount", { success: Schema.Number })
    )
    const values: string[] = []
    const { client, requests } = await local(App, {
      addTodo: ({ title }: { title: string }) => Effect.gen(function*() { values.push(title) }),
      listTodos: () => Effect.gen(function*() { return [...values] }),
      todoCount: () => Effect.gen(function*() { return values.length })
    })
    const query = Pipeline.all({ todos: client.listTodos(), count: client.todoCount() })
    expect(await Effect.runPromise(Pipeline.zipRight(client.addTodo({ title: "one" }), query))).toEqual({ todos: ["one"], count: 1 })
    expect(requests()).toBe(1)
  })

  it("rejects graphs combined across clients", async () => {
    const App = RpcGroup.make(Rpc.make("value", { success: Schema.String }))
    const a = await local(App, { value: () => Effect.succeed("a") })
    const b = await local(App, { value: () => Effect.succeed("b") })
    expect(() => Pipeline.all([a.client.value(), b.client.value()])).toThrow(/different pipeline clients/)
  })

  it("runs standard Effect RPC server middleware", async () => {
    class Audit extends RpcMiddleware.Service<Audit>()("Audit") {}
    const App = RpcGroup.make(Rpc.make("secureValue", { success: Schema.String })).middleware(Audit)
    let audited = 0
    const handlers = await Effect.runPromise(App.toHandlers({ secureValue: () => Effect.succeed("secret") }) as Effect.Effect<any>)
    const context = Context.merge(handlers, Context.make(Audit, (effect) => Effect.andThen(Effect.sync(() => { audited++ }), effect) as any))
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request) => PipelineServer.handle(App, request, context)
    }))
    expect(await Effect.runPromise(client.secureValue() as unknown as Effect.Effect<string>)).toBe("secret")
    expect(audited).toBe(1)
  })
})

describe("capability authentication", () => {
  it("pipelines through a returned typed capability", async () => {
    const SessionRpcs = RpcGroup.make(Rpc.make("whoami", { success: Schema.String }))
    const Session = Capability.make("Session", SessionRpcs)
    const Root = RpcGroup.make(Rpc.make("authenticate", { payload: { token: Schema.String }, success: Session.schema }))
    const context = await Effect.runPromise(Root.toHandlers({ authenticate: () => Effect.succeed(Session.of({ whoami: () => Effect.succeed("Ada") })) }))
    const client = await Effect.runPromise(PipelineClient.make(Root, { id: "auth", transport: (request) => PipelineServer.handle(Root, request, context, { id: "auth" }) }))
    expect(await Effect.runPromise(client.authenticate({ token: "ok" }).whoami() as unknown as Effect.Effect<string>)).toBe("Ada")
  })
})

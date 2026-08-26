import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Headers from "effect/unstable/http/Headers"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import { describe, expect, expectTypeOf, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

const local = async <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, handlers: any, id = "default") => {
  const context = await Effect.runPromise(group.toHandlers(handlers) as Effect.Effect<any>)
  let requests = 0
  let last: Pipeline.PipelineRequest | undefined
  const client = await Effect.runPromise(PipelineClient.make(group, { id, transport: (request, options) => {
    requests++
    last = request
    return PipelineServer.handle(group, request, {
      id,
      metadata: {
        client: new Rpc.ServerClient(1),
        requestId: "test-batch",
        headers: options?.headers ?? Headers.empty
      }
    }).pipe(Effect.provideContext(context))
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

  it("builds a client-selected response after a mutation", async () => {
    const Item = Schema.Struct({ id: Schema.String, title: Schema.String })
    const App = RpcGroup.make(
      Rpc.make("addItem", { payload: { title: Schema.String }, success: Item }),
      Rpc.make("getItem", { payload: { id: Schema.String }, success: Item }),
      Rpc.make("listItems", { success: Schema.Array(Item) }),
      Rpc.make("itemCount", { success: Schema.Number })
    )
    const items = new Map<string, { readonly id: string; readonly title: string }>()
    const events: Array<string> = []
    const { client, requests, last } = await local(App, {
      addItem: ({ title }: { title: string }) => Effect.sync(() => {
        events.push("mutate")
        const item = { id: "item-1", title }
        items.set(item.id, item)
        return item
      }),
      getItem: ({ id }: { id: string }) => Effect.sync(() => {
        events.push("get")
        return items.get(id)!
      }),
      listItems: () => Effect.sync(() => {
        events.push("list")
        return [...items.values()]
      }),
      itemCount: () => Effect.sync(() => {
        events.push("count")
        return items.size
      })
    })

    const operation = client.addItem({ title: "one" }).pipe(
      Pipeline.andThen((created) => ({
        created,
        selectedAgain: client.getItem({ id: created.id }),
        state: {
          items: client.listItems(),
          count: client.itemCount()
        }
      }))
    )
    const result = await Effect.runPromise(operation)

    expect(result).toEqual({
      created: { id: "item-1", title: "one" },
      selectedAgain: { id: "item-1", title: "one" },
      state: { items: [{ id: "item-1", title: "one" }], count: 1 }
    })
    expect(events[0]).toBe("mutate")
    expect(new Set(events.slice(1))).toEqual(new Set(["get", "list", "count"]))
    expect(requests()).toBe(1)

    const nodes = last()!.nodes
    const mutationId = nodes.find((node) => node._tag === "call" && node.method === "addItem")!.id
    for (const node of nodes.filter((node) => node._tag === "call" && node.method !== "addItem")) {
      expect(node.dependencies).toContain(mutationId)
    }
  })

  it("supports data-first use and serial mutation phases", async () => {
    const App = RpcGroup.make(
      Rpc.make("append", { payload: { value: Schema.String }, success: Schema.Number }),
      Rpc.make("values", { success: Schema.Array(Schema.String) })
    )
    const values: Array<string> = []
    const { client, requests } = await local(App, {
      append: ({ value }: { value: string }) => Effect.sync(() => {
        values.push(value)
        return values.length
      }),
      values: () => Effect.sync(() => [...values])
    })

    const first = Pipeline.andThen(client.append({ value: "a" }), (size) => ({ size }))
    const second = Pipeline.andThen(first, ({ size }) => ({
      firstSize: size,
      secondSize: client.append({ value: "b" })
    }))
    const result = await Effect.runPromise(Pipeline.andThen(second, ({ firstSize, secondSize }) => ({
      firstSize,
      secondSize,
      values: client.values()
    })))

    expect(result).toEqual({ firstSize: 1, secondSize: 2, values: ["a", "b"] })
    expect(requests()).toBe(1)
  })

  it("composes post-mutation array and Option selections", async () => {
    const App = RpcGroup.make(
      Rpc.make("initialize", { success: Schema.Void }),
      Rpc.make("ids", { success: Schema.Array(Schema.String) }),
      Rpc.make("maybeId", { success: Schema.Option(Schema.String) }),
      Rpc.make("label", { payload: { id: Schema.String }, success: Schema.String })
    )
    let initialized = false
    const { client, requests } = await local(App, {
      initialize: () => Effect.sync(() => { initialized = true }),
      ids: () => Effect.sync(() => initialized ? ["a", "b"] : []),
      maybeId: () => Effect.sync(() => initialized ? Option.some("a") : Option.none()),
      label: ({ id }: { id: string }) => Effect.succeed(`label:${id}`)
    })

    const result = await Effect.runPromise(client.initialize().pipe(
      Pipeline.andThen(() => ({
        labels: Pipeline.map(client.ids(), (id) => client.label({ id })),
        selected: Pipeline.map(client.maybeId(), (id) => ({ id, label: client.label({ id }) }))
      }))
    ))

    expect(result).toEqual({
      labels: ["label:a", "label:b"],
      selected: Option.some({ id: "a", label: "label:a" })
    })
    expect(requests()).toBe(1)
  })

  it("infers errors from dependent inputs and mapped calls", async () => {
    class FindUserError extends Schema.TaggedError<FindUserError>()("FindUserError", {}) {}
    class LoadProfileError extends Schema.TaggedError<LoadProfileError>()("LoadProfileError", {}) {}
    const User = Schema.Struct({ id: Schema.String })
    const App = RpcGroup.make(
      Rpc.make("findUser", { success: User, error: FindUserError }),
      Rpc.make("findUsers", { success: Schema.Array(User), error: FindUserError }),
      Rpc.make("loadProfile", { payload: { id: Schema.String }, success: Schema.String, error: LoadProfileError })
    )
    const { client } = await local(App, {
      findUser: () => Effect.succeed({ id: "u1" }),
      findUsers: () => Effect.succeed([{ id: "u1" }]),
      loadProfile: ({ id }: { id: string }) => Effect.succeed(`profile:${id}`)
    })

    const first = client.findUser()
    const dependent = client.loadProfile({ id: first.id })
    const mapped = Pipeline.map(client.findUsers(), (user) => client.loadProfile({ id: user.id }))

    expectTypeOf<Effect.Error<typeof dependent>>().toEqualTypeOf<
      FindUserError | LoadProfileError | RpcClientError | Pipeline.PipelineProtocolError
    >()
    expectTypeOf<Effect.Error<typeof mapped>>().toEqualTypeOf<
      FindUserError | LoadProfileError | RpcClientError | Pipeline.PipelineProtocolError
    >()
    expect(await Effect.runPromise(mapped)).toEqual(["profile:u1"])
  })

  it("preserves client schema requirements across structured selections", async () => {
    class EncodePayload extends Context.Service<EncodePayload, true>()("test/EncodePayload") {}
    class DecodeResult extends Context.Service<DecodeResult, true>()("test/DecodeResult") {}
    const Payload = Schema.String as Schema.Codec<string, string, never, EncodePayload>
    const Result = Schema.String as Schema.Codec<string, string, DecodeResult, never>
    const App = RpcGroup.make(
      Rpc.make("transformed", { payload: Payload, success: Result }),
      Rpc.make("plain", { success: Schema.Number })
    )
    const { client } = await local(App, {
      transformed: (input: string) => Effect.succeed(input),
      plain: () => Effect.succeed(1)
    })
    const call = Pipeline.all({ value: client.transformed("input"), count: client.plain() })

    expectTypeOf<Effect.Services<typeof call>>().toEqualTypeOf<EncodePayload | DecodeResult>()
    if (false) {
      // @ts-expect-error client schema services must be provided before execution
      Effect.runPromise(call)
      Effect.runPromise(call.pipe(
        Effect.provideService(EncodePayload, true),
        Effect.provideService(DecodeResult, true)
      ))
      // @ts-expect-error ordinary Effects cannot be embedded in a remote selection
      Pipeline.all({ remote: client.plain(), local: Effect.succeed("local") })
    }
  })

  it("uses native RPC middleware to provide CurrentUser from pipeline headers", async () => {
    class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("test/CurrentUser") {}
    class UserDirectory extends Context.Service<UserDirectory, {
      readonly resolve: (token: string) => Effect.Effect<{ readonly id: string }>
    }>()("test/UserDirectory") {}
    class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", { reason: Schema.String }) {}
    class Auth extends RpcMiddleware.Service<Auth, {
      readonly provides: CurrentUser
      readonly requires: UserDirectory
    }>()("test/Auth", { error: Unauthorized }) {}

    const App = RpcGroup.make(Rpc.make("me", { success: Schema.String })).middleware(Auth)
    const directory = UserDirectory.of({ resolve: (token) => Effect.succeed({ id: token }) })
    const handlers = await Effect.runPromise(App.toHandlers({ me: () => Effect.map(CurrentUser, (user) => user.id) }).pipe(
      Effect.provideService(UserDirectory, directory)
    ))
    const auth = Context.make(Auth, (effect, { headers }) => Effect.gen(function*() {
      const userId = headers.authorization
      if (userId === undefined) return yield* Effect.fail(new Unauthorized({ reason: "missing authorization" }))
      const users = yield* UserDirectory
      const user = yield* users.resolve(userId)
      return yield* Effect.provideService(effect, CurrentUser, user)
    }))
    const context = Context.add(Context.merge(handlers, auth), UserDirectory, directory)
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request, options) => PipelineServer.handle(App, request, {
        metadata: {
          client: new Rpc.ServerClient(7),
          requestId: "auth-batch",
          headers: options?.headers ?? Headers.empty
        }
      }).pipe(Effect.provideContext(context))
    }))

    expect(await Effect.runPromise(client.me().pipe(RpcClient.withHeaders({ authorization: "user-1" })))).toBe("user-1")
    const failure = await Effect.runPromise(Effect.flip(client.me()))
    expect(failure).toMatchObject({ _tag: "Unauthorized", reason: "missing authorization" })
  })

  it("runs required client middleware once around a batch", async () => {
    class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("test/ClientCurrentUser") {}
    class Unauthorized extends Schema.TaggedError<Unauthorized>()("ClientMiddlewareUnauthorized", {}) {}
    class MissingToken extends Schema.TaggedError<MissingToken>()("MissingToken", {}) {}
    class Auth extends RpcMiddleware.Service<Auth, {
      readonly provides: CurrentUser
      readonly clientError: MissingToken
    }>()("test/ClientAuth", { error: Unauthorized, requiredForClient: true }) {}

    const App = RpcGroup.make(
      Rpc.make("me", { success: Schema.String }),
      Rpc.make("roles", { success: Schema.Array(Schema.String) })
    ).middleware(Auth)
    const handlers = await Effect.runPromise(App.toHandlers({
      me: () => Effect.map(CurrentUser, (user) => user.id),
      roles: () => Effect.succeed(["admin"])
    }))
    const serverAuth = Context.make(Auth, (effect, { headers }) => headers.authorization === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, { id: headers.authorization }))
    const serverContext = Context.merge(handlers, serverAuth)
    let requests = 0
    const transport: Pipeline.PipelineTransport = (request, options) => {
      requests++
      return PipelineServer.handle(App, request, {
        metadata: {
          client: new Rpc.ServerClient(9),
          requestId: "client-middleware-batch",
          headers: options?.headers ?? Headers.empty
        }
      }).pipe(Effect.provideContext(serverContext))
    }
    let middlewareRuns = 0
    const ClientAuthLive = RpcMiddleware.layerClient(Auth, ({ next, request }) => {
      middlewareRuns++
      return next({ ...request, headers: Headers.set(request.headers, "authorization", "client-user") })
    })
    const client = await Effect.runPromise(PipelineClient.make(App, { transport }).pipe(Effect.provide(ClientAuthLive)))
    const call = Pipeline.all({ me: client.me(), roles: client.roles() })

    expectTypeOf<Effect.Error<typeof call>>().toEqualTypeOf<
      Unauthorized | MissingToken | RpcClientError | Pipeline.PipelineProtocolError
    >()
    expect(await Effect.runPromise(call)).toEqual({ me: "client-user", roles: ["admin"] })
    expect(middlewareRuns).toBe(1)
    expect(requests).toBe(1)

    const MissingClientAuthLive = RpcMiddleware.layerClient(Auth, () => Effect.fail(new MissingToken()))
    const missingClient = await Effect.runPromise(PipelineClient.make(App, { transport }).pipe(Effect.provide(MissingClientAuthLive)))
    const failure = await Effect.runPromise(Effect.flip(missingClient.me()))
    expect(failure).toMatchObject({ _tag: "MissingToken" })
    expect(requests).toBe(1)
  })

  it("preserves tagged domain failures and protocol failures", async () => {
    class MissingValue extends Schema.TaggedError<MissingValue>()("MissingValue", { key: Schema.String }) {}
    const App = RpcGroup.make(Rpc.make("lookup", {
      payload: { key: Schema.String },
      success: Schema.String,
      error: MissingValue
    }))
    const context = await Effect.runPromise(App.toHandlers({
      lookup: ({ key }: { key: string }) => Effect.fail(new MissingValue({ key }))
    }))
    const domain = await local(App, { lookup: ({ key }: { key: string }) => Effect.fail(new MissingValue({ key })) })
    expect(await Effect.runPromise(Effect.flip(domain.client.lookup({ key: "missing" })))).toMatchObject({
      _tag: "MissingValue",
      key: "missing"
    })

    const client = await Effect.runPromise(PipelineClient.make(App).pipe(
      Effect.provide(PipelineClient.layerTransport((request) => PipelineServer.handle(App, request, { id: "server" }).pipe(
        Effect.provideContext(context)
      )))
    ))
    const protocolFailure = await Effect.runPromise(Effect.flip(client.lookup({ key: "missing" })))
    expect(protocolFailure).toMatchObject({ _tag: "PipelineProtocolError", code: "InvalidPipeline" })
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
      transport: (request) => PipelineServer.handle(App, request).pipe(Effect.provideContext(context))
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
    const context = await Effect.runPromise(Root.toHandlers({ authenticate: () => Session.fromHandlers({ whoami: () => Effect.succeed("Ada") }) }))
    const client = await Effect.runPromise(PipelineClient.make(Root, { id: "auth", transport: (request) => PipelineServer.handle(Root, request, { id: "auth" }).pipe(Effect.provideContext(context)) }))
    expect(await Effect.runPromise(client.authenticate({ token: "ok" }).whoami() as unknown as Effect.Effect<string>)).toBe("Ada")
  })

  it("captures request-scoped CurrentUser independently for concurrent capabilities", async () => {
    class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("test/CapabilityCurrentUser") {}
    const SessionRpcs = RpcGroup.make(Rpc.make("whoami", { success: Schema.String }))
    const Session = Capability.make("ScopedSession", SessionRpcs)
    const Root = RpcGroup.make(Rpc.make("authenticate", { payload: { userId: Schema.String }, success: Session.schema }))
    const context = await Effect.runPromise(Root.toHandlers({
      authenticate: ({ userId }: { userId: string }) => Session.fromHandlers({
        whoami: () => Effect.map(CurrentUser, (user) => user.id)
      }).pipe(Effect.provideService(CurrentUser, { id: userId }))
    }))
    const client = await Effect.runPromise(PipelineClient.make(Root, {
      id: "scoped-auth",
      transport: (request) => PipelineServer.handle(Root, request, { id: "scoped-auth" }).pipe(Effect.provideContext(context))
    }))

    const [alice, bob] = await Effect.runPromise(Effect.all([
      client.authenticate({ userId: "alice" }).whoami(),
      client.authenticate({ userId: "bob" }).whoami()
    ], { concurrency: "unbounded" }))
    expect([alice, bob]).toEqual(["alice", "bob"])
  })

  it("applies middleware declared by a capability RpcGroup", async () => {
    class Audit extends RpcMiddleware.Service<Audit>()("test/CapabilityAudit") {}
    const SessionRpcs = RpcGroup.make(Rpc.make("value", { success: Schema.String })).middleware(Audit)
    const Session = Capability.make("AuditedSession", SessionRpcs)
    const Root = RpcGroup.make(Rpc.make("session", { success: Session.schema }))
    let audited = 0
    const audit = Context.make(Audit, (effect) => Effect.andThen(Effect.sync(() => { audited++ }), effect) as any)
    const context = await Effect.runPromise(Root.toHandlers({
      session: () => Session.fromHandlers({ value: () => Effect.succeed("ok") })
    }).pipe(Effect.provideContext(audit)))
    const serverContext = Context.merge(context, audit)
    const client = await Effect.runPromise(PipelineClient.make(Root, {
      transport: (request) => PipelineServer.handle(Root, request).pipe(Effect.provideContext(serverContext))
    }))

    expect(await Effect.runPromise(client.session().value())).toBe("ok")
    expect(audited).toBe(1)
  })
})

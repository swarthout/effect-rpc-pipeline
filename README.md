# effect-rpc-pipeline

Effect-native RPC pipelining for existing `RpcGroup` definitions. Calls build immutable request graphs without performing I/O; each remote result is also an ordinary `Effect`, so it works directly with `Effect.gen`, `pipe`, and Effect error/environment inference.

## Define the server normally

No pipeline-specific naming convention or handler DSL is required. RPC tags are exact keys—dots are not parsed.

```ts
const AppRpcs = RpcGroup.make(
  Rpc.make("authenticate", {
    payload: { token: Schema.String },
    success: Schema.Struct({ id: Schema.String, name: Schema.String })
  }),
  Rpc.make("getProfile", {
    payload: { id: Schema.String },
    success: Profile
  })
)

const AppLive = AppRpcs.toLayer(Effect.gen(function*() {
  const users = yield* UserRepository
  return AppRpcs.of({
    authenticate: ({ token }) => users.authenticate(token),
    getProfile: ({ id }) => users.getProfile(id)
  })
}))

const ServerLive = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc"
}).pipe(Layer.provide(AppLive))
```

The same group, handler layer, schemas, services, and RPC middleware remain usable by a standard Effect RPC server.

Middleware keeps its native Effect meaning. A middleware can provide request-scoped services such as `CurrentUser`, require application services, and add a schema-backed error to every protected RPC:

```ts
class CurrentUser extends Context.Service<CurrentUser, User>()("app/CurrentUser") {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  reason: Schema.String
}) {}
class Auth extends RpcMiddleware.Service<Auth, {
  provides: CurrentUser
  requires: UserRepository
}>()("app/Auth", { error: Unauthorized }) {}

const PrivateRpcs = RpcGroup.make(
  Rpc.make("me", { success: User })
).middleware(Auth)

const PrivateLive = PrivateRpcs.toLayer({
  me: () => CurrentUser
})
```

`CurrentUser` is supplied around each handler by `Auth`; it is a server requirement and never leaks into the client Effect's requirements.

## Use calls as Effects or remote values

```ts
const rpc = yield* PipelineClient.make(AppRpcs, { url: "/rpc" })

// A single call is a normal Effect.
const profile = yield* rpc.getProfile({ id: "user-1" })

// Unresolved fields can flow into later calls. This executes as one request.
const user = rpc.authenticate({ token })
const result = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ id: user.id })
})
```

For Layer-based applications, provide the transport as an Effect service:

```ts
const rpc = yield* PipelineClient.make(AppRpcs).pipe(
  Effect.provide(PipelineClient.layerHttp({ url: "/rpc" }))
)
```

`RpcClient.withHeaders` works on a final remote value, and required `RpcMiddleware.layerClient` implementations are captured when the pipeline client is constructed. A client middleware shared by several nodes runs once around the complete batch.

```ts
const result = yield* Pipeline.all({ me: rpc.me(), todos: rpc.listTodos() }).pipe(
  RpcClient.withHeaders({ authorization: `Bearer ${token}` })
)
```

`Pipeline.all` replaces a special `$batch` call: the value being yielded is the batch boundary, while every dependency remains visible in the graph.

Map arrays and Effect Options on the server without resolving them first:

```ts
const profiles = yield* Pipeline.map(rpc.friendIds(), (id) => ({
  id,
  profile: rpc.getProfile({ id })
}))

const greeting = yield* Pipeline.map(rpc.findUser({ email }), (user) =>
  rpc.greet({ name: user.name })
)
```

Build a client-selected mutation response with `Pipeline.andThen`. The callback receives the symbolic mutation result, and every query it introduces runs after the mutation. Independent queries in the response run in parallel:

```ts
const state = yield* rpc.addTodo({ title }).pipe(
  Pipeline.andThen((created) => ({
    created,
    todos: rpc.listTodos({ filter: "all" }),
    remaining: rpc.countTodos({ filter: "active" })
  }))
)
```

The callback runs locally while building the request, so its argument is a `Remote<T>`, not a concrete value. It can be projected, passed to other RPCs, mapped when it is an array or `Option`, and included in the response. It cannot be inspected with ordinary branching or arbitrary local computation until the final pipeline is yielded.

Repeated `Pipeline.andThen` calls create serial phases. Ordering is guaranteed within the pipeline request, but it does not by itself open a database transaction or provide snapshot isolation; those remain application-level Effect services.

## Capability authentication

For Cap'n Web-style authenticated sessions, return a typed batch-local capability:

```ts
const SessionRpcs = RpcGroup.make(
  Rpc.make("whoami", { success: User }),
  Rpc.make("friendIds", { success: Schema.Array(Schema.String) })
)
const Session = Capability.make("Session", SessionRpcs)

const AppRpcs = RpcGroup.make(
  Rpc.make("authenticate", {
    payload: { token: Schema.String },
    success: Session.schema
  }),
  Rpc.make("getProfile", {
    payload: { id: Schema.String },
    success: Profile
  })
)

const AppHandlers = AppRpcs.of({
  authenticate: ({ token }) => Effect.gen(function*() {
    const user = yield* Users.authenticate(token)
    return yield* Session.fromHandlers({
      whoami: () => CurrentUser,
      friendIds: () => Effect.gen(function*() {
        const current = yield* CurrentUser
        return yield* Friends.forUser(current.id)
      })
    }).pipe(Effect.provideService(CurrentUser, user))
  }),
  getProfile: ({ id }) => Profiles.get(id)
})

const session = rpc.authenticate({ token })
const result = yield* Pipeline.all({
  user: session.whoami(),
  friends: Pipeline.map(session.friendIds(), (id) => rpc.getProfile({ id }))
})
```

`Session.fromHandlers` mirrors `RpcGroup.toHandlers`: it returns an Effect whose requirements are inferred from the handlers, then captures the provided Context in the batch-local capability. Capability calls use the original RPC schemas and middleware.

## Errors and requirements

A remote call exposes the union of every operation that may execute in its graph:

```ts
const account = rpc.findAccount({ email })
const invoices = rpc.listInvoices({ accountId: account.id })

// Effect<ReadonlyArray<Invoice>,
//   AccountNotFound | InvoiceError | Unauthorized |
//   AuthClientError | RpcClientError | PipelineProtocolError,
//   ClientSchemaServices>
```

Domain and middleware failures cross the boundary without a wrapper, so `Effect.catchTag` and `Effect.catchTags` work normally. Transport failures use Effect's `RpcClientError`; malformed or incompatible graphs use the schema-backed `PipelineProtocolError`. `Pipeline.all`, `Pipeline.map`, dependent payloads, capability calls, and `Pipeline.andThen` all accumulate their nested error and client-schema requirement unions.

Plain-object authentication is supported as well: project fields such as `rpc.authenticate(...).id` and pass them into other calls.

## Example and tests

The complete TodoMVC client, standard Effect RPC handlers, Node HTTP server, and end-to-end workflow live in [`examples/todoapp`](./examples/todoapp). The test suite also keeps a small Cap'n Web fixture beside the equivalent pipeline behaviors.

Streaming and persistent cross-request capabilities are not currently supported. Capabilities are scoped to one pipeline request.

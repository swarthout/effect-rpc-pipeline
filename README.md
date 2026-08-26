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

For mutations that have no data dependency, express ordering explicitly and keep the query parallel:

```ts
const state = yield* Pipeline.zipRight(
  rpc.addTodo({ title }),
  Pipeline.all({
    todos: rpc.listTodos({ filter: "all" }),
    remaining: rpc.countTodos({ filter: "active" })
  })
)
```

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
  })
)

const session = rpc.authenticate({ token })
const result = yield* Pipeline.all({
  user: session.whoami(),
  friends: Pipeline.map(session.friendIds(), (id) => rpc.getProfile({ id }))
})
```

Plain-object authentication is supported as well: project fields such as `rpc.authenticate(...).id` and pass them into other calls.

## Example and tests

The complete TodoMVC client, standard Effect RPC handlers, Node HTTP server, and end-to-end workflow live in [`examples/todoapp`](./examples/todoapp). The test suite also keeps a small Cap'n Web fixture beside the equivalent pipeline behaviors.

Streaming and persistent cross-request capabilities are not currently supported. Capabilities are scoped to one pipeline request.

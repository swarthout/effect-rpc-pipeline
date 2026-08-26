# effect-rpc-pipeline

Effect-native promise pipelining for schema-backed RPC groups. Existing `RpcGroup` handler layers remain reusable; the package records dependent calls and sends the complete graph in one pipeline request.

## Client API

Use dotted RPC tags to get the same nested proxy shape as Effect's native RPC client:

```ts
const TodoRpcs = RpcGroup.make(
  Rpc.make("todos.list", { /* ... */ }),
  Rpc.make("todos.add", { /* ... */ })
)
```

`Pipeline.resolve` is the Cap'n Web-style API for graphs whose dependencies flow through unresolved values:

```ts
const result = yield* Pipeline.resolve(client, (rpc) => {
  const session = rpc.auth.authenticate({ token })
  const friends = session.getFriendIds()

  return friends.map((id) => ({
    id,
    profile: rpc.users.getProfile({ id })
  }))
})
```

`Pipeline.run` adds generator ordering for mutations or other calls without a data dependency. A yielded operation becomes the dependency frontier; calls in `Pipeline.all` are parallel siblings:

```ts
const state = yield* Pipeline.run(client, function* (rpc) {
  yield* rpc.todos.add({ title })

  return yield* Pipeline.all({
    todos: rpc.todos.list({ filter }),
    remaining: rpc.todos.count({ filter: "active" })
  })
})
```

The callback passed to `Pipeline.run` is a graph-building generator. Values yielded inside it are unresolved remote values and should be passed to subsequent RPC calls rather than used for local branching. The outer `Pipeline.run` is an ordinary `Effect`.

## Adoption

Keep the existing handler layer and add the pipeline server layer at the HTTP boundary:

```ts
const AppLive = AppRpcs.toLayer({
  getUser: ({ id }) => UserRepository.get(id)
})

const ServerLive = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  id: "my-app"
}).pipe(Layer.provide(AppLive))
```

The original `AppRpcs` group and ordinary Effect RPC clients remain valid. For custom protocols, use `PipelineServer.augment(definition)` and `PipelineServer.layer(definition)` with the normal `RpcServer` composition.

`client.execute(builder)` remains temporarily available as a deprecated compatibility alias for `Pipeline.resolve(client, builder)`. `Pipeline.after` is also deprecated in favor of generator ordering.

The initial implementation targets Effect 4 RC and HTTP transports. Capabilities are batch-local. Streaming, persistent sessions, and wire compatibility with Cap'n Web are intentionally out of scope.

## Examples

The complete TodoMVC client, server, and HTTP end-to-end test live in [`examples/todoapp`](./examples/todoapp). Build this package first, then run the example's `npm install`, `npm run typecheck`, and `npm test` commands.

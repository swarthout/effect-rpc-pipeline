# effect-rpc-pipeline

`effect-rpc-pipeline` adds promise pipelining, batching, bidirectional capabilities, and WebSocket support to Effect RPC.

You define RPCs, schemas, handlers, middleware, errors, and services with the normal Effect APIs. The package changes how finite client calls are composed: a call initially represents a remote value, and network I/O begins only when that value is run as an `Effect`.

That makes dependent work expressible in one request:

```ts
const user = rpc.findUser({ email: "ada@example.com" })

const result = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id })
})
```

The server receives one dependency graph. It runs `findUser`, passes the resulting `id` to `getProfile`, and returns only the selected object. The client keeps strong inference for success values, typed errors, and Effect requirements throughout the graph.

## Why pipeline RPC?

Ordinary RPC APIs often make a client choose between several network round trips, an endpoint that overfetches, or many endpoint variants for different response shapes. A pipeline lets the client compose the operations it needs while the server still controls the available RPCs, schemas, authorization, and execution.

This package is useful when you want to:

- remove round trips between dependent RPC calls;
- batch independent queries into one request;
- return client-selected data after a mutation;
- map typed server operations over arrays and Effect `Option` values;
- expose authenticated or callback capabilities over WebSocket; and
- keep Effect's normal error, requirement, middleware, stream, and SQL APIs.

## Installation

```sh
npm install effect effect-rpc-pipeline
```

The public modules can be imported separately:

```ts
import * as Capability from "effect-rpc-pipeline/Capability"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import * as PipelineSql from "effect-rpc-pipeline/Sql"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"
```

They are also available as namespaces from `effect-rpc-pipeline`.

## Define RPCs and handlers

Start with an ordinary Effect `RpcGroup`:

```ts
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String
}) {}

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String
}) {}

const AppRpcs = RpcGroup.make(
  Rpc.make("findUser", {
    payload: { email: Schema.String },
    success: User,
    error: UserNotFound
  }),
  Rpc.make("getProfile", {
    payload: { userId: Schema.String },
    success: Schema.Struct({ bio: Schema.String })
  }),
  Rpc.make("listFriendIds", {
    payload: { userId: Schema.String },
    success: Schema.Array(Schema.String)
  })
)
```

Handlers use the standard `RpcGroup` APIs and can require any Effect services:

```ts
const AppHandlers = AppRpcs.of({
  findUser: ({ email }) => Users.findByEmail(email),
  getProfile: ({ userId }) => Profiles.get(userId),
  listFriendIds: ({ userId }) => Friends.listIds(userId)
})

const AppLive = AppRpcs.toLayer(AppHandlers)
```

An existing Effect RPC group and handler layer can therefore be adopted without redesigning the server API.

## Serve RPCs over HTTP

`PipelineServer.layerHttp` installs an Effect HTTP route for finite RPC calls and pipelines:

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import { createServer } from "node:http"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"

const RpcRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  id: "app"
}).pipe(Layer.provide(AppLive))

const ServerLive = HttpRouter.serve(RpcRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  Layer.provide(RpcSerialization.layerJson)
)

Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
```

The optional `id` identifies the pipeline definition. Use the same value when constructing the client. If omitted, both sides use `"default"`.

## Create an HTTP client

`PipelineClient.make` derives its fully typed client from the same group:

```ts
import * as Effect from "effect/Effect"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"

const program = Effect.scoped(Effect.gen(function*() {
  const rpc = yield* PipelineClient.make(AppRpcs, { id: "app" })

  // Running a single remote value sends one request.
  return yield* rpc.findUser({ email: "ada@example.com" })
})).pipe(
  Effect.provide(PipelineClient.layerHttp({
    url: "http://127.0.0.1:8787/rpc"
  })),
  Effect.provide(RpcSerialization.layerJson)
)
```

Keep the transport layer around both client construction and client use. Native Effect transports and WebSocket connections are scoped resources.

`layerHttp` combines Effect's HTTP RPC protocol with `FetchHttpClient`. Applications that already provide their own Effect HTTP client can use `PipelineClient.layerProtocolHttp` instead.

## Compose finite calls

Every finite client method returns a `Pipeline.Remote<A, E, R>`. A `Remote` is both:

- a symbolic value that can be referenced by later RPCs; and
- an `Effect<A, E, R>` that sends its graph when run.

### Select several results with `Pipeline.all`

Use `Pipeline.all` to return an object, array, or nested structure containing multiple remote values:

```ts
const dashboard = yield* Pipeline.all({
  user: rpc.findUser({ email }),
  recentPosts: rpc.listRecentPosts(),
  unreadCount: rpc.countUnreadNotifications()
})
```

Independent nodes run concurrently on the server and share one transport request.

### Pass remote results to later calls

Fields on a typed remote object can be projected and used in another payload:

```ts
const user = rpc.findUser({ email })

const result = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id }),
  friendIds: rpc.listFriendIds({ userId: user.id })
})
```

The dependency is inferred from the value reference; no manual ordering API is needed.

### Map remote arrays and `Option` values

`Pipeline.map` executes its template for every element of a remote array, or for the `Some` value of a remote Effect `Option`:

```ts
const friends = yield* Pipeline.map(
  rpc.listFriendIds({ userId }),
  (friendId) => ({
    id: friendId,
    profile: rpc.getProfile({ userId: friendId })
  })
)
```

```ts
// findUserByHandle returns Option<User>
const greeting = yield* Pipeline.map(
  rpc.findUserByHandle({ handle }),
  (user) => rpc.makeGreeting({ name: user.name })
)
```

Array items are evaluated concurrently. When the source is `Option.none()`, the mapped calls are not executed and the result remains `Option.none()`.

### Query after a mutation

`Pipeline.andThen` creates a new execution phase. It is useful when a client wants to choose the data returned after a mutation:

```ts
const state = yield* rpc.addTodo({ title }).pipe(
  Pipeline.andThen((created) => ({
    created,
    todos: rpc.listTodos({ filter: "all" }),
    remaining: rpc.countTodos({ filter: "active" })
  }))
)
```

All calls introduced by the callback begin after the mutation. Independent calls within that new phase can run concurrently.

The callback runs locally while the graph is being built, so `created` is symbolic. It can be projected, passed to RPCs, mapped, or selected, but it cannot be inspected with ordinary JavaScript branching. Use another RPC when a decision depends on server data.

For simple sequencing where only the second result matters, use `Pipeline.zipRight(first, second)`.

## Headers and Effect RPC middleware

Headers use the normal Effect RPC API and apply to the complete pipeline request:

```ts
import * as RpcClient from "effect/unstable/rpc/RpcClient"

const result = yield* Pipeline.all({
  me: rpc.me(),
  todos: rpc.listTodos({ filter: "all" })
}).pipe(
  RpcClient.withHeaders({ authorization: `Bearer ${token}` })
)
```

Standard RPC middleware continues to control server requirements, context injection, authentication, and typed failures:

```ts
import * as Context from "effect/Context"
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"

class CurrentUser extends Context.Service<CurrentUser, User>()("app/CurrentUser") {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  reason: Schema.String
}) {}

class Auth extends RpcMiddleware.Service<Auth, {
  provides: CurrentUser
}>()("app/Auth", { error: Unauthorized }) {}

const PrivateRpcs = RpcGroup.make(
  Rpc.make("me", { success: User }),
  Rpc.make("privateTodos", { success: Schema.Array(Todo) })
).middleware(Auth)

const PrivateHandlers = PrivateRpcs.toLayer({
  me: () => CurrentUser,
  privateTodos: () => Effect.flatMap(CurrentUser, (user) => Todos.forUser(user.id))
})

const AuthLive = Layer.succeed(Auth, (effect, { headers }) => {
  const token = headers.authorization
  if (token === undefined) {
    return Effect.fail(new Unauthorized({ reason: "missing token" }))
  }
  return Effect.flatMap(Users.authenticate(token), (user) =>
    Effect.provideService(effect, CurrentUser, user)
  )
})

const PrivateRoutes = PipelineServer.layerHttp({
  group: PrivateRpcs,
  path: "/rpc"
}).pipe(
  Layer.provide(PrivateHandlers),
  Layer.provide(AuthLive)
)
```

The middleware implementation can read request headers and provide `CurrentUser` around each handler. Server-only requirements do not appear in the client Effect type.

Middleware marked `requiredForClient` is also supported. Its client layer is captured when `PipelineClient.make` runs, and one middleware shared by several nodes runs once around the complete batch.

## WebSockets and streams

HTTP and WebSocket routes can share the same path. POST requests serve finite HTTP pipelines, while GET upgrades serve persistent Effect RPC connections:

```ts
const RpcRoutes = Layer.merge(
  PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc", id: "app" }),
  PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc", id: "app" })
).pipe(Layer.provide(AppLive))
```

Streaming RPCs use the standard Effect definition and handler forms:

```ts
import * as Stream from "effect/Stream"

const TodoRpcs = RpcGroup.make(
  Rpc.make("listTodos", { success: Schema.Array(Todo) }),
  Rpc.make("watchTodos", {
    success: TodoEvent,
    error: TodoSubscriptionError,
    stream: true
  })
)

const TodoHandlers = TodoRpcs.toLayer({
  listTodos: () => Todos.list,
  watchTodos: () => Stream.fromPubSub(TodoEvents)
})
```

The pipeline client exposes finite methods as `Remote` Effects and streaming methods as native Effect `Stream` values:

```ts
import * as Socket from "effect/unstable/socket/Socket"

const program = Effect.scoped(Effect.gen(function*() {
  const rpc = yield* PipelineClient.make(TodoRpcs)

  yield* rpc.watchTodos().pipe(
    Stream.runForEach((event) => Effect.log("todo update", event))
  )
})).pipe(
  Effect.provide(PipelineClient.layerWebSocket({
    url: "ws://127.0.0.1:8787/rpc"
  })),
  Effect.provide(RpcSerialization.layerJson),
  Effect.provide(Socket.layerWebSocketConstructorGlobal)
)
```

`layerWebSocket` uses Effect's socket RPC transport, including multiplexing, acknowledgements, interruption, ping/pong, and reconnect policy hooks. Use `layerProtocolWebSocket` when supplying an Effect `Socket` yourself.

Streams have an independent, backpressured lifetime and cannot be embedded in finite `Pipeline.all`, `Pipeline.map`, or `Pipeline.andThen` graphs.

## Typed capabilities

A capability is a typed RPC client that can itself be sent as an RPC value. It combines two ideas:

- a surface of methods, defined by an ordinary Effect `RpcGroup`; and
- authority to call one particular implementation of those methods.

This is useful whenever a plain data response would force later calls to repeat context. An authenticated session, a handle to one document, a restricted administrative surface, or a client callback can all be represented by the same abstraction. The receiver gets an ordinary, strongly typed Effect RPC client; no JavaScript functions or closures are serialized.

Capability references are opaque protocol values. The handlers and their captured Effect context remain on the side that created the capability. Calling a method sends the capability identity, method name, and schema-encoded payload back to that side for execution.

### Define a capability

Define a capability from another ordinary `RpcGroup`:

```ts
import * as Capability from "effect-rpc-pipeline/Capability"

const SessionRpcs = RpcGroup.make(
  Rpc.make("currentUser", { success: User }),
  Rpc.make("listTodos", { success: Schema.Array(Todo) }),
  Rpc.make("createTodo", {
    payload: { title: Schema.String },
    success: Todo
  })
)

const Session = Capability.make("app/Session", SessionRpcs)

const AppRpcs = RpcGroup.make(
  Rpc.make("authenticate", {
    payload: { token: Schema.String },
    success: Session.schema,
    error: Unauthorized
  })
)
```

The server returns an implementation with `fromHandlers`:

```ts
const AppHandlers = AppRpcs.of({
  authenticate: ({ token }) => Effect.gen(function*() {
    const user = yield* Users.authenticate(token)

    return yield* Session.fromHandlers({
      currentUser: () => CurrentUser,
      listTodos: () => Effect.flatMap(CurrentUser, (user) => Todos.forUser(user.id)),
      createTodo: ({ title }) => Effect.flatMap(
        CurrentUser,
        (user) => Todos.create({ ownerId: user.id, title })
      )
    }).pipe(Effect.provideService(CurrentUser, user))
  })
})
```

`Session.fromHandlers` uses the same handler definitions, middleware, errors, and service requirements as `RpcGroup.toHandlers`. It also captures the Effect context in which the capability is created. In this example, each returned session has its own `CurrentUser`; session methods do not need a token or user ID in every payload, and concurrent sessions cannot accidentally read one another's user service.

The client code consequently describes intent instead of authentication plumbing:

```ts
const session = yield* rpc.authenticate({ token })

const result = yield* Effect.gen(function*() {
  const todo = yield* session.createTodo({ title: "Learn Effect" })
  const todos = yield* session.listTodos()
  return { todo, todos }
})
```

With a bearer-token API, both calls would normally accept the token and every handler would need to authenticate or recover the current user. The capability performs that transition once: possession of `session` is the authority to call exactly `SessionRpcs` for the captured user.

This also makes least-authority APIs natural. Instead of returning a session with every application RPC, return a narrower capability for the task:

```ts
const TodoEditorRpcs = RpcGroup.make(
  Rpc.make("rename", {
    payload: { title: Schema.String },
    success: Todo
  }),
  Rpc.make("complete", { success: Todo })
)

const TodoEditor = Capability.make("todos/Editor", TodoEditorRpcs)

const openTodo = Rpc.make("openTodo", {
  payload: { id: Schema.String },
  success: TodoEditor.schema,
  error: TodoNotFound
})
```

An `openTodo` handler can capture the validated todo ID and current user when it creates the editor. Its `rename` method then needs only the new title, and a caller holding the editor cannot list other users' todos or invoke unrelated application methods.

### Connection lifetime and pipelining

Over WebSocket, the returned capability can be retained and called in later requests:

```ts
const session = yield* rpc.authenticate({ token })
const user = yield* session.currentUser()
const todos = yield* session.listTodos()

yield* Capability.release(session)
```

The capability is scoped to its connection and is revoked automatically when that connection closes. `Capability.release` lets the client release it earlier.

Over HTTP, use the capability inside the pipeline that creates it:

```ts
const session = rpc.authenticate({ token })

const account = yield* Pipeline.all({
  user: session.currentUser(),
  todos: session.listTodos()
})
```

An HTTP capability cannot be retained for another request.

This gives capabilities two useful lifetimes:

| Transport | Lifetime | Typical use |
| --- | --- | --- |
| WebSocket | Until release or disconnect | Login sessions, resource handles, and callbacks |
| HTTP | The pipeline that creates the capability | Authenticate and perform dependent work in one round trip |

Because capability methods are normal remote values, they compose with the rest of the pipeline API. Authentication and the authorized work can be sent as one dependency graph:

```ts
const session = rpc.authenticate({ token })

const dashboard = yield* Pipeline.all({
  user: session.currentUser(),
  todos: session.listTodos()
})
```

The server authenticates first and then runs the independent session calls concurrently. The client receives only `dashboard`; the intermediate capability reference does not have to be returned.

### Client callbacks

Capabilities are bidirectional over WebSocket. A client can implement a capability, include it in a request, and let the server call it. This provides typed callbacks without callback URLs, a second protocol, polling, or function serialization.

The simplest example is an interactive approval during checkout:

```ts
const ApprovalRpcs = RpcGroup.make(
  Rpc.make("approve", {
    payload: { total: Schema.Number },
    success: Schema.Boolean,
    error: ApprovalUnavailable
  })
)

const Approval = Capability.make("checkout/Approval", ApprovalRpcs)

const CheckoutRpcs = RpcGroup.make(
  Rpc.make("checkout", {
    payload: {
      cartId: Schema.String,
      approval: Approval.schema
    },
    success: Receipt,
    error: Schema.Union([
      CheckoutFailed,
      ApprovalUnavailable,
      Capability.CapabilityUnavailable,
      Capability.CapabilityTransportError
    ])
  })
)
```

The server uses the supplied capability like any other typed Effect RPC client:

```ts
const CheckoutHandlers = CheckoutRpcs.of({
  checkout: ({ cartId, approval }) => Effect.gen(function*() {
    const cart = yield* Carts.get(cartId)
    const approved = yield* approval.approve({ total: cart.total })

    if (!approved) {
      return yield* Effect.fail(new CheckoutFailed({ reason: "declined" }))
    }
    return yield* Orders.complete(cart)
  })
})
```

```ts
const approval = yield* Approval.fromHandlers({
  approve: ({ total }) => Dialog.confirm(`Approve $${total}?`)
})

const receipt = yield* rpc.checkout({ cartId, approval })
```

The server receives `approval` as a typed RPC client and calls `yield* approval.approve(...)`. The browser retains the dialog implementation and UI services; only an opaque reference and schema-encoded calls cross the connection.

Callbacks become more valuable when a workflow needs several interactions. For example, a file import can report meaningful milestones and ask a question only when necessary:

```ts
const ImportUiRpcs = RpcGroup.make(
  Rpc.make("progress", {
    payload: {
      completed: Schema.Number,
      total: Schema.Number,
      message: Schema.String
    },
    success: Schema.Void
  }),
  Rpc.make("confirmOverwrite", {
    payload: { path: Schema.String },
    success: Schema.Boolean,
    error: DialogUnavailable
  })
)

const ImportUi = Capability.make("imports/Ui", ImportUiRpcs)

const ImportRpcs = RpcGroup.make(
  Rpc.make("importArchive", {
    payload: {
      archiveId: Schema.String,
      ui: ImportUi.schema
    },
    success: ImportSummary,
    error: Schema.Union([
      ImportFailed,
      DialogUnavailable,
      Capability.CapabilityUnavailable,
      Capability.CapabilityTransportError
    ])
  })
)
```

The server can express the workflow directly with `Effect.gen`:

```ts
const ImportHandlers = ImportRpcs.of({
  importArchive: ({ archiveId, ui }) => Effect.gen(function*() {
    const entries = yield* Archives.entries(archiveId)

    for (const [index, entry] of entries.entries()) {
      if (yield* Files.exists(entry.path)) {
        const overwrite = yield* ui.confirmOverwrite({ path: entry.path })
        if (!overwrite) continue
      }

      yield* Files.write(entry)
      yield* ui.progress({
        completed: index + 1,
        total: entries.length,
        message: `Imported ${entry.path}`
      })
    }

    return new ImportSummary({ imported: entries.length })
  })
})
```

The client supplies behavior using the same Effect-native handler API:

```ts
const ui = yield* ImportUi.fromHandlers({
  progress: ({ completed, total, message }) =>
    ImportScreen.update({ completed, total, message }),
  confirmOverwrite: ({ path }) =>
    Dialog.confirm(`Replace ${path}?`)
})

const summary = yield* rpc.importArchive({ archiveId, ui })
```

Without a callback capability, this often becomes an operation ID plus progress polling, a server-side table of pending questions, and separate answer endpoints. The capability keeps the control flow in one readable Effect while preserving typed payloads, errors, cancellation, and connection scope.

Other useful callback capabilities include:

- requesting a signature while a private key stays on the client;
- resolving an application-specific conflict during synchronization;
- asking a worker for credentials only when an upstream service challenges; and
- supplying a test implementation that deterministically drives an interactive server workflow.

Calls in either direction can run concurrently, typed failures travel in either direction, and interruption of a server wait interrupts the in-flight client handler. Capability handlers can use client-side Effect services just as server capabilities capture server-side services.

Use a normal streaming RPC when the server only needs to publish a sequence of values. Use a callback capability when the server needs to invoke named client behavior, receive a typed response, or expose several related operations. Streaming capability methods themselves are not supported.

### Operational boundaries

Capabilities are intentionally connection-scoped rather than durable identities:

- reconnection does not replay mutations, recreate capabilities, or resubscribe streams; applications should explicitly re-authenticate and resubscribe;
- releasing a remote capability makes later calls fail with `CapabilityUnavailable`;
- disconnects and reverse-call transport failures are represented by `CapabilityTransportError`; and
- reverse capability calls are rejected while an atomic execution region such as a SQL transaction is active, preventing the server from holding locks while it waits for a browser or another peer. Commit first, then perform the interactive callback in a separate phase.

## Errors and requirements

Pipeline composition accumulates the same three type parameters used by Effect:

```ts
const account = rpc.findAccount({ email })
const invoices = rpc.listInvoices({ accountId: account.id })

// Effect<ReadonlyArray<Invoice>,
//   AccountNotFound | InvoiceError | Unauthorized |
//   RpcClientError | PipelineProtocolError | PipelineExecutionError,
//   ClientSchemaServices>
```

- Domain and middleware errors remain schema-backed tagged errors, so `Effect.catchTag` and `Effect.catchTags` work normally.
- Transport failures use Effect's `RpcClientError`.
- Invalid or incompatible request graphs fail with `PipelineProtocolError`.
- Server infrastructure failures use the stable `PipelineExecutionError` instead of exposing driver-specific details.
- Client schema services and required client middleware remain visible in the Effect requirement type.
- Services needed only by handlers or server middleware stay on the server.

Errors and requirements accumulate through dependent payloads, `Pipeline.all`, `Pipeline.map`, `Pipeline.andThen`, and capability calls.

## Backend request batching and caching

A pipeline can turn one client request into many related server reads. Use Effect's `Request`, `RequestResolver`, and `Cache` APIs to prevent those reads from becoming N+1 downstream queries.

`RequestBatching.cache` creates one resolver identity and cache per pipeline request:

```ts
import * as Cache from "effect/Cache"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"

class GetUser extends Request.TaggedClass("GetUser")<
  { readonly id: string },
  User,
  UserNotFound
> {}

const UserResolver = RequestResolver.make<GetUser>((entries) =>
  Effect.gen(function*() {
    const ids = Array.from(new Set(entries.map((entry) => entry.request.id)))
    const users = yield* Users.findMany(ids)
    const byId = new Map(users.map((user) => [user.id, user]))

    for (const entry of entries) {
      const user = byId.get(entry.request.id)
      entry.completeUnsafe(user
        ? Exit.succeed(user)
        : Exit.fail(new UserNotFound({ id: entry.request.id })))
    }
  })
)

const UserCache = RequestBatching.cache(UserResolver, {
  capacity: 1_024,
  timeToLive: (exit) => Exit.isSuccess(exit) ? "30 seconds" : 0
})
```

Apply the supplied middleware and use the cache in handlers:

```ts
const UserRpcs = RpcGroup.make(
  Rpc.make("getUser", {
    payload: { id: Schema.String },
    success: User,
    error: UserNotFound
  })
).middleware(RequestBatching.Middleware)

const UserHandlers = UserRpcs.toLayer({
  getUser: ({ id }) => Effect.flatMap(
    UserCache,
    Cache.get(new GetUser({ id }))
  )
})

const Routes = PipelineServer.layerHttp({
  group: UserRpcs,
  path: "/rpc"
}).pipe(
  Layer.provide(UserHandlers),
  Layer.provide(RequestBatching.layer)
)
```

Concurrent duplicate reads share a cache miss, and distinct misses reach the resolver as a batch. Resolver identities and caches are discarded after the pipeline, so unrelated requests and transactions cannot leak cached values into one another.

For multi-tenant or multi-user pipelines, either include the identity in the `Request` value or partition the cache:

```ts
const UserCache = RequestBatching.cache(UserResolver, {
  capacity: 1_024,
  partition: Effect.map(CurrentUser, (user) => user.tenantId)
})
```

Mutations should invalidate affected entries before a later query phase. Batching is not automatic for arbitrary repository effects: handlers must use the request-scoped cache, and the resolver must perform a real bulk operation.

## Transactions

Add the SQL integration to the server's `middleware` array to run every valid pipeline in one Effect SQL transaction:

```ts
import * as PipelineSql from "effect-rpc-pipeline/Sql"

const RpcRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  middleware: [PipelineSql.transaction()]
}).pipe(
  Layer.provide(AppLive),
  Layer.provide(SqlLive)
)
```

The integration wraps validated execution with Effect's `sql.withTransaction`. Successful pipelines commit once. Typed failures, defects, and interruption roll back normally, and nested Effect SQL transactions retain their normal savepoint behavior. Invalid graphs are rejected before a connection or transaction is acquired.

By default every pipeline on the route is transactional. A server can select pipelines when needed:

```ts
middleware: [
  PipelineSql.transaction({
    when: ({ rpcTags }) => rpcTags.some((tag) =>
      tag === "createTodo" || tag === "updateTodo" || tag === "deleteTodo"
    )
  })
]
```

Do not infer mutation behavior from naming conventions in library code. For applications with dynamic capability calls or mixed workloads, use an unconditional pipeline transaction or call `sql.withTransaction` explicitly in the relevant handler.

Reverse capability calls are rejected while the transaction is active, so SQL locks cannot be held while waiting for a remote peer. Complete the transaction before starting an interactive callback workflow.

## Tracing and metrics

`PipelineTelemetry.make()` adds native Effect tracing and low-cardinality metrics:

```ts
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"

const RpcRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  middleware: [PipelineTelemetry.make()]
}).pipe(Layer.provide(AppLive))
```

The default integration creates a semantic span for the complete pipeline, child spans for actual root and capability RPC invocations, and metrics for request count, duration, node count, invocation count, invocation duration, and outcomes.

It uses Effect's native tracer and metric registry. Applications that provide an Effect OpenTelemetry layer get exported pipeline telemetry without a pipeline-specific exporter or OTLP configuration.

Tracing and metrics can be configured independently:

```ts
const telemetry = PipelineTelemetry.make({
  tracing: {
    spanPrefix: "TodoPipeline",
    invocations: true
  },
  metrics: {
    prefix: "todo_rpc"
  }
})
```

Set either option to `false` to disable it. Payloads, headers, user IDs, request IDs, client IDs, and capability IDs are not included in telemetry by default.

SQL and telemetry use the same simple server surface:

```ts
middleware: [
  PipelineTelemetry.make(),
  PipelineSql.transaction()
]
```

## Advanced server middleware

Most applications should use the supplied SQL and telemetry integrations. `PipelineServer.makeMiddleware` is the escape hatch for logging, resource leasing, timeouts, auditing, or another application-specific concern:

```ts
const AuditMiddleware = PipelineServer.makeMiddleware({
  request: (effect, { request, metadata }) =>
    Effect.annotateLogs(effect, {
      pipeline: request.definitionId,
      requestId: String(metadata.requestId)
    }),
  invocation: (effect, { rpc, kind }) =>
    Effect.annotateLogs(effect, {
      rpc: rpc._tag,
      kind
    })
})

const RpcRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  middleware: [AuditMiddleware]
})
```

The optional `request`, `execution`, and `invocation` hooks wrap the entire decoded request, validated graph execution, and each actual handler invocation respectively. They are ordinary Effect transformations, so requirements and errors compose normally. Middleware is applied from first to last, with the first entry outermost when several entries use the same hook.

## Custom transports and direct execution

Most applications should use the native HTTP or WebSocket layers. Tests and embedded environments can provide a `PipelineTransport` directly:

```ts
const rpc = yield* PipelineClient.make(AppRpcs, {
  id: "app",
  transport: (request, options) =>
    PipelineServer.handle(AppRpcs, request, {
      id: "app",
      metadata: {
        client: new Rpc.ServerClient(1),
        requestId: "local",
        headers: options?.headers ?? Headers.empty
      }
    }).pipe(Effect.provideContext(AppContext))
})
```

This path is useful for unit tests and framework adapters. Native streaming and connection-scoped capabilities require the WebSocket transport.

## Execution model and limits

- Building remote values is synchronous and performs no I/O.
- Running or yielding the final `Remote` sends its complete graph.
- Independent nodes execute concurrently; dependencies and `andThen` phases preserve ordering.
- Values from different `PipelineClient` instances cannot be combined into one graph.
- Pipelines currently accept JSON-compatible literal data, arrays, objects, and Effect `Option` values.
- A server rejects malformed graphs, unknown methods, cycles, and graphs larger than 1,000 nodes.
- Pipelines provide ordering, not isolation. Use a transaction when follow-up reads must observe a transactional mutation.

## TodoMVC example

[`examples/todoapp`](./examples/todoapp) contains a complete TodoMVC implementation with:

- standard Effect RPC schemas and handlers;
- mutation-plus-query responses;
- native Effect tracing and metrics through the server middleware integration;
- HTTP and WebSocket servers on one route;
- a live update stream; and
- end-to-end tests for the full TodoMVC workflow.

See [`examples/todoapp/README.md`](./examples/todoapp/README.md) for commands and entry points.

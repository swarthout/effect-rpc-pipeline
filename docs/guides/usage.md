# Usage guide

Start with the [runnable quickstart](../../README.md). These sections contain illustrative fragments: bindings such as `Users`, `Todo`, `AppRpcs`, and service implementations belong to the surrounding application. The [todo](../../examples/todoapp) and [blog](../../examples/blogapp) applications provide complete runnable integrations. Read [contracts and limits](contracts.md) for the precise serialization, lifetime, and compatibility boundaries.

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

The server receives one dependency graph. It runs `findUser`, passes the resulting `id` to `getProfile`, and returns only the selected object. The client infers selected data fields, typed errors, and Effect requirements throughout the graph. Finite results contain data without class prototypes; see [contracts and limits](contracts.md).

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
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"

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
import * as HttpRouter from "effect/http/HttpRouter"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
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

Define the generated client as an Effect service, then provide the HTTP implementation as a Layer. The service is inferred from the same RPC group, so it stays in sync with the contract:

```ts
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"

class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof AppRpcs>
>()("app/AppClient") {}

const AppClientHttp = PipelineClient.layerClientHttp(AppClient, AppRpcs, {
  url: "http://127.0.0.1:8787/rpc",
  id: "app"
}).pipe(Layer.provide(RpcSerialization.layerJson))

const program = Effect.gen(function*() {
  const rpc = yield* AppClient
  // Running a single remote value sends one request.
  return yield* rpc.findUser({ email: "ada@example.com" })
}).pipe(Effect.provide(AppClientHttp))
```

The HTTP facade is reusable and does not require `Scope`. Each finite pipeline execution, including an entire dependency graph, opens and closes one internal Effect RPC scope. This makes a client Layer safe to keep for the application lifetime without constructing a client for every call. Use the scoped WebSocket client for streams and connection-scoped capabilities.

For a local tool or test that does not need a service, `PipelineClient.makeHttp(AppRpcs, options)` returns the same resource-safe facade directly. The lower-level `PipelineClient.make` and protocol Layers remain available for custom transports and explicit resource control.

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

## Authentication and authorization

Headers use the normal Effect RPC API and apply to the complete pipeline request:

```ts
import * as RpcClient from "effect/rpc/RpcClient"

const result = yield* Pipeline.all({
  me: rpc.me(),
  todos: rpc.listTodos({ filter: "all" })
}).pipe(
  RpcClient.withHeaders({ authorization: `Bearer ${token}` })
)
```

Authentication remains ordinary Effect RPC middleware. The optional `Auth` module only handles strict bearer extraction, redaction, and wiring an application-owned verifier into a typed principal service:

```ts
import * as Context from "effect/Context"
import * as Redacted from "effect/Redacted"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import * as Auth from "effect-rpc-pipeline/Auth"

class CurrentUser extends Context.Service<CurrentUser, User>()("app/CurrentUser") {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  reason: Schema.String
}) {}

class AccessTokenVerifier extends Context.Service<AccessTokenVerifier, {
  verify: (token: Redacted.Redacted<string>) => Effect.Effect<User, Unauthorized>
}>()("app/AccessTokenVerifier") {}

class Authenticated extends RpcMiddleware.Service<Authenticated, {
  provides: CurrentUser
  requires: AccessTokenVerifier
}>()("app/Authenticated", { error: Unauthorized, requiredForClient: true }) {}

const PrivateRpcs = RpcGroup.make(
  Rpc.make("me", { success: User }),
  Rpc.make("privateTodos", { success: Schema.Array(Todo) })
).middleware(Authenticated)

const PrivateHandlers = PrivateRpcs.toLayer({
  me: () => CurrentUser,
  privateTodos: () => Effect.flatMap(CurrentUser, (user) => Todos.forUser(user.id))
})

const AuthenticatedLive = Auth.layerBearer(Authenticated, {
  principal: CurrentUser,
  authenticate: (token) => Effect.flatMap(
    AccessTokenVerifier,
    (verifier) => verifier.verify(token)
  ),
  unauthorized: () => new Unauthorized({ reason: "invalid credentials" })
})

const PrivateRoutes = PipelineServer.layerHttp({
  group: PrivateRpcs,
  path: "/rpc"
}).pipe(
  Layer.provide(PrivateHandlers),
  Layer.provide(AuthenticatedLive),
  Layer.provide(AccessTokenVerifierLive)
)
```

For a mixed public and protected group, provide the required client middleware once and read the current token for every pipeline execution:

```ts
import * as Option from "effect/Option"

class CurrentAccessToken extends Context.Reference<
  Option.Option<Redacted.Redacted<string>>
>("app/CurrentAccessToken", { defaultValue: Option.none }) {}

const AuthenticatedClient = Auth.layerClientBearer(Authenticated, {
  token: CurrentAccessToken
})

const ClientLive = PipelineClient.layerClientHttp(AppClient, AppRpcs, {
  url: "/rpc"
}).pipe(
  Layer.provide(AuthenticatedClient),
  Layer.provide(RpcSerialization.layerJson)
)

const privateProgram = Effect.gen(function*() {
  const rpc = yield* AppClient
  return yield* rpc.me().pipe(
    Effect.provideService(
      CurrentAccessToken,
      Option.some(Redacted.make(accessToken))
    )
  )
}).pipe(Effect.provide(ClientLive))
```

`None` sends no authorization header, so public RPCs work anonymously. A refreshed token is observed without rebuilding the client. This is only credential propagation: protected server middleware still authenticates every invocation.

`Auth.layerBearer` does not verify JWTs itself. Implement `AccessTokenVerifier` with a maintained JOSE/OIDC library and pin the allowed algorithm, issuer, audience, token type, expiration, and required claims. Send bearer credentials only in the `Authorization` header over TLS; never put them in pipeline payloads or URLs. `Redacted` reduces accidental disclosure in logs but is not encryption.

Keep public and protected surfaces explicit, and optionally assert that no RPC was exposed accidentally:

```ts
const PublicRpcs = RpcGroup.make(Health)
const PrivateRpcs = RpcGroup.make(Me, ListTodos).middleware(Authenticated)
const AppRpcs = PublicRpcs.merge(PrivateRpcs)

yield* Auth.assertCoverage(AppRpcs, {
  public: [Health],
  protectedBy: Authenticated
})
```

Authentication answers who the caller is. Coarse role or scope checks can be another RPC middleware, while resource authorization should stay in the domain operation and constrain the actual read or mutation:

```ts
updateTodo: ({ id, patch }) => Effect.gen(function*() {
  const user = yield* CurrentUser
  return yield* Todos.updateOwnedBy({ ownerId: user.id, id, patch })
})
```

Do not authorize from a client-supplied `userId`. Client middleware is a convenience for adding credentials; server middleware is always the security boundary.

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

The pipeline client exposes finite methods as `Remote` Effects and streaming methods as native Effect `Stream` values. A WebSocket client is a real scoped resource, so its service Layer is the natural owner of the connection:

```ts
import * as Socket from "effect/socket/Socket"

class TodoClient extends Context.Service<
  TodoClient,
  PipelineClient.Client<typeof TodoRpcs>
>()("app/TodoClient") {}

const TodoClientWebSocket = PipelineClient.layerClientWebSocket(
  TodoClient,
  TodoRpcs,
  { url: "ws://127.0.0.1:8787/rpc" }
).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(Socket.layerWebSocketConstructorGlobal)
)

const program = Effect.gen(function*() {
  const rpc = yield* TodoClient
  yield* rpc.watchTodos().pipe(
    Stream.runForEach((event) => Effect.log("todo update", event))
  )
}).pipe(Effect.provide(TodoClientWebSocket))
```

The Layer opens one connection when acquired, shares it across calls, streams, and connection-scoped capabilities, and closes it when the Layer scope ends. At an application boundary that means one application connection. Providing the Layer inside `Effect.scoped` gives a shorter connection lifetime. `PipelineClient.makeWebSocket` exposes the same scoped constructor when explicit ownership is useful.

The lower-level `layerWebSocket` supplies Effect's protocol and uses Effect's socket RPC transport, including multiplexing, acknowledgements, interruption, ping/pong, and reconnect policy hooks. Use `layerProtocolWebSocket` when supplying an Effect `Socket` yourself.

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

const OpenSession = Rpc.make("openSession", { success: Session.schema })
const AppRpcs = RpcGroup.make(OpenSession).middleware(Authenticated)
```

The server returns an implementation with `fromHandlers`:

```ts
const AppHandlers = AppRpcs.of({
  openSession: () => Effect.gen(function*() {
    const user = yield* CurrentUser
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
const session = yield* rpc.openSession().pipe(
  RpcClient.withHeaders({ authorization: `Bearer ${token}` })
)

const result = yield* Effect.gen(function*() {
  const todo = yield* session.createTodo({ title: "Learn Effect" })
  const todos = yield* session.listTodos()
  return { todo, todos }
})
```

Authentication happens before the capability is minted. Possession of `session` is then the authority to call exactly `SessionRpcs` for the captured user; the raw JWT is not stored in the capability or repeated in its payloads.

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
const session = yield* rpc.openSession().pipe(
  RpcClient.withHeaders({ authorization: `Bearer ${token}` })
)
const user = yield* session.currentUser()
const todos = yield* session.listTodos()

yield* Capability.release(session)
```

The capability is scoped to its connection and is revoked automatically when that connection closes. `Capability.release` lets the client release it earlier.

Over HTTP, use the capability inside the pipeline that creates it:

```ts
const session = rpc.openSession()

const account = yield* Pipeline.all({
  user: session.currentUser(),
  todos: session.listTodos()
}).pipe(RpcClient.withHeaders({ authorization: `Bearer ${token}` }))
```

An HTTP capability cannot be retained for another request.

This gives capabilities two useful lifetimes:

| Transport | Lifetime | Typical use |
| --- | --- | --- |
| WebSocket | Until release or disconnect | Delegated sessions, resource handles, and callbacks |
| HTTP | The pipeline that creates the capability | Authenticate and perform dependent work in one round trip |

Because capability methods are normal remote values, they compose with the rest of the pipeline API. Authentication and the authorized work can be sent as one dependency graph:

```ts
const session = rpc.openSession()

const dashboard = yield* Pipeline.all({
  user: session.currentUser(),
  todos: session.listTodos()
}).pipe(RpcClient.withHeaders({ authorization: `Bearer ${token}` }))
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

- capability identifiers are random opaque authority values and are bound to their connection, duplex session, owner, and exact capability definition;
- payloads, successes, and declared failures are schema-validated in both directions, and malformed peer values fail with `CapabilityTransportError`;
- returning a capability as an HTTP result is rejected; HTTP capabilities must remain intermediate values inside the pipeline that creates them;
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

### Run effects after a successful commit

Register best-effort follow-up work from a transactional handler with `PipelineSql.afterCommit`:

```ts
createPost: (input) => Effect.gen(function*() {
  const post = yield* Posts.create(input)

  yield* PipelineSql.afterCommit(
    PostEvents.publish({ _tag: "PostCreated", postId: post.id })
  )

  return post
})
```

Registered effects run sequentially after the outer pipeline transaction commits. They are discarded on rollback and run with the pipeline's outer service context, after the transaction connection has been released. Materialize invocation-local values such as `CurrentUser` before registering the effect. A post-commit failure is logged by default and cannot turn an already committed mutation into a reported rollback; customize reporting with `onAfterCommitFailure`.

This hook is appropriate for in-process notifications, cache invalidation, and best-effort telemetry that must not run before commit. It is not a durable delivery mechanism. Use a transactional outbox when work must survive a process crash or be retried reliably.

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

Most applications should use the native HTTP or WebSocket client Layers. SSR, tests, workers, and embedded environments can run the same server path without serialization or network I/O:

```ts
const AppClientInProcess = PipelineClient.layerClientInProcess(
  AppClient,
  AppRpcs,
  {
    id: "app",
    middleware: [PipelineTelemetry.make(), PipelineSql.transaction()]
  }
).pipe(Layer.provide(AppLive))

const flags = Effect.gen(function*() {
  const rpc = yield* AppClient
  return { posts: yield* rpc.listPosts({ limit: 20 }) }
}).pipe(Effect.provide(AppClientInProcess))
```

The in-process client uses normal graph validation, middleware, authentication headers, limits, handlers, batching, and transactions. It is not a handler shortcut. Native streams and connection-scoped capabilities still require WebSocket.

Framework adapters can also provide a `PipelineTransport` directly:

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
- A server rejects malformed graphs, unknown methods, cycles, and requests that exceed its execution limits.
- Pipelines provide ordering, not isolation. Use a transaction when follow-up reads must observe a transactional mutation.

The defaults allow 1,000 graph nodes, 1,000 items in each remote map, 10,000 total RPC invocations, and 64 concurrent invocations across the whole graph. Pure template expansion is additionally capped by `maxExecutionSteps` (100,000 by default), and graph dependencies are compiled once for all scheduling waves. Structure depth and value counts are also bounded; see [contracts and limits](contracts.md). Tighten them for the cost profile of your API:

```ts
PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  limits: {
    maxNodes: 250,
    maxMapItems: 100,
    maxInvocations: 500,
    concurrency: 16
  }
})
```

Use the generic server middleware integration for rate limits and quotas. Authentication identifies the caller; it does not by itself limit how much work an authenticated caller may request.

## TodoMVC example

[`examples/todoapp`](../../examples/todoapp) contains a complete TodoMVC implementation with:

- standard Effect RPC schemas and handlers;
- JWT bearer authentication through native RPC middleware and a typed `CurrentUser` service;
- per-user storage and stream isolation, with invalid-token and cross-user end-to-end tests;
- mutation-plus-query responses;
- native Effect tracing and metrics through the server middleware integration;
- HTTP and WebSocket servers on one route;
- a live update stream; and
- end-to-end tests for the full TodoMVC workflow.

See [`examples/todoapp/README.md`](../../examples/todoapp/README.md) for commands and entry points.

## Full-stack blog example

[`examples/blogapp`](../../examples/blogapp) is a production-shaped Effect, Node.js, SQLite, JWT, and Foldkit application. It covers public reading, registration, post authoring and editing, comments, upvotes, administration, secure cookie refresh sessions, request batching, SQL transactions and post-commit events, telemetry, HTTP and WebSocket client Layers, SSR through an in-process pipeline client, streams, server capabilities, and client callbacks.

See [`examples/blogapp/README.md`](../../examples/blogapp/README.md) for the architecture, setup, pipeline patterns, security model, and test coverage. Package issues discovered through the example are tracked in [`examples/blogapp/PACKAGE_AUDIT.md`](../../examples/blogapp/PACKAGE_AUDIT.md).

# Usage guide

Use this guide to add pipelines to an Effect RPC application. If you need a complete program first, run the [README quickstart](../../README.md#quickstart).

The examples here are integration fragments. Names such as `Users`, `Todo`, and `AppRpcs` refer to services and schemas in the surrounding application. The [todo](../../examples/todoapp) and [blog](../../examples/blogapp) examples show complete wiring.

Define RPCs and handlers with the usual Effect APIs. On the client, an ordinary result-returning call first gives you a remote value. It sends work only when run as an Effect.

Here the profile lookup depends on the user lookup:

```ts
const user = rpc.findUser({ email: "ada@example.com" })

const result = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id })
})
```

The server runs `findUser`, passes its ID to `getProfile`, and returns the selected object. The client retains the selected result type, possible errors, and required services.

Finite results contain plain data, without class prototypes. See [contracts and limits](contracts.md) for the exact boundary.

## Why pipeline RPC?

Use a pipeline when related RPCs would otherwise need several round trips. The client chooses which calls to compose and which data to return. The server still controls the exposed operations, schemas, and authorization.

This package is useful when you want to:

- remove round trips between dependent RPC calls;
- batch independent queries into one request;
- return client-selected data after a mutation;
- map typed server operations over arrays and Effect `Option` values;
- expose authenticated or callback capabilities over WebSocket; and
- keep Effect's normal error, requirement, middleware, stream, and SQL APIs.

## Installation

```sh
npm install effect@~4.0.6 effect-rpc-pipeline
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

Define a client service from the same RPC group. Provide an HTTP implementation as a Layer so application code can request the service without choosing its transport:

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

The HTTP client is reusable and does not require `Scope`. Each graph execution opens and closes its own internal scope, so the client Layer can live for the whole application.

Use WebSocket when you need streams or capability handles that survive a request.

For a script or test, call `PipelineClient.makeHttp(AppRpcs, options)` directly. Custom transports can use the lower-level `make` and protocol Layers.

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

Read a field from a remote value to pass it to a later call. This builds a dependency; it does not fetch the field on the client:

```ts
const user = rpc.findUser({ email })

const result = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id }),
  friendIds: rpc.listFriendIds({ userId: user.id })
})
```

The server waits for `findUser`, then runs the profile and friend-ID lookups concurrently. No explicit ordering call is needed.

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

For arrays, the server evaluates items concurrently. For an Option, it runs the mapped calls for `Some` and skips them for `None`.

Calls built inside the callback run per item. Build a call outside it when its result should be shared. Nested maps can refer to outer items.

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

The callback runs on the client while the graph is being built. Its `created` argument is symbolic. You can project its fields or pass them to another RPC, but JavaScript branching cannot inspect them.

Put a decision that needs server data in an RPC handler.

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

### Protect the server RPCs

Use native Effect RPC middleware for authentication. `Auth.layerBearer` extracts and redacts the bearer credential, then passes it to your verifier. The result becomes a typed principal service for handlers.

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

### Read the current token on the client

Provide the client middleware once. It reads the current token for every pipeline execution, so it can serve both public and protected RPCs:

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

`None` sends no authorization header, allowing public calls to run anonymously. A new token is observed on the next execution without rebuilding the client.

Protected server middleware still authenticates every invocation.

### Supply token verification

`Auth.layerBearer` does not verify JWTs. Implement `AccessTokenVerifier` with a JOSE/OIDC library that checks the allowed algorithm, issuer, audience, token type, expiration, and required claims.

Send credentials in the Authorization header over TLS. Do not put them in payloads or URLs. `Redacted` helps avoid accidental logging; it does not encrypt the token.

### Check authentication coverage

Declare which RPCs are public and which require authentication. `assertCoverage` can check that none were exposed accidentally:

```ts
const PublicRpcs = RpcGroup.make(Health)
const PrivateRpcs = RpcGroup.make(Me, ListTodos).middleware(Authenticated)
const AppRpcs = PublicRpcs.merge(PrivateRpcs)

yield* Auth.assertCoverage(AppRpcs, {
  public: [Health],
  protectedBy: Authenticated
})
```

### Authorize the resource

Authentication identifies the caller. A handler must still decide whether that caller can read or change a particular resource. Use additional RPC middleware for coarse role or scope checks.

For example, constrain a mutation by the authenticated owner:

```ts
updateTodo: ({ id, patch }) => Effect.gen(function*() {
  const user = yield* CurrentUser
  return yield* Todos.updateOwnedBy({ ownerId: user.id, id, patch })
})
```

Use the server-provided principal for ownership checks, rather than trusting a client-supplied `userId`. Adding a credential on the client is not an access check.

Middleware marked `requiredForClient` is captured when `PipelineClient.make` runs. Middleware shared by several graph nodes runs once around the whole batch.

## WebSockets and streams

### Serve HTTP and WebSocket together

Use POST for finite HTTP pipelines and GET upgrades for persistent WebSocket connections. Both routes can share a path:

```ts
const RpcRoutes = Layer.merge(
  PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc", id: "app" }),
  PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc", id: "app" })
).pipe(Layer.provide(AppLive))
```

### Define a streaming RPC

Use Effect’s standard stream definition and handler forms:

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

### Own the connection with a Layer

Result-returning methods produce remote Effects. Streaming methods produce native Effect Streams. A WebSocket client owns a connection, so give it a service Layer whose scope controls that connection:

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

Acquiring the Layer opens one connection. Calls, streams, and persistent capabilities share it. Releasing the Layer closes it.

Provide it at the application boundary for an application-wide connection, or inside `Effect.scoped` for a shorter lifetime. `makeWebSocket` also exposes the scoped constructor directly.

For custom socket wiring, `layerWebSocket` supplies Effect’s protocol and socket RPC transport. It supports multiplexing, acknowledgements, interruption, ping/pong, and reconnect policy hooks. Use `layerProtocolWebSocket` to supply your own Effect `Socket`.

Streams have an independent, backpressured lifetime and cannot be embedded in finite `Pipeline.all`, `Pipeline.map`, or `Pipeline.andThen` graphs.

## Typed capabilities

A capability is a typed RPC client that can itself be sent as an RPC value. It combines two ideas:

- a surface of methods, defined by an ordinary Effect `RpcGroup`; and
- authority to call one particular implementation of those methods.

For example, a session capability can remember an authenticated user, and a document capability can remember which document was opened. Their methods then need only the arguments relevant to each operation.

The receiver gets a typed Effect RPC client. Functions and closures remain on the side that created them.

Calling a capability method sends its opaque handle, method name, and schema-encoded payload back to its owner. The owner executes the handler with the captured Effect context.

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

#### Implement the methods

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

`Session.fromHandlers` accepts the same handlers, middleware, errors, and services as `RpcGroup.toHandlers`. It captures the Effect context where it is created.

Here each session captures its own `CurrentUser`. Later method calls use that user without requiring a token or user ID in each payload.

#### Use the session

The client can authenticate once when opening the capability, then call its methods:

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

Authentication runs before the session is created. The session grants access to its declared methods for the captured user. The raw JWT is not stored in the handle or repeated in method payloads.

#### Expose only the methods needed

A capability can offer a smaller API than the whole application. This editor exposes only two methods for one todo:

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

In the HTTP example, the server authenticates first, then runs the independent session calls concurrently. Only the selected `account` data comes back; the intermediate capability handle stays on the server.

### Client callbacks

Capabilities are bidirectional over WebSocket. A client can implement a capability, include it in a request, and let the server call it. This provides typed callbacks without callback URLs, a second protocol, polling, or function serialization.

#### Ask for checkout approval

The server can ask the client to approve a checkout total and wait for its answer:

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

#### Report progress and ask questions

A longer workflow can expose several callbacks. This file import reports progress and asks before overwriting a file:

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

The server waits for a typed response from the client at each interaction. The workflow remains an Effect, with its usual errors, interruption, and connection scope.

Other useful callback capabilities include:

- requesting a signature while a private key stays on the client;
- resolving an application-specific conflict during synchronization;
- asking a worker for credentials only when an upstream service challenges; and
- supplying a test implementation that deterministically drives an interactive server workflow.

Calls can run concurrently in either direction, and typed failures travel back to the caller. Interrupting the server’s wait interrupts the active client handler.

Client handlers can use captured Effect services, just like server capability handlers.

#### Choose streams or callbacks

Use a stream to publish a sequence of values. Use a callback capability when the server needs to invoke a named client operation and receive its response, or when several related operations belong together.

Capability methods themselves cannot be streaming RPCs.

### Operational boundaries

Keep these rules in mind when exposing capabilities:

| Event | Behavior |
| --- | --- |
| Release a handle | Later calls fail with `CapabilityUnavailable` |
| Disconnect or reverse-call transport failure | Calls fail with `CapabilityTransportError` |
| Reconnect | The application must authenticate, acquire handles, and subscribe again |
| Return a handle as an HTTP result | Rejected; HTTP capabilities must stay inside their creating graph |
| Call a remote peer inside a SQL transaction | Rejected; finish the transaction before the interactive callback |

Handles are random, opaque authority values bound to their connection, duplex session, owner, and exact capability definition.

Payloads, results, and declared failures are schema-validated in both directions. Malformed peer values fail with `CapabilityTransportError`. Reconnection does not replay mutations.

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

### Define a bulk resolver

`RequestBatching.cache` supplies a resolver identity and cache for each pipeline request:

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

### Wire the handlers

Use the cache in handlers. The supplied middleware also makes it available to standalone RPC calls:

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

Concurrent reads for the same key share a cache miss. Different missing keys reach the resolver as a batch. The cache and resolver identity are discarded after the pipeline.

Unrelated requests and transactions therefore do not reuse those cached values.

### Partition and invalidate the cache

When one graph can use several tenants or users, include that identity in the `Request` key or partition the cache:

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

A successful graph commits once. Typed failures, defects, and interruption roll back through Effect’s `sql.withTransaction`. Nested Effect SQL transactions keep their normal savepoint behavior.

Graph validation happens before acquiring a connection or starting a transaction.

### Choose which graphs need a transaction

The default is to transact every graph on the route. Use `when` to select graphs explicitly:

```ts
middleware: [
  PipelineSql.transaction({
    when: ({ rpcTags }) => rpcTags.some((tag) =>
      tag === "createTodo" || tag === "updateTodo" || tag === "deleteTodo"
    )
  })
]
```

Choose mutation tags explicitly in application code. For dynamic capability calls or mixed workloads, use an unconditional transaction or put `sql.withTransaction` inside the handler that needs it.

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

The effects run sequentially after the outer pipeline transaction commits. Rollback discards them. They use the outer service context after the transaction connection is released.

Read invocation-local values such as `CurrentUser` before registering the effect, and pass the needed data into it.

A failure is logged by default and cannot undo the committed mutation. Use `onAfterCommitFailure` to customize reporting.

Use this hook for best-effort notifications, cache invalidation, or telemetry that must wait for commit. For work that must survive a process crash or be retried reliably, use a transactional outbox.

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

The default integration records:

- A span for the complete pipeline.
- Child spans for root and capability RPC invocations.
- Metrics for request count, duration, graph size, invocation count, invocation duration, and outcomes.

Telemetry uses Effect’s tracer and metric registry. Provide an Effect OpenTelemetry Layer to export it; no separate pipeline exporter is needed.

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

Choose a hook based on the work it should surround:

| Hook | Wraps |
| --- | --- |
| `request` | The decoded request and subsequent validation/execution flow |
| `execution` | The validated graph, including its transaction boundary |
| `invocation` | Each actual root or capability handler invocation |

Hooks transform ordinary Effects, so their errors and requirements compose normally. The first middleware entry is outermost when several entries use the same hook.

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

An in-process client still runs validation, middleware, authentication headers, limits, handlers, batching, and transactions. It executes through the server rather than calling handlers directly.

Streams and persistent capabilities require WebSocket.

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

The defaults allow 1,000 nodes, 1,000 items per mapped array, 10,000 attempted invocations, and 64 concurrent invocations across the graph.

`maxExecutionSteps` also caps template expansion at 100,000 steps, including maps that make no RPC calls. Graph dependencies are compiled once for all scheduling waves.

Structure depth and value counts have separate bounds. See [contracts and limits](contracts.md), then choose limits for your handlers’ cost:

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

[`examples/blogapp`](../../examples/blogapp) is a blog built with Effect, Node.js, SQLite, JWT authentication, and Foldkit.

Its UI covers public reading, registration, writing and editing posts, comments, votes, and administration. The server demonstrates cookie refresh sessions, batching, transactions, telemetry, SSR, streams, capabilities, and callbacks.

See [`examples/blogapp/README.md`](../../examples/blogapp/README.md) for the architecture, setup, pipeline patterns, security model, and test coverage. Package issues discovered through the example are tracked in [`examples/blogapp/PACKAGE_AUDIT.md`](../../examples/blogapp/PACKAGE_AUDIT.md).

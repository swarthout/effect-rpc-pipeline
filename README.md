# effect-rpc-pipeline

Compose typed Effect RPC calls into one request.

Pass the result of one RPC to another without waiting for it to travel back to the client. The server resolves the dependencies and returns the data you select.

You define the RPCs with Effect. This library adds a way to compose them on the client.

Start with [installation](#install) and the [quickstart](#quickstart), or read [how execution works](#how-execution-works). The rest of this README introduces authentication, streams, capabilities, batching, and transactions.

Read [How pipelines work](docs/guides/how-pipelines-work.md) for the API design tradeoffs and the approach behind this library. The [usage guide](docs/guides/usage.md) has detailed integrations, and the [API reference](docs/api.md) lists every public type and function.

## Why pipeline RPC?

Suppose a screen needs a user and that user’s profile. With sequential RPC calls, the client fetches the user, waits for the response, and then sends the user ID in a second request.

A pipeline sends both operations together. On the server, the profile lookup waits for the user lookup. The result comes back in one response.

The client describes the work using the RPCs you expose. Your handlers, schemas, and authentication middleware still control what each operation can do.

Use pipelines to:

- Fetch related data with fewer network round trips.
- Run independent queries in one request.
- Return refreshed data after a mutation.
- Call a restricted set of methods through a typed capability.

A single network request can still produce many database queries. [Backend batching](docs/guides/usage.md#backend-request-batching-and-caching) combines those reads; [transactions](docs/guides/usage.md#transactions) make database changes atomic.

**Requirements:** version 0.1.0 uses Effect 4.0.6 and ESM. Servers need Node.js 24.11+ in the 24.x line, or Node.js 26+. Clients also run in modern browsers. See [compatibility](docs/guides/contracts.md#compatibility) for the tested environment.

## Install

```sh
npm install effect@~4.0.6 effect-rpc-pipeline
```

For the Node.js quickstart, also install the platform package and a TypeScript runner:

```sh
npm install @effect/platform-node@4.0.6
npm install --save-dev tsx
npm pkg set type=module
```

## Quickstart

This example finds a user, then fetches their profile in the same pipeline. Create the following three files in one directory.

### 1. Define the RPC contract

Create `rpcs.ts`. Both the server and client import this group.

<!-- snippet:rpcs:start -->
```ts
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"

export const AppRpcs = RpcGroup.make(
  Rpc.make("findUser", {
    payload: { email: Schema.String },
    success: Schema.Struct({ id: Schema.String, name: Schema.String })
  }),
  Rpc.make("getProfile", {
    payload: { userId: Schema.String },
    success: Schema.Struct({ bio: Schema.String })
  })
)
```
<!-- snippet:rpcs:end -->

### 2. Implement and serve the RPCs

Create `server.ts`. The handlers below return sample data; an application would read from its own services.

<!-- snippet:server:start -->
```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { createServer } from "node:http"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { AppRpcs } from "./rpcs.js"

const Handlers = AppRpcs.toLayer({
  findUser: () => Effect.succeed({ id: "ada", name: "Ada" }),
  getProfile: ({ userId }) => Effect.succeed({ bio: `Profile for ${userId}` })
})

const Routes = PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc" }).pipe(
  Layer.provide(Handlers)
)

const Server = HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787, host: "127.0.0.1" })),
  Layer.provide(RpcSerialization.layerJson)
)

Layer.launch(Server).pipe(NodeRuntime.runMain)
```
<!-- snippet:server:end -->

### 3. Compose the client calls

Create `client.ts`. `user.id` is a reference to the server’s future result, so it can be passed directly to `getProfile`.

<!-- snippet:client:start -->
```ts
import * as Effect from "effect/Effect"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs } from "./rpcs.js"

const program = Effect.gen(function*() {
  const rpc = yield* PipelineClient.makeHttp(AppRpcs, {
    url: "http://127.0.0.1:8787/rpc"
  })
  const user = rpc.findUser({ email: "ada@example.com" })
  return yield* Pipeline.all({
    user,
    profile: rpc.getProfile({ userId: user.id })
  })
}).pipe(Effect.provide(RpcSerialization.layerJson))

console.log(await Effect.runPromise(program))
```
<!-- snippet:client:end -->

### 4. Run the example

Start the server, then run the client in a second terminal:

```sh
node --import tsx server.ts
node --import tsx client.ts
```

The client prints:

```text
{ user: { id: "ada", name: "Ada" }, profile: { bio: "Profile for ada" } }
```

The server ran `findUser` first, then passed its ID to `getProfile`. Both calls traveled in one HTTP pipeline request.

The [quickstart source files](docs/snippets) are checked by TypeScript. To run them from this repository, build the package first, then use `node --import tsx docs/snippets/server.ts` and `node --import tsx docs/snippets/client.ts`.

## How execution works

An RPC that returns one result gives you a `Pipeline.Remote<A, E, R>`. This **remote value** describes a future result. It is also an Effect: running it executes the graph and produces that result.

Its type carries the success value (`A`), possible errors (`E`), and required services (`R`).

1. Calling `rpc.findUser(...)` builds a graph node without sending anything.
2. Reading `user.id` builds a field reference. Passing it to another RPC establishes a dependency.
3. `Pipeline.all` selects the data to return and combines the referenced operations into one graph.
4. Running the final remote sends that graph. The server validates it, schedules ready operations, and returns the selected data.

In the quickstart, `getProfile` depends on `findUser`. Independent calls can run concurrently, up to the server’s concurrency limit.

### Reuse and repeat execution

A remote value is lazy. Building or reusing it does not send a request.

- Include the same remote several times in one `Pipeline.all` to share one graph node.
- Construct two separate calls to get two separate operations, even if their payloads match.
- Run the same remote twice to execute its graph twice, including any mutations.

All values in a graph must come from the same client instance.

### Choose the batching operator

Use `Pipeline.all` to combine calls into one pipeline request. `Effect.all` runs the remote Effects separately and can send several requests.

## Compose calls and select results

The following examples run inside `Effect.gen` with an `rpc` client that exposes the methods shown. Their full contracts are in the checked [example source](docs/snippets/overview.ts).

### Select several results

Use `Pipeline.all` to describe the result you want back. You can select remote values, individual fields, literals, arrays, and nested objects. Intermediate results can stay on the server.

<!-- snippet:selection:start -->
```ts
const user = rpc.findUser({ email })

const account = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id }),
  friendIds: rpc.listFriendIds({ userId: user.id })
})
```
<!-- snippet:selection:end -->

Here both lookups need `user.id`. Once `findUser` finishes, they can run concurrently. The resulting Effect includes their errors and service requirements.

### Map arrays and Options

Use `Pipeline.map` when an RPC returns an array and you want to perform work for each element. Here `listFriendIds` returns an array of strings:

<!-- snippet:map:start -->
```ts
const friends = yield* Pipeline.map(
  rpc.listFriendIds({ userId }),
  (friendId) => ({
    id: friendId,
    profile: rpc.getProfile({ userId: friendId })
  })
)
```
<!-- snippet:map:end -->

The callback describes work for the server to repeat for each item. A call built inside the callback runs once per item. Build a call outside the callback when its result should be shared.

Maps can be nested, and an inner map can refer to an outer item.

The same operator handles Effect `Option` values. For `Some(user)`, the server runs the mapped calls and returns `Some(profile)`. For `None`, it skips those calls and returns `None`.

<!-- snippet:option:start -->
```ts
const profile = yield* Pipeline.map(
  rpc.findUserByHandle({ handle }),
  (user) => rpc.getProfile({ userId: user.id })
)
```
<!-- snippet:option:end -->

### Work with symbolic values

Map and sequencing callbacks run on the client while the graph is being built. Their inputs describe server results; they do not contain those results yet.

You can project a field, pass it to another RPC, select it, or map it. To branch, calculate, or format a string based on remote data, put that work in an RPC handler.

### Read after a mutation

`Pipeline.andThen` makes later calls wait for the earlier work to finish. Use it to read updated data after a mutation, including reads that do not directly use the mutation’s result:

<!-- snippet:phase:start -->
```ts
const refreshed = yield* rpc.renameUser({ userId, name }).pipe(
  Pipeline.andThen((user) => ({
    user,
    profile: rpc.getProfile({ userId: user.id }),
    friendIds: rpc.listFriendIds({ userId })
  }))
)
```
<!-- snippet:phase:end -->

After the rename finishes, the server fetches the profile and friend IDs concurrently. The client receives its chosen response shape in the same pipeline request.

Use `Pipeline.zipRight(first, second)` when you only need the second result. For database isolation as well as ordering, add a [SQL transaction](docs/guides/usage.md#transactions).

## Use clients as Effect services

Use `makeHttp` directly in scripts. In an application, define a client service and provide its implementation as an Effect Layer:

<!-- snippet:client-service:start -->
```ts
class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof AppRpcs>
>()("app/AppClient") {}

const AppClientLive = PipelineClient.layerClientHttp(AppClient, AppRpcs, {
  url: "http://127.0.0.1:8787/rpc"
}).pipe(Layer.provide(RpcSerialization.layerJson))

const loadUser = Effect.gen(function*() {
  const rpc = yield* AppClient
  return yield* rpc.findUser({ email: "ada@example.com" })
}).pipe(Effect.provide(AppClientLive))
```
<!-- snippet:client-service:end -->

The HTTP facade can live for the application lifetime. Each finite graph owns and closes an internal scope; the facade itself does not require `Scope`. A refreshed credential can be read for each execution without rebuilding the client.

There are matching constructors and Layers for different boundaries:

| Boundary | Constructor | Service Layer | Lifetime |
| --- | --- | --- | --- |
| HTTP | `makeHttp` | `layerClientHttp` | Reusable facade; one internal scope per graph |
| WebSocket | `makeWebSocket` | `layerClientWebSocket` | Connection owned by an Effect scope or Layer |
| Same process | `makeInProcess` | `layerClientInProcess` | Finite graphs through the server without network I/O |
| Custom transport | `make` | Application-owned Layer | Defined by the supplied transport or Effect protocol |

Use an in-process client for tests, server tools, or server-side rendering (SSR). It runs graph validation, middleware, handlers, batching, and transactions without network I/O.

Streams and persistent capability handles need WebSocket. The [blog example](examples/blogapp) uses an in-process client to load its SSR pages.

## Authentication and authorization

Protect RPCs with native Effect RPC middleware. Pipeline execution runs that middleware for each protected operation and supplies the authenticated principal to the handler.

Handlers enforce resource permissions, such as whether the caller owns the record being changed.

Use normal Effect RPC headers to authenticate a complete pipeline:

<!-- snippet:headers:start -->
```ts
const user = rpc.findUser({ email })
const account = yield* Pipeline.all({
  user,
  profile: rpc.getProfile({ userId: user.id })
}).pipe(RpcClient.withHeaders({ authorization: `Bearer ${token}` }))
```
<!-- snippet:headers:end -->

The optional `Auth` helpers reduce the wiring:

- `bearerToken` extracts the credential as an Effect `Redacted` value.
- `layerBearer` connects your token verifier to a principal service.
- `layerClientBearer` reads the current credential on each execution.
- `assertCoverage` checks that every RPC is explicitly public or protected.

Your application issues and verifies tokens. For JWTs, the verifier checks the signature, allowed algorithm, issuer, audience, lifetime, and claims. Send bearer credentials in the Authorization header over TLS.

Client middleware adds headers once around the whole pipeline. It cannot rewrite each RPC payload or replace the batch with a domain result.

See the [authentication guide](docs/guides/usage.md#authentication-and-authorization) for the service wiring, and the [todo example](examples/todoapp) for token verification and ownership checks.

## WebSockets and streams

Use WebSocket when you need streams or capability handles that survive beyond one request. HTTP and WebSocket routes can share `/rpc`: POST serves HTTP pipelines, and GET upgrades open WebSocket connections.

### Serve both transports

Provide the handlers and serialization Layer to these routes as in the quickstart:

<!-- snippet:websocket-routes:start -->
```ts
const Routes = Layer.merge(
  PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc" }),
  PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc" })
)
```
<!-- snippet:websocket-routes:end -->

### Consume a stream

Ordinary methods still return remote Effects over WebSocket. Methods declared with `stream: true` return native Effect Streams. Here `watchUsers` publishes a stream of users:

<!-- snippet:websocket:start -->
```ts
const watchUsers = Effect.scoped(Effect.gen(function*() {
  const rpc = yield* PipelineClient.makeWebSocket(AppRpcs, {
    url: "ws://127.0.0.1:8787/rpc"
  })

  yield* rpc.watchUsers().pipe(
    Stream.runForEach((user) => Effect.log("User changed", user.id))
  )
})).pipe(
  Effect.provide(RpcSerialization.layerJson),
  Effect.provide(Socket.layerWebSocketConstructorGlobal)
)
```
<!-- snippet:websocket:end -->

The connection stays open while the scope is active. `layerClientWebSocket` makes the service Layer the owner when an application needs one shared connection. Calls, streams, and capabilities use that same connection.

Consume streams with Effect’s Stream operators. They have their own lifetime and backpressure, so they cannot be selected into a finite `Pipeline.all`, `map`, or `andThen` graph.

See the [WebSocket guide](docs/guides/usage.md#websockets-and-streams) for transport configuration.

## Typed capabilities and callbacks

A **capability** gives its receiver a typed set of methods tied to one implementation. For example, an authenticated session can expose `currentUser()` without asking the client to send a user ID each time.

Only an opaque handle crosses the connection. JavaScript functions and closures stay where they were created.

### Define a capability

Use an ordinary `RpcGroup` to define its methods. The capability’s schema can then be used as an RPC result. Here `User` has the `{ id, name }` fields used above:

<!-- snippet:capability-definition:start -->
```ts
const SessionRpcs = RpcGroup.make(
  Rpc.make("currentUser", { success: User }),
  Rpc.make("greet", { success: Schema.String })
)

const UserSession = Capability.make("app/UserSession", SessionRpcs)
const OpenSession = Rpc.make("openSession", { success: UserSession.schema })
```
<!-- snippet:capability-definition:end -->

### Implement its methods

The `openSession` handler reads `CurrentUser`, supplied by authentication middleware, and creates the session’s implementation:

<!-- snippet:capability-handler:start -->
```ts
class CurrentUser extends Context.Service<CurrentUser, User>()("app/CurrentUser") {}

const openSession = Effect.gen(function*() {
  const user = yield* CurrentUser
  return yield* UserSession.fromHandlers({
    currentUser: () => Effect.succeed(user),
    greet: () => Effect.succeed(`Hello ${user.name}`)
  })
})
```
<!-- snippet:capability-handler:end -->

### Call it within a pipeline

Use `openSession` as the handler for `OpenSession` in a protected RPC group. The client can then create a session and call its methods in one pipeline:

<!-- snippet:capability-pipeline:start -->
```ts
const session = rpc.openSession()
const account = yield* Pipeline.all({
  user: session.currentUser(),
  greeting: session.greet()
})
```
<!-- snippet:capability-pipeline:end -->

The server creates the session and invokes its methods, returning only the selected account data. This works over HTTP because the capability is used entirely within the graph that creates it.

### Keep a handle over WebSocket

A WebSocket client can retain the handle for later requests:

<!-- snippet:capability-persistent:start -->
```ts
// rpc is a WebSocket client whose connection scope is still open.
const session = yield* rpc.openSession()
const user = yield* session.currentUser()
yield* Capability.release(session)
```
<!-- snippet:capability-persistent:end -->

Release a remote handle when you no longer need it. Closing the connection also makes its handles unavailable. After reconnecting, request new handles. Each capability definition needs a unique ID in the module registry.

A capability retains the application services and principal present at creation. It does not retain library request caches or transaction state.

If permissions can change, check them again in the capability’s handlers. Capturing a principal does not automatically revoke a handle when a role changes or an account is suspended. The blog example shows these checks.

### Let the server call the client

WebSocket clients can also implement capabilities. For example, the client can pass a `NotificationSink` whose `notify({ message })` method returns a boolean:

<!-- snippet:callback:start -->
```ts
const sink = yield* NotificationSink.fromHandlers({
  notify: ({ message }) => Effect.log(message).pipe(Effect.as(true))
})

yield* rpc.registerNotifications({ sink })
```
<!-- snippet:callback:end -->

`registerNotifications` accepts the capability schema. Keep the WebSocket scope open while callbacks are needed.

The [capability guide](docs/guides/usage.md#typed-capabilities) covers full contracts, cancellation, and connection ownership.

## Batch backend work and cache reads

One pipeline request can still cause many database queries. `RequestBatching` uses Effect’s RequestResolver and Cache APIs to collect concurrent reads and send them to a bulk loader.

### Write a bulk resolver

The `Users` service in this example implements `findMany(ids)` with a bulk database operation:

<!-- snippet:batching:start -->
```ts
class UserNotFoundById extends Schema.TaggedError<UserNotFoundById>()("UserNotFoundById", { id: Schema.String }) {}

class GetUser extends Request.TaggedClass("GetUser")<
  { readonly id: string }, User, UserNotFoundById
> {}

const UserResolver = Effect.map(Users, (users) => RequestResolver.make<GetUser>((entries) => Effect.gen(function*() {
  const rows = yield* users.findMany(entries.map((entry) => entry.request.id))
  const byId = new Map(rows.map((user) => [user.id, user]))

  for (const entry of entries) {
    const user = byId.get(entry.request.id)
    entry.completeUnsafe(user === undefined
      ? Exit.fail(new UserNotFoundById({ id: entry.request.id }))
      : Exit.succeed(user))
  }
})))

// Construct this descriptor once, rather than inside each lookup.
const UserCache = RequestBatching.cache(UserResolver, { capacity: 1_024 })

const getUser = (id: string) => Effect.flatMap(
  UserCache,
  Cache.get(new GetUser({ id }))
)
```
<!-- snippet:batching:end -->

### Use the cache in handlers

Call `getUser` from your handlers and provide the `Users` service normally. Pipeline execution supplies one `RequestScope` around the graph.

For standalone RPCs that also need this cache, apply `RequestBatching.Middleware` and provide `RequestBatching.layer`.

Create the cache descriptor once in a service or module. Creating it inside each lookup gives every call a different cache.

When one graph can use several tenants or principals, partition the cache by that identity. Mutations should invalidate affected entries before later reads.

The resolver must perform a bulk query. A loop of single-row queries still does N+1 database work.

Concurrency limits can divide a large map into several resolver batches. One pipeline request therefore does not guarantee one database query. See the [batching guide](docs/guides/usage.md#backend-request-batching-and-caching) for details.

## Transactions, after-commit work, and telemetry

### Run a graph in a transaction

Server integrations go in the `middleware` array. This example adds Effect telemetry and a SQL transaction around each valid finite graph:

<!-- snippet:middleware:start -->
```ts
const TransactionalRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  middleware: [
    PipelineTelemetry.make(),
    PipelineSql.transaction()
  ]
})
```
<!-- snippet:middleware:end -->

Provide your handler Layer and an Effect SQL driver Layer when serving the routes.

- Successful graphs commit.
- Typed failures, defects, and interruption roll back.
- Invalid graphs are rejected before a transaction starts.

Use `transaction({ when })` to choose which graphs need a transaction.

This middleware wraps finite graphs. Streams and direct calls on an exported capability need transaction policy in their own handlers.

A pipeline transaction rejects calls to a remote peer, so it cannot hold database locks while waiting for a client response.

### Run work after commit

Use `afterCommit` inside a transactional handler for follow-up work such as a notification:

<!-- snippet:after-commit:start -->
```ts
yield* PipelineSql.afterCommit(
  Effect.log("User renamed", user.id)
)
```
<!-- snippet:after-commit:end -->

The effects run sequentially after commit and are discarded on rollback. Their failures are reported without undoing the committed mutation.

Pass the data they need explicitly. They run with the outer execution services, after the transaction connection has been released.

Use an outbox when delivery must survive a process crash. Calling `afterCommit` outside an active transaction region is a defect.

A transaction infrastructure error has `retryable: false` because a failed commit may have an unknown outcome. Make mutations idempotent before adding automatic retries.

### Trace and measure execution

`Telemetry.make` creates a span for the graph, child spans for invoked RPCs, and metrics for counts, duration, graph size, and outcomes.

It uses Effect’s tracer and metric registry, so an existing OpenTelemetry Layer can export the data. Tracing and metrics can be configured separately. Payloads and credentials are excluded.

See the [transaction](docs/guides/usage.md#transactions), [after-commit](docs/guides/usage.md#run-effects-after-a-successful-commit), and [telemetry](docs/guides/usage.md#tracing-and-metrics) guides for setup.

## Errors and supported values

### Handle errors by tag

Use normal Effect operators to handle declared RPC errors. A composed pipeline includes the errors from its dependent calls:

<!-- snippet:errors:start -->
```ts
const maybeUser = rpc.findUser({ email }).pipe(
  Effect.catchTag("UserNotFound", () => Effect.succeed(null))
)
```
<!-- snippet:errors:end -->

This handles `UserNotFound`. Other failures remain possible:

| Error | Meaning |
| --- | --- |
| `PipelineProtocolError` | Invalid graph, reference, path, operation, value, or exceeded limit |
| `PipelineExecutionError` | A safe server infrastructure failure |
| `RpcClientError` | A transport failure |

Unexpected defects remain Effect defects. Cancellation propagates to executing work and active callbacks.

The server validates the graph before starting handlers. Some payload and capability checks need earlier results, so they happen later. A failure can occur after a mutation has completed.

Use a transaction when rollback is required. The library does not automatically retry a graph or guarantee exactly-once execution.

### Return plain data

Finite pipelines return JSON data, `undefined`, and Effect Options. A schema class returns its fields, without its prototype or methods. `Pipeline.Data<A>` describes that result.

Use error tags rather than `instanceof` for remote domain errors.

Represent Dates, maps, sets, and binary buffers with explicit data transfer schemas, or use native RPC outside a finite graph. Symbolic graph expressions do not run arbitrary client-side schema transformations.

Unsupported or cyclic inputs fail during construction. Unsupported or oversized final results fail instead of being silently coerced.

For reserved fields, use `Pipeline.field(remote, "then")` or `Pipeline.field(remote, "graph")`. Fields such as `name` and `length` project directly.

The [contracts guide](docs/guides/contracts.md) lists reserved RPC and capability names, wire markers, and schema boundaries.

## Execution limits and compatibility

### Bound the work a graph can request

The server applies these default budgets:

| Option | Default | Scope |
| --- | --- | --- |
| `maxNodes` | 1,000 | Nodes in the graph |
| `maxMapItems` | 1,000 | Items in each mapped array |
| `maxInvocations` | 10,000 | Total attempted handler invocations per graph |
| `concurrency` | 64 | Active handler invocations across the whole graph, including maps |
| `maxDepth` | 64 | Request structure and map scope depth |
| `maxExpressionNodes` | 100,000 | Visited request structure values, including literals |
| `maxExecutionSteps` | 100,000 | Total node, map-item, expression, and projection-path steps |

Set these under `limits` on `PipelineServer.layerHttp`, `layerWebSocket`, or `handle`. Duplex sessions also cap server handles, pending reverse calls, and queued callback events at 1,000 each.

See [contracts and limits](docs/guides/contracts.md#limits-and-deployment) for the fixed input/output guards and the complete budget rules.

`maxExecutionSteps` bounds structural work, including nested maps that make no RPC calls. It does not measure CPU time in handlers or database cost.

A limit can be reached after earlier operations have run. It does not undo completed mutations. Configure body limits, timeouts, connection quotas, rate limits, TLS, and trusted proxies at your application boundary.

### Keep client and server versions aligned

Use matching Effect, platform, and SQL versions. The tested baseline is 4.0.6, with a `~4.0.6` peer range. Effect’s RPC, HTTP, socket, and SQL APIs still carry unstable annotations.

Deploy clients and servers from matching library versions. See [compatibility](docs/guides/contracts.md#compatibility) for Node, browser, and ESM requirements.

## Modules, guides, and complete examples

Import individual modules as `effect-rpc-pipeline/Pipeline`, `effect-rpc-pipeline/PipelineClient`, and so on, or use their namespace exports from `effect-rpc-pipeline`.

| Module | Purpose |
| --- | --- |
| `Pipeline` | Remote values, selections, maps, phases, field projection and protocol types |
| `PipelineClient` | HTTP, WebSocket, in-process and custom client constructors and Layers |
| `PipelineServer` | Routes, execution, validation, limits and lifecycle middleware |
| `Capability` | Typed capability definitions, implementations, references and release |
| `Auth` | Bearer extraction, verifier wiring, client credentials and coverage assertions |
| `RequestBatching` | Request-local resolver caches, partitions and native RPC middleware |
| `Sql` | Pipeline transactions and best-effort after-commit effects |
| `Telemetry` | Effect tracing and metrics middleware |
| `Duplex` | Low-level bidirectional protocol for transport adapters |

For full signatures, use the [API reference](docs/api.md). For detailed integrations, use the [usage guide](docs/guides/usage.md). The [contracts page](docs/guides/contracts.md) defines the precise runtime behavior.

Upgrading from the earlier RC implementation? Follow the [migration guide](docs/guides/migration.md).

For runnable applications, start with:

- [Todo](examples/todoapp): a smaller authenticated HTTP/WebSocket application with ownership checks, mutation-plus-query responses, streams, and end-to-end tests.
- [Pipeline Press](examples/blogapp): a full blog UI with SQLite, browser sessions, SSR/hydration, administration, batching, transactions, telemetry, streams, capabilities and callbacks. Its README distinguishes demonstration behavior from deployment requirements.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for clean installation and validation commands, [CHANGELOG.md](CHANGELOG.md) for changes, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

MIT licensed. See [LICENSE](LICENSE).

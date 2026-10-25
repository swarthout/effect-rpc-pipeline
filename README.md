# effect-rpc-pipeline

Promise pipelining, batching, and bidirectional capabilities for Effect RPC.

Compose dependent remote calls into one request. The server runs their dependency graph, applies normal Effect RPC middleware, and returns the data you select. Building a call performs no I/O; running it as an Effect sends the graph.

## Why pipeline RPC?

A screen often needs a user, then that user's profile, friends, or permissions. Ordinary sequential RPC calls wait for each result to travel back to the client before the next call can start. Moving the workflow into one server endpoint avoids those round trips, but creates a new endpoint for each response shape.

A pipeline lets the client describe those dependencies and its desired response. The server runs the operations through your existing Effect RPC handlers and middleware. You keep control of the exposed operations, schemas, authorization, and execution limits; the client chooses how to compose them.

Use it for dependent reads, independent query batches, mutation-plus-refresh responses, or narrow capability APIs. Batching network calls does not automatically batch database queries or provide a transaction. The integrations below address those separate concerns.

Version **0.1.0** targets **Effect 4.0.6**, **Node.js 24.11+ (24.x) or 26+**, and modern browsers. This is an ESM package. Effect's RPC, HTTP, socket and SQL modules remain unstable APIs; the tested peer range is `~4.0.6`. See [compatibility and contracts](docs/guides/contracts.md).

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

Create three files. The same RPC group defines the server and client contract.

`rpcs.ts`:

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

`server.ts`:

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

`client.ts`:

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

Start the server, then run the client in a second terminal:

```sh
node --import tsx server.ts
node --import tsx client.ts
```

The result is `{ user: { id: "ada", name: "Ada" }, profile: { bio: "Profile for ada" } }`. `getProfile` uses the result of `findUser`; both run through one HTTP pipeline request.

These [quickstart files](docs/snippets) are compiled by `npm run docs:check`. When running them from this repository, build the package first and use `node --import tsx docs/snippets/server.ts` and `node --import tsx docs/snippets/client.ts`.

## How execution works

A finite RPC call returns a `Pipeline.Remote<A, E, R>`. It is a symbolic reference to a future server result and an ordinary `Effect` that produces that result. Its types carry the selected success data, errors, and Effect service requirements.

1. Calling `rpc.findUser(...)` builds a graph node without sending anything.
2. Reading `user.id` builds a field reference. Passing it to another RPC establishes a dependency.
3. `Pipeline.all` selects the data to return and combines the referenced operations into one graph.
4. Running the final remote sends that graph. The server validates it, schedules ready operations, and returns the selected data.

In the quickstart, `findUser` runs first. `getProfile` receives its resulting ID on the server; there is no intermediate trip back to the client. Independent operations can run concurrently, subject to the server's global concurrency limit.

A remote is lazy and repeatable. Yielding the same remote twice executes its graph twice, including mutations. Reusing that remote in several places in one `Pipeline.all` shares the same node. Two separately constructed calls remain distinct operations, even if their payloads match. Values from different client instances cannot be combined into one graph.

`Effect.all` runs several Effects normally and can therefore send several requests. Use `Pipeline.all` when you want one pipeline request.

## Compose calls and select results

These examples run inside `Effect.gen`, using a client whose RPC group includes the methods shown. The additional contracts and complete example functions live in [overview.ts](docs/snippets/overview.ts) and are checked by TypeScript along with the quickstart.

### Select several results

A selection can contain objects, arrays, nested structures, literals, and remote values. Only the selected structure is returned; intermediate values can stay on the server.

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

Both `getProfile` and `listFriendIds` depend on the user lookup, but not on each other. Once the lookup completes, they can run concurrently in the same request. Their typed errors and requirements are included in the resulting Effect.

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

The mapper describes a template; the server runs that template for each item. Dependent calls inside a template and nested maps are supported. A nested mapper can reference an outer item. Calls constructed inside the callback run per item; construct a call outside the callback when its result should be shared.

The same operator maps Effect `Option` values. If `findUserByHandle` returns `None`, `getProfile` is skipped and the result remains `None`. For `Some(user)`, the result is `Some(profile)`:

<!-- snippet:option:start -->
```ts
const profile = yield* Pipeline.map(
  rpc.findUserByHandle({ handle }),
  (user) => rpc.getProfile({ userId: user.id })
)
```
<!-- snippet:option:end -->

Map and sequencing callbacks run locally while the graph is being built. Their parameters are symbolic: you can project them, pass them to RPCs, map them, or select them. Ordinary JavaScript branching, arithmetic, and string interpolation cannot inspect remote data. Put a data-dependent decision in an RPC handler instead.

### Read after a mutation

`Pipeline.andThen` starts a new execution phase. All calls introduced by its callback wait for the preceding phase, including calls without a direct data dependency on the mutation:

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

The client chooses the response shape after `renameUser`. The profile and friend list run after the rename and can run concurrently with each other. All of this is still one pipeline request.

`Pipeline.zipRight(first, second)` is the shorter form when you only want the second result. Sequencing provides ordering; use the SQL integration when the mutation and follow-up reads must belong to one transaction.

## Use clients as Effect services

`makeHttp` is convenient for scripts and small programs. In an application, define a service from the same RPC group and provide its implementation as a Layer:

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

An in-process client is useful for tests, server-side tools, and SSR. It runs the normal graph validation, handlers, middleware, batching, and transaction integrations. It does not provide native streams or connection-scoped handles. The [blog example](examples/blogapp) uses it to load page data before rendering HTML.

## Authentication and authorization

Server authentication remains native Effect RPC middleware. Apply it to the RPCs that need protection; pipeline execution invokes that middleware for each protected operation and supplies its principal service to the handler. Domain handlers still enforce ownership, roles, scopes, and other resource rules.

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

The optional `Auth` module provides:

- `bearerToken` for strict extraction into an Effect `Redacted` value;
- `layerBearer` for connecting an application-owned verifier to a principal service;
- `layerClientBearer` for reading the current credential on every execution, including mixed public/protected groups; and
- `assertCoverage` for checking that each RPC is explicitly public or protected by the expected middleware.

The package does not issue tokens or verify JWT signatures. Your verifier owns algorithm, issuer, audience, lifetime and claim checks. Send bearer credentials in the Authorization header over TLS. Client middleware propagates credentials; server middleware and domain authorization enforce access.

Client middleware shared by several graph nodes runs once around the batch, with a synthetic request containing the graph. Header propagation is supported; per-RPC payload rewriting or short-circuiting with a domain result is not. See the [authentication guide](docs/guides/usage.md#authentication-and-authorization) for complete service and Layer wiring and the [todo example](examples/todoapp) for JWT verification and ownership checks.

## WebSockets and streams

HTTP and WebSocket routes can share `/rpc`: POST serves finite HTTP pipelines, while GET upgrades establish persistent connections. Provide the handlers and serialization Layer to these routes as in the quickstart:

<!-- snippet:websocket-routes:start -->
```ts
const Routes = Layer.merge(
  PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc" }),
  PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc" })
)
```
<!-- snippet:websocket-routes:end -->

Finite methods still return remote Effects over WebSocket. RPCs declared with `stream: true` return native Effect Streams. For example, a `watchUsers` RPC returning a stream of users can be consumed with:

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

Streams have their own lifetime and backpressure. They cannot be selected into finite `Pipeline.all`, `Pipeline.map`, or `Pipeline.andThen` graphs; compose them with Effect's Stream operators. The [WebSocket guide](docs/guides/usage.md#websockets-and-streams) covers protocol Layers and transport configuration.

## Typed capabilities and callbacks

A capability is an RPC surface bound to a server-side object or context. Instead of repeatedly passing a user or resource ID, a handler can validate access once and return a narrow set of operations for that context. No JavaScript function or closure is serialized.

Here `User` is the `{ id, name }` schema used by the examples. Define the surface with an ordinary `RpcGroup`, then use its capability schema as an RPC result:

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

An authenticated `openSession` handler can construct the implementation from its principal service. In this example `CurrentUser` is supplied by server authentication middleware:

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

Use `openSession` as the handler for `OpenSession` in the authenticated RPC group. A client can call through the symbolic capability inside one pipeline:

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

Over WebSocket, the capability can also be returned to the client and used in later requests:

<!-- snippet:capability-persistent:start -->
```ts
// rpc is a WebSocket client whose connection scope is still open.
const session = yield* rpc.openSession()
const user = yield* session.currentUser()
yield* Capability.release(session)
```
<!-- snippet:capability-persistent:end -->

Persistent handles are bound to their session and connection. Releasing a handle or closing its connection makes it unavailable; reacquire handles after reconnect. Capability definitions have unique IDs within a module registry.

Capabilities capture application services and principals, while library request caches and transaction state remain local to each execution. Capturing a principal does not implement automatic revocation. Recheck changing ownership, suspension, or role policy in capability handlers when required. The blog's author handles demonstrate those checks.

WebSocket clients can export capabilities too. For example, an RPC accepting a `NotificationSink` capability can later call the client's typed `notify` method:

<!-- snippet:callback:start -->
```ts
const sink = yield* NotificationSink.fromHandlers({
  notify: ({ message }) => Effect.log(message).pipe(Effect.as(true))
})

yield* rpc.registerNotifications({ sink })
```
<!-- snippet:callback:end -->

Here `NotificationSink` is defined with a `notify({ message })` RPC returning a boolean, and `registerNotifications` accepts its capability schema. Keep the client scope open for as long as the callback is needed. The [capability guide](docs/guides/usage.md#typed-capabilities) includes full contracts, server invocation, cancellation, and connection ownership examples.

## Batch backend work and cache reads

One network request can still cause many database queries. `RequestBatching` integrates native Effect Requests, RequestResolvers, and Cache so concurrent lookups can be deduplicated and sent to a real bulk loader.

This example's application-owned `Users` service implements `findMany(ids)` with one bulk database operation:

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

Use `getUser` in handlers and provide the `Users` service normally. Pipeline execution supplies one `RequestScope` around the graph. For an RPC group that also needs request caching outside pipelines, apply `RequestBatching.Middleware` and provide `RequestBatching.layer`.

Create each cache descriptor once in a service or module. Constructing it inside the lookup creates a different cache on each call. Partition caches by the actual principal or tenant when one pipeline can use several authorization contexts, and invalidate affected entries after mutations.

The resolver must perform a real bulk query; looping over single-row queries inside `runAll` still produces N+1 work. Resolver batch size also depends on concurrency windows, so a large map may use several bulk queries while still sharing one network request. See the [batching guide](docs/guides/usage.md#backend-request-batching-and-caching) and the blog's SQL query-count tests.

## Transactions, after-commit work, and telemetry

Server integrations use the `middleware` array. For example, combine native Effect tracing/metrics with one SQL transaction around each validated finite pipeline:

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

Provide your handler Layer and an Effect SQL driver Layer when serving these routes. Successful graphs commit; typed failures, defects, and interruption roll back. Invalid graphs are rejected before a transaction starts. `transaction({ when })` can select which graphs use a transaction.

The boundary is the finite graph. Native streams and direct calls on an already exported capability do not automatically enter pipeline execution middleware. Put a transaction inside a domain handler when those entry points also need it. Reverse peer calls are rejected while a pipeline transaction is active so database locks are not held waiting for a client response.

Inside a transactional handler, register best-effort work that should run only after commit:

<!-- snippet:after-commit:start -->
```ts
yield* PipelineSql.afterCommit(
  Effect.log("User renamed", user.id)
)
```
<!-- snippet:after-commit:end -->

Deferred effects run sequentially after commit and are discarded on rollback. Pass immutable invocation data into them; they run with the outer execution services after the transaction connection has been released. Failures are reported without undoing the committed mutation. Durable delivery requires an outbox or another persistent mechanism. Calling `afterCommit` outside an active transaction region is a defect.

Transaction infrastructure failures have `retryable: false`: a failed commit may have an unknown outcome. Use application idempotency before retrying a mutation.

`Telemetry.make` creates a pipeline span, child invocation spans, and metrics for counts, duration, graph size, and outcomes. It uses Effect's tracer and metric registry, so an existing Effect OpenTelemetry Layer can export them. Tracing and metrics can be configured independently; payloads and credentials are not added as attributes. See the [transaction](docs/guides/usage.md#transactions), [after-commit](docs/guides/usage.md#run-effects-after-a-successful-commit), and [telemetry](docs/guides/usage.md#tracing-and-metrics) guides for configuration.

## Errors and supported values

Declared RPC errors stay in the Effect error channel, and composition accumulates errors from dependent calls. Handle a domain failure with normal Effect operators:

<!-- snippet:errors:start -->
```ts
const maybeUser = rpc.findUser({ email }).pipe(
  Effect.catchTag("UserNotFound", () => Effect.succeed(null))
)
```
<!-- snippet:errors:end -->

This handles `UserNotFound`; transport and pipeline infrastructure failures remain possible. `PipelineProtocolError` reports malformed graphs, invalid references or paths, unsupported operations and exceeded limits. `PipelineExecutionError` represents safe infrastructure failures, while native transport failures use `RpcClientError`. Defects remain Effect defects. Cancellation propagates into executing work and active callbacks.

Graph validation happens before handlers start, but payload and capability-method validation can depend on earlier results. A runtime failure can occur after an earlier mutation has completed. Use a transaction when rollback is required; there is no automatic retry or exactly-once guarantee.

Finite pipeline values are JSON data, undefined, and Effect Options. Result and error classes cross the aggregate boundary as data fields, without prototypes, custom methods, or `instanceof` behavior. `Pipeline.Data<A>` describes finite success data. Use tagged error matching rather than `instanceof` on remote domain errors.

Dates, maps, sets, binary buffers and other non-data values need explicit transfer schemas or native RPC outside the finite graph. Arbitrary client-side schema transformations are not applied to symbolic expressions. Unsupported literals and cyclic inputs fail during construction; unsupported or oversized final results fail instead of being silently coerced.

For fields that collide with JavaScript or Effect properties, use `Pipeline.field(remote, "then")` or `Pipeline.field(remote, "graph")`. Normal data fields such as `name` and `length` project directly. Root RPC tags `then` and `__effect_rpc_pipeline_*`, and capability methods that shadow handle metadata or `release`/`invoke`, are reserved. The [contracts guide](docs/guides/contracts.md) specifies reserved names, wire markers, schema boundaries, and adapter obligations.

## Execution limits and compatibility

The server limits submitted graphs and active work:

| Option | Default | Scope |
| --- | --- | --- |
| `maxNodes` | 1,000 | Nodes in the graph |
| `maxMapItems` | 1,000 | Items in each mapped array |
| `maxInvocations` | 10,000 | Total attempted handler invocations per graph |
| `concurrency` | 64 | Active handler invocations across the whole graph, including maps |
| `maxDepth` | 64 | Request structure and map scope depth |
| `maxExpressionNodes` | 100,000 | Visited request structure values, including literals |
| `maxExecutionSteps` | 100,000 | Total node, map-item, expression, and projection-path steps |

Set these under `limits` on `PipelineServer.layerHttp`, `layerWebSocket`, or `handle`. Each duplex session also caps server handles, pending reverse calls, and queued callback events at 1,000. Input construction and final results have additional structure guards described in the [contracts guide](docs/guides/contracts.md#limits-and-deployment).

The execution-step budget bounds template expansion even when nested maps do not invoke additional RPCs. It counts structural work, not handler CPU time or database cost. Limits are resource controls, not an all-or-nothing execution promise. A map's size or dynamic cost may only be known after earlier operations have run. Applications still own HTTP body limits, timeouts, connection quotas, rate limits, TLS and trusted proxy configuration.

Use matching Effect ecosystem versions. The tested baseline is **4.0.6**, with a `~4.0.6` peer range, because RPC, HTTP, sockets and SQL remain annotated unstable despite their stable package version and shorter import paths. Deploy clients and servers from matching library versions. Supported Node versions are **24.11+ in the 24.x line and 26+**; browser clients need ES2022, fetch, WebSocket and Web Crypto in an appropriate secure context. ESM is the supported module format.

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

The [API reference](docs/api.md) contains every public signature and option. The [usage guide](docs/guides/usage.md) expands the patterns above into detailed integrations; [contracts and limits](docs/guides/contracts.md) defines precise operational behavior. Existing RC users should read the [migration guide](docs/guides/migration.md).

For runnable applications, start with:

- [Todo](examples/todoapp): a smaller authenticated HTTP/WebSocket application with ownership checks, mutation-plus-query responses, streams, and end-to-end tests.
- [Pipeline Press](examples/blogapp): a full blog UI with SQLite, browser sessions, SSR/hydration, administration, batching, transactions, telemetry, streams, capabilities and callbacks. Its README distinguishes demonstration behavior from deployment requirements.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for clean installation and validation commands, [CHANGELOG.md](CHANGELOG.md) for changes, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

MIT licensed. See [LICENSE](LICENSE).

# How pipelines work

A useful API often describes small, reusable operations: find a user, read a profile, list some records, change a name. A useful screen usually needs several of those operations together.

That leaves a familiar design problem. Should the client assemble the screen with several requests, or should the server expose an operation that returns the whole screen? The first keeps the API reusable. The second can load faster, but couples the API to a particular client view.

`effect-rpc-pipeline` lets the client describe a response using existing Effect RPC operations, then sends that work as one graph. The server keeps its domain operations and authorization rules. A new combination of those operations can stay a client change.

## Small operations, more requests

Imagine an account page that shows a user's name and profile bio. The server already exposes two orthogonal operations: `findUser` finds a user, and `getProfile` reads a profile by user ID. Neither operation needs to know about the account page.

A client can combine them like this inside `Effect.gen`:

<!-- narrative:sequential:start -->
```ts
const user = yield* rpc.findUser({ email })
const profile = yield* rpc.getProfile({ userId: user.id })

return { name: user.name, bio: profile.bio }
```
<!-- narrative:sequential:end -->

There are two requests. The second cannot start until the first response gives the client a user ID. Parallelizing the calls does not help with that dependency.

The same issue appears with resource-oriented HTTP endpoints. Fetching a user and then `/profiles/<userId>` gives the client flexibility, but the dependency introduces another network round trip. More related data can create more requests, even when each server operation is quick.

Independent reads can run in parallel, and a client cache can eliminate some requests. Those help when the work is independent or already cached. They do not remove the first load's dependency on a value that only the server knows.

## Combining operations for a screen

A common solution is to move the composition to the server. An endpoint such as `getAccountPage` can find the user, load the profile, and return both in one response.

That is a reasonable optimization. The client sends one request, and the server can choose how to fetch the data efficiently.

Then the mobile app needs a smaller account summary. An editor needs the same user plus permissions. Another screen needs the profile and a list of friends. You can add more combined endpoints, grow flags on the existing endpoint, or return a broad response and let each client discard fields.

Each choice has a cost. More endpoints add composition code to maintain. More flags make one endpoint harder to understand. Broader responses move data a client may never use.

The domain operations have not changed. What keeps changing is the combination and response shape each client needs.

## Where GraphQL fits

GraphQL addresses this problem by letting clients select fields and related data through a shared schema. With a schema exposing a user and profile, a query could look like this:

```graphql
query Account($email: String!) {
  user(email: $email) {
    name
    profile {
      bio
    }
  }
}
```

The client can change its selection without adding a screen-specific endpoint. [GraphQL's introduction](https://graphql.org/learn/introduction/) explains this model in more detail.

GraphQL can be introduced alongside an existing API. For an Effect RPC application, though, it introduces another query schema and execution boundary, plus resolver wiring and client integration. Adopting one composed query involves more than composing the RPCs the application already has.

This package aims for a smaller adoption step in that setting: keep the Effect RPC contract and let clients compose its existing operations.

## Let the client describe the response

With a pipeline client, the account query becomes:

<!-- narrative:selection:start -->
```ts
const user = rpc.findUser({ email })

const account = yield* Pipeline.all({
  name: user.name,
  bio: rpc.getProfile({ userId: user.id }).bio
})
```
<!-- narrative:selection:end -->

The missing `yield*` on `findUser` is deliberate. `user` describes a future result. Reading `user.id` creates a reference to a field on that result, so `getProfile` can depend on it before either call runs.

`Pipeline.all` selects the response. Running that final Effect sends one graph. The server finds the user, passes the ID to `getProfile`, and returns only `name` and `bio`. It does not send the intermediate user ID back so that the client can make another request.

If another client needs the complete user and profile objects, it can select those instead. `findUser` and `getProfile` keep the same contracts and handlers.

## The server runs a dependency graph

A graph records which operations to call, which results they depend on, and which data to return. The server validates that graph, runs operations when their dependencies are ready, and constructs the selected response. Independent calls can run concurrently, subject to the server's limits.

The client is describing work through the RPCs you expose. It is not uploading arbitrary JavaScript to execute on the server. A data-dependent decision, such as calculating a discount or checking ownership, belongs in a handler.

The idea builds on promise pipelining. [Cloudflare's Cap'n Web introduction](https://blog.cloudflare.com/capnweb-javascript-rpc-library/) shows how references to future results can remove intermediate network waits. This package brings that style of composition to Effect RPC, using Effect schemas, handlers, middleware, and Effects at the API boundary.

## Lists need composition too

A profile card is small. A friend list makes the same issue more visible: the client first needs the list of IDs, then a profile for each item.

`Pipeline.map` records a template for that repeated work:

<!-- narrative:map:start -->
```ts
const friends = yield* Pipeline.map(
  rpc.listFriendIds({ userId }),
  (friendId) => ({
    id: friendId,
    bio: rpc.getProfile({ userId: friendId }).bio
  })
)
```
<!-- narrative:map:end -->

The callback runs locally while the graph is built, with a symbolic `friendId`. The server applies the recorded template to the actual items. The list and its profile lookups stay in one pipeline request.

One request does not necessarily mean one database query. If `getProfile` performs a separate SQL query for every item, a pipeline still performs those queries. Use [request batching and caching](usage.md#backend-request-batching-and-caching) with a bulk resolver to collect backend reads as well.

The two optimizations solve different waits: pipelining reduces client/server round trips, while backend batching combines reads behind the server boundary. Your handlers choose the database strategy.

## Mutations can return the next view

The same response-selection model applies after a write. A rename interaction may need the updated name and current profile, rather than just a mutation acknowledgment.

Use `andThen` to make the reads wait for the write:

<!-- narrative:mutation:start -->
```ts
const account = yield* rpc.renameUser({ userId, name }).pipe(
  Pipeline.andThen((user) => ({
    name: user.name,
    bio: rpc.getProfile({ userId: user.id }).bio
  }))
)
```
<!-- narrative:mutation:end -->

The response shape belongs to the client. The `renameUser` handler does not need an account-page variant, and the follow-up read does not need a second network round trip.

Ordering and atomicity are separate choices. Add [transaction middleware](usage.md#transactions) when the write and reads must share one database transaction.

## Adopt it with an existing RPC group

For an Effect RPC codebase, adoption starts with the contracts and handlers already in use. Add a pipeline route for the group and provide its existing handler Layer:

<!-- narrative:adoption:start -->
```ts
const PipelineRoutes = PipelineServer.layerHttp({
  group: ExistingRpcs,
  path: "/pipeline"
}).pipe(Layer.provide(AppLive))
```
<!-- narrative:adoption:end -->

Here `ExistingRpcs` and `AppLive` are the application's RPC group and handler Layer. The route joins the normal HTTP server and uses the same serialization setup shown in the [quickstart](../../README.md#quickstart). An existing RPC route can stay alongside it while a client or workflow moves to pipelines.

If the application uses Effect without Effect RPC, start with a small RPC group whose handlers call the existing services. The service implementations can stay as they are.

On the client, the RPC group defines an Effect service, and a Layer supplies its transport:

<!-- narrative:services:start -->
```ts
class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof ExistingRpcs>
>()("app/AppClient") {}

const AppClientLive = PipelineClient.layerClientHttp(
  AppClient,
  ExistingRpcs,
  { url: "http://127.0.0.1:8787/pipeline" }
).pipe(Layer.provide(RpcSerialization.layerJson))
```
<!-- narrative:services:end -->

Application code yields `AppClient` inside `Effect.gen`. Composed calls retain their success types, declared errors, and service requirements. You can handle failures with `catchTag`, provide dependencies through Layers, and manage streams or WebSocket connections with Effect scopes.

Server handlers keep using their existing services. Native RPC middleware still runs for protected operations, and domain handlers still enforce resource permissions. You do not need to translate that application logic into a second execution model to try one pipeline.

Adoption works most directly with RPCs that exchange plain data. Check the [schema contract](contracts.md#values-and-schemas) if decoded values depend on Dates or class methods.

## Let the API evolve with the domain

A new screen can compose existing operations without requiring a new aggregate endpoint. A new field selection can change in the client. Backend batching, authentication, and transaction policy remain explicit server concerns.

A genuinely new domain operation still needs a new RPC. If a workflow is a business invariant, it should remain a server operation rather than becoming client composition. The goal is to stop changing the server API merely because a screen wants a different arrangement of data.

Start with the [quickstart](../../README.md#quickstart) to run a pipeline, then use the [composition guide](usage.md#compose-finite-calls) for maps, selections, and phases. The [contracts page](contracts.md) covers the precise execution and serialization rules.

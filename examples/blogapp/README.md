# Pipeline Press

Pipeline Press is a full-stack blog application that exercises `effect-rpc-pipeline` in a realistic Effect and Foldkit codebase. Articles are public. Creating or editing posts, commenting, voting, and administration require a JWT-authenticated session.

## Run it

Use Node.js 24.11+ (24.x) or 26+. From the repository root, run `npm ci` and `npm run build`. Then install from this directory and start the API and web app in separate terminals:

```sh
npm ci
npm run dev:server
```

```sh
npm run dev
```

Open `http://localhost:5174`. The development administrator is `admin` with password `admin-password-change-me`. The SQLite database is stored in `.data/blog.db` and is ignored by Git.

The local package uses npm's `install-links=true` setting so the `file:../..` dependency is installed like a real package and shares the example's Effect runtime.

After changing the library, rebuild it at the repository root and run `npm ci` here to refresh the copied package. The example overrides Foldkit 0.169.0's exact Effect 4.0.0 peer declarations to use the tested 4.0.6 platform/SQL ecosystem. These overrides are explicit and are exercised by the example tests. Restart the dev processes after changing capability definitions: definition identifiers must be registered only once within a module registry.

The Vite proxy preserves the original Host for same-origin session checks and forwards WebSocket upgrades. Keep the frontend on the documented port; `strictPort` prevents silently selecting another origin.

For deployment, set `NODE_ENV=production`, a random `BLOG_JWT_SECRET` of at least 32 bytes, and an HTTPS `BLOG_PUBLIC_ORIGIN` such as `https://blog.example.com`. The first database initialization also requires `BLOG_ADMIN_PASSWORD` with at least 16 characters; it creates `admin` only when that user is absent. Changing that variable does not change an existing user's password. Route `/session` and `/rpc` through the configured public origin and terminate TLS at your application host or trusted proxy. Production startup rejects missing configuration. Do not deploy the Vite development server as the production host.

## What the application supports

- Public article feeds, search, article pages, author details, and comments
- Registration and login with signed access and refresh JWTs
- Same-origin browser session routes with `Secure`, `HttpOnly`, `SameSite=Lax` refresh cookies
- Rotating, one-time refresh tokens stored as SHA-256 digests, including replay rejection and logout revocation
- Draft and published posts, creation, author editing, and deletion primitives
- Authenticated comments, owner/admin deletion, and per-user upvotes
- Admin user suspension, role changes, post publication controls, and comment moderation
- HTTP RPC for page interactions and WebSocket RPC for streams and bidirectional capabilities
- Request-aware Foldkit SSR for feeds and article pages, with hydration from serialized flags
- Responsive, minimal Foldkit UI components

## Architecture

The example is split by responsibility rather than transport demos:

```text
src/
  shared/             schemas, errors, middleware tags, capabilities, RPC groups
  server/
    handlers/         public, authenticated content, and admin handlers
    database.ts       SQLite repository
    security.ts       passwords and JWT lifecycle
    sessions.ts       shared login, registration, refresh, and logout operations
    session-routes.ts secure browser cookie boundary
    authentication.ts authentication middleware wiring
    authorization.ts role and scope policy
    lookups.ts        true bulk user RequestResolver and request cache
    layers.ts          application composition and HTTP/WebSocket routes
  client/
    blog-client.ts    screen-oriented queries and HTTP/WebSocket client Layers
  test-support/
    query-complexity.ts SQL span collection and constant-work assertions
  web/
    model.ts          serializable Foldkit model
    message.ts        facts emitted by the UI and commands
    commands.ts       RPC side effects
    update.ts         pure state transitions
    views/            shared controls and page views
```

`shared/rpcs.ts` is the transport contract. The server adopts it with standard `AppRpcs.of(...)` handlers and ordinary Effect services. The public, content, and admin handler factories are composed in `server/handlers/application.ts`.

The Foldkit runtime depends on `BlogClient` as an Effect service. `layerHttpClient()` constructs the facade once and each finite pipeline execution owns its internal request scope. Commands simply yield the service:

```ts
// Inside a Command.define execute callback:
const blog = yield* BlogClient
const posts = yield* blog.feed(input.search)
```

`layerWebSocketClient()` instead owns one connection for the Layer scope, which lets streams and capabilities persist across calls without exposing `Scope` throughout application code.

## Pipeline patterns used

The feed hydrates every post with its author in one request using `Pipeline.map`:

```ts
const posts = rpc.listPosts({ search, tag, offset: 0, limit: 30 })

return Pipeline.map(posts, (post) => ({
  post,
  author: rpc.getUser({ id: post.authorId }),
  viewerUpvoted: Option.none()
}))
```

The article query combines dependent and independent reads, including an Effect `Option`:

```ts
const post = rpc.getPost({ slug })

return Pipeline.all({
  post,
  author: rpc.getUser({ id: post.authorId }),
  comments: Pipeline.map(rpc.listComments({ postId: post.id }), (comment) => ({
    comment,
    author: rpc.getUser({ id: comment.authorId }),
    canDelete: rpc.canDeleteComment({ authorId: comment.authorId })
  })),
  viewerUpvoted: rpc.hasUpvoted({ postId: post.id }),
  viewer: rpc.me()
})
```

Writes use `Pipeline.andThen` to request the screen's next state without defining a special server endpoint:

```ts
rpc.createPost(input).pipe(
  Pipeline.andThen((post) => ({ post, allPosts: rpc.myPosts() }))
)
```

Mutation events are registered with `PipelineSql.afterCommit`. They run only after a successful pipeline transaction, so a rolled-back post or moderation action cannot publish an event:

```ts
yield* PipelineSql.afterCommit(events.publish({
  _tag: "PostChanged",
  postId: post.id
}))
```

The server also demonstrates:

- `Request` and `RequestResolver` caching backed by a real SQL `IN (...)` loader for user hydration;
- selective SQL transactions around pipelines containing mutations;
- authentication coverage checks and a typed `CurrentUser` service;
- role/scope authorization inside handlers;
- tracing, metrics, audit annotations, and execution limits;
- a streamed `watchPost` RPC;
- an `AuthorSession` server capability; and
- a `NotificationSink` client callback.

## Browser sessions and SSR

The normal RPC login, registration, and refresh methods remain useful for native clients. The browser uses `/session/login`, `/session/register`, `/session/refresh`, and `/session/logout` instead. Those same-origin routes keep the refresh token out of JavaScript and return only an access token, its expiration, and the current user. Protected pipeline calls read the current access token through `Auth.layerClientBearer`, while public calls send no credential.

`entry.server.ts` loads each route through `PipelineClient.layerClientInProcess`. This executes the same graph validation, handlers, request batching, middleware, telemetry, and SQL integration as the transport server without making an HTTP call back into the process. Feed and article data are passed to Foldkit as flags and embedded for hydration. Unknown article slugs render a real not-found page.

## Tests

```sh
npm run typecheck
npm test
npm run build
```

`src/blog.e2e.test.ts` starts a real Effect Node server on an ephemeral port and covers HTTP, WebSocket, SQLite, secure refresh cookies, JWT rotation and replay rejection, logout revocation, same-origin enforcement, authorization boundaries, authoring, moderation, pipelines, streams, capabilities, and callbacks. `src/ssr.e2e.test.ts` creates real SQLite data, loads it through the in-process client, and verifies the rendered Foldkit article and not-found pages. `src/web/application.scene.test.ts` tests Foldkit scenes and pure update stories.

`src/query-complexity.test.ts` guards against database N+1 regressions without adding test hooks to application code. A test tracer observes `db.query.text` on native Effect SQL spans and `rpc.method` on RPC spans, normalizes statements into fingerprints, and compares every client workflow at 2, 16, and 100 related rows. Reads and writes must remain exactly constant and stay within an explicit ceiling. The example sets global concurrency to the graph's 500-invocation budget so maps with multiple calls per item can enter the same resolver batch. A synthetic self-test proves that the assertion rejects a repeated per-row query while accepting one bulk `IN (...)` query.

Coverage is discovered rather than maintained in a second RPC registry. The test compares observed server span tags with `AppRpcs.requests` and proxies the `BlogClient` facade to record invoked methods. Adding an RPC or client workflow makes the suite fail until a scaling scenario exercises it. The same coverage run starts a real WebSocket server for the stream and callback boundaries, which cannot be represented by the finite in-process pipeline client.

Known integration gaps and package findings are tracked in [PACKAGE_AUDIT.md](./PACKAGE_AUDIT.md).

## Example boundaries

This application demonstrates integration patterns; it is not a complete deployment template. UI navigation changes the Model without implementing browser history. Direct `/posts/<slug>` URLs support SSR, and missing article responses use HTTP 404. Session restoration refreshes credentials on startup; automatic refresh before access-token expiry is not implemented. Reload or sign in again after expiration. The demo's refresh cookie is Secure and requires HTTPS in production; browsers treat localhost development specially.

Foldkit DevTools is enabled only in development and can inspect form state and tokens. Use demonstration credentials while debugging. Whole-Model slow-phase logging is disabled to keep credential fields out of those diagnostics.

Author capabilities recheck current suspension, roles and ownership. Public comment queries and post events exclude drafts. Post streams emit events only while the post currently exists and is published; deletion notifications and durable event replay are not provided. Application hosts still need deliberate rate limits, database backups, TLS, and proxy/origin configuration.

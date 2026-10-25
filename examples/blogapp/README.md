# Pipeline Press

Pipeline Press is a blog built with Effect, Foldkit, and `effect-rpc-pipeline`. Anyone can read published articles. Writing, commenting, voting, and administration require a JWT-authenticated session.

## Run it

Use Node.js 24.11+ in the 24.x line, or Node.js 26+. Build the library from the repository root:

```sh
npm ci
npm run build
```

Then, from `examples/blogapp`, install the example and start its API:

```sh
npm ci
npm run dev:server
```

In a second terminal in the same directory, start the web app:

```sh
npm run dev
```

Open `http://localhost:5174`.

- Development user: `admin`
- Development password: `admin-password-change-me`
- SQLite database: `.data/blog.db`, ignored by Git

The local package uses npm's `install-links=true` setting so the `file:../..` dependency is installed like a real package and shares the example's Effect runtime.

### After library changes

Rebuild at the repository root, then run `npm ci` in the example to refresh its copied dependency. Restart the dev processes after changing capability definitions; their IDs must be registered only once per module registry.

The example explicitly overrides Foldkit 0.169.0’s Effect 4.0.0 peers to use the tested 4.0.6 platform and SQL packages. The example tests cover that dependency combination.

The Vite proxy preserves the original Host for same-origin session checks and forwards WebSocket upgrades. Keep the frontend on the documented port; `strictPort` prevents silently selecting another origin.

## Configure a deployment

Set `NODE_ENV=production` and these variables:

| Variable | Requirement |
| --- | --- |
| `BLOG_JWT_SECRET` | Random secret of at least 32 bytes |
| `BLOG_PUBLIC_ORIGIN` | HTTPS origin, such as `https://blog.example.com` |
| `BLOG_ADMIN_PASSWORD` | At least 16 characters; required when initializing a database without an admin user |

The password variable creates `admin` only if that user is absent. Changing it does not reset an existing password. Production startup rejects missing configuration.

Route `/session` and `/rpc` through the configured public origin. Terminate TLS at the application host or a trusted proxy. Use a production host rather than the Vite development server.

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

The Foldkit runtime uses `BlogClient` as an Effect service. `layerHttpClient()` constructs one reusable client; each finite pipeline execution owns its request scope.

Commands request the service and call it:

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

### Browser authentication

Native clients can use the login, registration, and refresh RPCs. The browser instead calls `/session/login`, `/session/register`, `/session/refresh`, and `/session/logout`.

These same-origin routes keep the refresh token out of JavaScript. They return an access token, its expiration, and the current user. Protected pipelines read the current access token through `Auth.layerClientBearer`; public calls send no credential.

### Server rendering

`entry.server.ts` loads page data through `PipelineClient.layerClientInProcess`. It runs the same validation, handlers, batching, middleware, telemetry, and SQL integration without an HTTP call back into the process.

Feed and article data become Foldkit flags embedded for hydration. Unknown article slugs render a not-found page.

## Tests

```sh
npm run typecheck
npm test
npm run build
```

| Test | Coverage |
| --- | --- |
| `src/blog.e2e.test.ts` | Real Node server, HTTP/WebSocket, SQLite, cookies, JWT rotation, replay/logout checks, origins, permissions, authoring, moderation, pipelines, streams, capabilities, and callbacks |
| `src/ssr.e2e.test.ts` | Real SQLite data loaded through the in-process client and rendered as article and not-found pages |
| `src/web/application.scene.test.ts` | Foldkit scenes and pure update stories |

### Database query counts

`src/query-complexity.test.ts` checks for N+1 database regressions. A tracer reads `db.query.text` on Effect SQL spans and `rpc.method` on RPC spans, then groups equivalent statements.

Each client workflow runs with 2, 16, and 100 related rows. Read and write counts must stay constant and below an explicit ceiling. A self-test proves that the check rejects repeated per-row queries and accepts one bulk `IN (...)` query.

The example sets global concurrency to its 500-invocation budget. This lets maps with several calls per item enter the same resolver batch.

The test compares observed RPC span tags with `AppRpcs.requests` and records calls to the `BlogClient` facade. Adding an RPC or client workflow requires a scaling scenario that exercises it.

Streams and callbacks use a real WebSocket server in the same coverage run; they cannot be represented by a finite in-process graph.

Known integration gaps and package findings are tracked in [PACKAGE_AUDIT.md](./PACKAGE_AUDIT.md).

## Example boundaries

This example demonstrates integrations, rather than a complete deployment template. These UI and session behaviors are intentional:

- UI navigation changes the Model without browser history. Direct `/posts/<slug>` URLs support SSR, and missing articles return HTTP 404.
- Startup restores a session by refreshing credentials. There is no proactive refresh before access-token expiry; reload or sign in again after expiration.
- The refresh cookie is Secure and needs HTTPS in production. Browsers treat localhost development specially.

Foldkit DevTools is enabled only in development and can inspect form state and tokens. Use demonstration credentials while debugging. Whole-Model slow-phase logging is disabled to keep credential fields out of those diagnostics.

Author capabilities recheck suspension, roles, and ownership. Public comment queries and post events exclude drafts.

Post streams emit only while a post exists and is published. They do not provide deletion notifications or durable replay.

Deployment still needs rate limits, database backups, TLS, and proxy/origin configuration.

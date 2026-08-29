# Pipeline Press

Pipeline Press is a full-stack blog application that exercises `effect-rpc-pipeline` in a realistic Effect and Foldkit codebase. Articles are public. Creating or editing posts, commenting, voting, and administration require a JWT-authenticated session.

## Run it

Install from this directory, then start the API and web app in separate terminals:

```sh
npm install
npm run dev:server
```

```sh
npm run dev
```

Open `http://localhost:5174`. The development administrator is `admin` with password `admin-password-change-me`. The SQLite database is stored in `.data/blog.db` and is ignored by Git.

The local package uses npm's `install-links=true` setting so the `file:../..` dependency is installed like a real package and shares the example's Effect runtime.

## What the application supports

- Public article feeds, search, article pages, author details, and comments
- Registration and login with signed access and refresh JWTs
- Rotating, one-time refresh tokens stored as SHA-256 digests
- Draft and published posts, creation, author editing, and deletion primitives
- Authenticated comments, owner/admin deletion, and per-user upvotes
- Admin user suspension, role changes, post publication controls, and comment moderation
- HTTP RPC for page interactions and WebSocket RPC for streams and bidirectional capabilities
- Server-rendered Foldkit document shells with hydration
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
    authentication.ts authentication middleware wiring
    authorization.ts role and scope policy
    user-batching.ts  Effect Request/RequestResolver lookup cache
    layers.ts          application composition and HTTP/WebSocket routes
  client/
    blog-client.ts    screen-oriented pipeline queries and scoped HTTP facade
  web/
    model.ts          serializable Foldkit model
    message.ts        facts emitted by the UI and commands
    commands.ts       RPC side effects
    update.ts         pure state transitions
    views/            shared controls and page views
```

`shared/rpcs.ts` is the transport contract. The server adopts it with standard `AppRpcs.of(...)` handlers and ordinary Effect services. The public, content, and admin handler factories are composed in `server/handlers/application.ts`.

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
    canDelete: rpc.canDeleteComment({ commentId: comment.id })
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

The server also demonstrates:

- `Request` and `RequestResolver` caching for repeated user hydration;
- selective SQL transactions around pipelines containing mutations;
- authentication coverage checks and a typed `CurrentUser` service;
- role/scope authorization inside handlers;
- tracing, metrics, audit annotations, and execution limits;
- a streamed `watchPost` RPC;
- an `AuthorSession` server capability; and
- a `NotificationSink` client callback.

## Tests

```sh
npm run typecheck
npm test
npm run build
```

`src/blog.e2e.test.ts` starts a real Effect Node server on an ephemeral port and covers HTTP, WebSocket, SQLite, JWT rotation/replay rejection, authorization boundaries, authoring, moderation, pipelines, streams, capabilities, and callbacks. `src/web/application.scene.test.ts` tests Foldkit scenes and pure update stories.

Known integration gaps and package findings are tracked in [PACKAGE_AUDIT.md](./PACKAGE_AUDIT.md).

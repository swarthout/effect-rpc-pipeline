# Migrating from the private RC implementation

Upgrade the library, server and clients together. The public target remains 0.1.0; the earlier RC-dependent implementation was not a stable wire contract.

1. Replace Effect `4.0.0-rc.112` and all platform/SQL packages with matching stable `4.0.6` versions. Replace `effect/unstable/rpc/*`, `http/*`, `sql/*`, and `socket/*` paths with `effect/rpc/*`, `effect/http/*`, `effect/sql/*`, and `effect/socket/*`. The upstream modules still carry unstable annotations.
2. Use Node.js 24.11+ (24.x) or 26+ for the repository toolchain. TypeScript 7 declarations are emitted separately from the JavaScript bundle. Published extensions are now `.js` and `.d.ts`; import public package paths instead of filenames inside `dist`.
3. Rebuild and reinstall the copied blog dependency after each library change. Foldkit's `evo` helper is now `modifyFields`; the example uses explicit peer overrides for Effect 4.0.6.
4. Treat finite results as data. Use `Pipeline.Data<A>` when annotating results with a schema class that has methods. Error tags and fields survive, but class prototypes and `instanceof` checks do not. Encode Dates, maps, sets and binary data in explicit transfer schemas.
5. Use `Pipeline.field` for fields such as `then`, `pipe`, or `graph`. Avoid reserved root RPC tags and capability method names listed in [contracts and limits](contracts.md).
6. Nested maps now have lexical item scopes, and all calls created inside a map callback execute per item. Move calls outside the callback to share their result. A global concurrency limit can split resolver batches when a map creates several calls per item; size operational limits deliberately.
7. Transaction infrastructure failures have `retryable: false`. Add idempotency before retrying uncertain mutation outcomes. `afterCommit` work must use outer execution services and cannot rely on captured transaction or invocation-local state.
8. Reacquire persistent capabilities after reconnect. Capability creation no longer retains library caches or transaction connections. Recheck changing application authorization inside capability handlers.
9. Configure `BLOG_JWT_SECRET`, `BLOG_PUBLIC_ORIGIN` and the initial `BLOG_ADMIN_PASSWORD` for production. Refresh rotation is atomic, draft events are filtered, and the Vite proxy supports WebSocket upgrades.

Custom transports must support scoped map nodes/item expressions and reserved undefined/Option wire markers. They must preserve the `{ _tag: "Success", value }` or `{ _tag: "Failure", error }` response envelope, propagate headers and interruption, and bind duplex sessions to the actual connection identity. Use `PipelineServer.handle` for graph validation rather than trusting client-supplied dependencies.

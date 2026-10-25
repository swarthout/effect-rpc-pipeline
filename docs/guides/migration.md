# Migrating from the private RC implementation

Upgrade the library, server, and clients together. Version 0.1.0 changes the wire format; clients and servers built from the earlier RC implementation are not compatible with it.

## 1. Update dependencies and imports

Replace Effect `4.0.0-rc.112` with `4.0.6`. Use the same stable version for the platform and SQL packages.

Update the import paths:

| Old prefix | New prefix |
| --- | --- |
| `effect/unstable/rpc/` | `effect/rpc/` |
| `effect/unstable/http/` | `effect/http/` |
| `effect/unstable/sql/` | `effect/sql/` |
| `effect/unstable/socket/` | `effect/socket/` |

These upstream APIs still carry unstable annotations.

Use Node.js 24.11+ in the 24.x line, or Node.js 26+. Import public package paths rather than files inside `dist`. Published extensions are now `.js` and `.d.ts`; declarations are emitted separately from the JavaScript bundle.

## 2. Review finite results

Finite results now contain data fields without class prototypes or methods. Error tags survive, but `instanceof` checks do not. Match errors by tag instead.

Use `Pipeline.Data<A>` when annotating a result whose schema class has methods. Encode Dates, maps, sets, and binary values in explicit data transfer schemas.

For reserved fields, use `Pipeline.field(remote, "then")`, for example. Check the [reserved names](contracts.md#reserved-names) before choosing root RPC tags or capability method names.

## 3. Review maps and concurrency

Nested maps now have lexical item scopes. Every call created inside a map callback runs per item; move it outside the callback when its result should be shared.

A global concurrency limit can split resolver batches, particularly when each item makes several calls. Set limits for the workload you expect.

## 4. Review transaction failures

Transaction infrastructure failures have `retryable: false` because the commit outcome may be unknown. Add idempotency before retrying mutations.

`afterCommit` effects use outer execution services. Pass the data they need explicitly; they cannot rely on transaction connections or invocation-local state.

## 5. Review persistent capabilities

Request new handles after reconnecting. Capability creation no longer retains library caches or transaction connections.

If permissions can change, check them again inside capability handlers. A previously captured principal does not provide automatic revocation.

## 6. Update custom transports

Support scoped map nodes, item expressions, and the reserved undefined/Option markers. Preserve the response envelope:

```ts
{ _tag: "Success", value }
{ _tag: "Failure", error }
```

Propagate headers and interruption, and bind each duplex session to its actual connection. Use `PipelineServer.handle` to validate graphs rather than trusting client-supplied dependencies.

## 7. Update the blog example

Rebuild the library, then reinstall the blog's copied dependency after each library change. Foldkit's `evo` helper is now `modifyFields`. The example uses explicit peer overrides for Effect 4.0.6.

For production, configure `BLOG_JWT_SECRET`, `BLOG_PUBLIC_ORIGIN`, and the initial `BLOG_ADMIN_PASSWORD`. See the [blog README](../../examples/blogapp/README.md) for setup.

The updated example rotates refresh tokens atomically, filters draft events, and supports WebSocket upgrades through the Vite proxy.

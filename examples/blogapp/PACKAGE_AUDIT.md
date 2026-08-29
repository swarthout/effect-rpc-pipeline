# Blog example package audit

This file records package behavior discovered while building Pipeline Press. It separates fixed package defects from application-level choices so the example does not silently hide workarounds.

## Fixed while building the example

### Effect Option payloads were decoded at the wrong representation

Pipeline expressions preserved `Option.none()` and `Option.some(...)`, but an RPC payload schema such as `Schema.OptionFromNullOr(Schema.String)` expects `null | string` as its encoded input. The server now recursively converts Options to their encoded payload representation before schema decoding. A package regression test covers both `None` and `Some`.

### Schema class results were not JSON-safe at the aggregate boundary

Individual handlers returned decoded `Schema.Class` values. The aggregate pipeline RPC has an unknown JSON response, and Effect's JSON codec correctly rejected custom prototypes. The server now converts final results and typed failures to plain transport objects while preserving tagged Options for client revival. The blog's HTTP and WebSocket tests cover class-heavy results.

### Request batching cache creation must happen inside the request scope

`RequestBatching.cache` requires the package `RequestScope`. Constructing the cache while building a handler layer fails because that scope exists only during pipeline execution. The example keeps the resolver application-scoped but creates/retrieves its cache lazily inside `getUser`.

## Ergonomic gaps addressed after the first application pass

### Native client lifetime and repeated construction

`PipelineClient.makeHttp` now returns a reusable facade without a `Scope` requirement. Every finite pipeline graph owns one internal request scope. `layerClientHttp` provides that facade as an ordinary Effect service, so the Foldkit application no longer constructs a client in every command. `makeWebSocket` remains scoped because the connection, streams, and capabilities must have a shared lifetime; `layerClientWebSocket` makes the owning Layer the visible application boundary.

### Public calls in a mixed authenticated group

`Auth.layerClientBearer` now satisfies required client middleware with an Effect that is evaluated for each pipeline. `None` leaves public calls anonymous and `Some(token)` adds the bearer header. Refreshing the token does not rebuild the client. The server remains authoritative and rejects protected RPCs when the optional client credential is absent or invalid.

### Secure browser refresh sessions

The example now has a small application HTTP boundary for browser login, registration, refresh, and logout. It sets a `Secure`, `HttpOnly`, `SameSite=Lax` refresh cookie, checks same-origin requests, rotates refresh tokens, rejects replay, revokes on logout, and returns only short-lived access state to JavaScript. This intentionally remains outside the pipeline package: cookies, CSRF policy, CORS, and JWT session design are HTTP application concerns rather than graph RPC primitives. Native clients can still use the typed RPC session methods.

### Transactional follow-up effects

`PipelineSql.afterCommit` now registers Effects in a generic execution-local deferred region. The SQL integration drains the region sequentially after a successful commit and discards it on rollback. Effects run with the outer pipeline services so a released transaction connection is never captured. The blog uses it for post and moderation events. Failures are reported without claiming that the already committed mutation rolled back. The mechanism is best-effort and does not replace a transactional outbox for durable delivery.

### Server-side pipeline queries

`PipelineClient.makeInProcess` and `layerClientInProcess` now execute through the normal pipeline server without a network transport. The blog server loads public feed and article data through this client, passes it into Foldkit flags, renders route-specific HTML, and hydrates without repeating the initial feed request. End-to-end tests cover article content and not-found rendering.

## Intentional limits that remain

- Post-commit effects are process-local and best-effort. Durable notifications require an outbox and worker.
- WebSocket clients are genuinely scoped. The Layer helper hides connection plumbing, but the application must still choose a meaningful connection lifetime.
- Browser cookies are managed by the example's HTTP routes. The general pipeline response remains typed RPC data and does not expose transport-specific cookie mutation.
- Access tokens remain available to browser JavaScript because they are bearer credentials for RPC calls. The short expiration and restrictive refresh cookie reduce exposure, but a stricter BFF architecture could keep access credentials server-side too.

## Security notes

- Server middleware, not the UI, enforces authentication on every protected RPC.
- Authorization is checked again for ownership, scopes, admin role, suspension, and self-administration restrictions.
- JWT verification pins algorithm, issuer, audience, token type, timestamps, and required claims.
- Refresh tokens rotate once and are stored only as digests.
- The seeded administrator password and default signing secret are development-only values and must be replaced in deployment.
- The session routes require matching `Origin` and `Host`, and their `SameSite=Lax` cookie adds defense in depth. Deployment-level rate limiting and a deliberate proxy/origin policy are still required.
- Pipeline execution limits are not a substitute for caller quotas.

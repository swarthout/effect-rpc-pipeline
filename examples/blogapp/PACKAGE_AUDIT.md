# Blog example package audit

This file records package behavior discovered while building Pipeline Press. It separates fixed package defects from application-level choices so the example does not silently hide workarounds.

## Fixed while building the example

### Effect Option payloads were decoded at the wrong representation

Pipeline expressions preserved `Option.none()` and `Option.some(...)`, but an RPC payload schema such as `Schema.OptionFromNullOr(Schema.String)` expects `null | string` as its encoded input. The server now recursively converts Options to their encoded payload representation before schema decoding. A package regression test covers both `None` and `Some`.

### Schema class results were not JSON-safe at the aggregate boundary

Individual handlers returned decoded `Schema.Class` values. The aggregate pipeline RPC has an unknown JSON response, and Effect's JSON codec correctly rejected custom prototypes. The server now converts final results and typed failures to plain transport objects while preserving tagged Options for client revival. The blog's HTTP and WebSocket tests cover class-heavy results.

### Request batching cache creation must happen inside the request scope

`RequestBatching.cache` requires the package `RequestScope`. Constructing the cache while building a handler layer fails because that scope exists only during pipeline execution. The example keeps the resolver application-scoped but creates/retrieves its cache lazily inside `getUser`.

## Remaining ergonomic gaps

### Native client lifetime is easy to misuse

`PipelineClient.make` over the native HTTP protocol requires `Scope`. Returning a client from an Effect that locally provides and closes the protocol layer leaves a facade holding a released resource. `client/blog-client.ts` uses a lazy HTTP facade that constructs, runs, and closes each request in one scoped Effect. A package-level `withClient` or resource-safe HTTP facade would make the correct pattern more obvious.

### Public calls in a mixed authenticated group need client middleware

Because `Authenticated` is marked `requiredForClient`, constructing a client for `AppRpcs` requires its client middleware even when a particular request contains only public RPCs. The example supplies an optional bearer middleware that adds no header for anonymous calls. A first-class optional credential layer would reduce this boilerplate without weakening server enforcement.

### Refresh-token cookies need an HTTP boundary outside pipeline RPC

The RPC contract returns refresh tokens as typed data. A production browser app would normally put the refresh token in a `Secure`, `HttpOnly`, `SameSite` cookie and keep only short-lived access state in JavaScript. The current pipeline server API does not expose response-cookie metadata, so the example keeps its session in memory and tests rotation at the RPC layer. A deployment should add a small BFF/login HTTP route or a generic response-metadata integration rather than adding JWT-specific behavior to the package.

### Transactional peer calls need a post-commit phase

The SQL integration intentionally denies client callbacks while a transaction is active. This prevents holding a database transaction open across peer I/O, but means transactional mutations cannot directly notify a callback. Applications need an outbox or an explicit post-commit Effect. A generic after-commit hook could improve this without putting SQL concepts into the pipeline core.

### SSR currently renders the application shell

Foldkit SSR is configured and hydration is tested, but the server entry does not execute the public feed pipeline before rendering. Full article SEO would require passing request-specific initial data into Foldkit flags or adding a server-side query adapter. This is an application integration task, not a pipeline correctness issue.

## Security notes

- Server middleware, not the UI, enforces authentication on every protected RPC.
- Authorization is checked again for ownership, scopes, admin role, suspension, and self-administration restrictions.
- JWT verification pins algorithm, issuer, audience, token type, timestamps, and required claims.
- Refresh tokens rotate once and are stored only as digests.
- The seeded administrator password and default signing secret are development-only values and must be replaced in deployment.
- Rate limiting and CSRF protection belong at the deployment/BFF boundary. The pipeline server already supplies execution limits, but those are not a substitute for caller quotas.

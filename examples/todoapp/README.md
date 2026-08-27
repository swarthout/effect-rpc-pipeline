# Effect RPC Pipeline example

This example keeps ordinary Effect RPC handler layers and adds pipelining at the HTTP and WebSocket boundaries. It demonstrates exact Effect RPC tags, capability authentication, projected references in payloads, mapped friend lookups, explicitly ordered mutations, native Effect streams, a persistent WebSocket session, and native Effect tracing and metrics through `PipelineTelemetry.make()`.

It also includes a complete TodoMVC-style application in `src/todo.ts`, `src/todo-server.ts`, and `src/todo-client.ts`. Calls are normal Effects; `Pipeline.all` combines queries and `Pipeline.andThen` builds each mutation's selected refresh response. `watchTodos` is a standard streaming RPC that emits an initial snapshot and subsequent updates. `src/todo-live.ts` installs HTTP and WebSocket routes on the same `/rpc` path, while `todo-websocket-server.ts` and `todo-websocket-client.ts` are runnable native Effect examples.

`src/todo-auth.ts` demonstrates the intended security integration:

- `Authenticated` is a normal Effect `RpcMiddleware.Service`;
- `Auth.layerBearer` extracts a redacted bearer credential;
- an application-owned `AccessTokenVerifier` validates JWT algorithm, type, issuer, audience, lifetime, and claims with `jose`;
- the middleware provides a typed `CurrentUser` to handlers;
- write handlers require the `todos:write` scope;
- every repository operation is scoped by `CurrentUser.id`; and
- client middleware injects the `Authorization` header once around a complete pipeline.

The symmetric signing key is deliberately local to this example. A production application should inject its verifier configuration and use a secret manager or a trusted HTTPS JWKS endpoint. The pipeline package does not issue tokens, store passwords, or implement OAuth/OIDC flows.

From the repository root, run `npm run build`. Then in `examples/todoapp`:

- `npm install`
- `npm test` for the authenticated HTTP and WebSocket workflows, invalid-token checks, and cross-user isolation
- `npm run start:websocket` to start the live server
- `npm run client:websocket` in another terminal to run the streaming client

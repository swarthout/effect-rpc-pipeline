# TodoMVC and RPC examples

This example adds pipelining to ordinary Effect RPC handlers over HTTP and WebSocket. It includes a complete TodoMVC workflow with authentication, mutation-plus-refresh responses, and live updates.

## Run the example

Build the library from the repository root:

```sh
npm run build
```

Then install and test the example:

```sh
cd examples/todoapp
npm ci
npm test
```

Start the live server, then run the client in a second terminal in the same directory:

```sh
npm run start:websocket
```

```sh
npm run client:websocket
```

The tests cover authenticated HTTP and WebSocket workflows, invalid tokens, and isolation between users.

## Find the code

| File | Role |
| --- | --- |
| `src/todo.ts` | Todo schemas and RPC contract |
| `src/todo-server.ts` | Handlers |
| `src/todo-client.ts` | Composed client queries and mutations |
| `src/todo-live.ts` | HTTP and WebSocket routes sharing `/rpc` |
| `src/todo-websocket-server.ts` | Runnable live server |
| `src/todo-websocket-client.ts` | Runnable streaming client |
| `src/todo-auth.ts` | Authentication and authorization wiring |

`Pipeline.all` combines queries. `Pipeline.andThen` chooses the data returned after a mutation. `watchTodos` is a native streaming RPC that emits an initial snapshot and later updates.

The smaller RPC examples also demonstrate projected payload references, mapped friend lookups, capability authentication, exact RPC tags, and tracing and metrics through `PipelineTelemetry.make()`.

## Authentication and authorization

The authentication flow uses native Effect RPC middleware:

1. `Auth.layerBearer` extracts a redacted bearer credential.
2. The application's `AccessTokenVerifier` checks the JWT with `jose`: algorithm, token type, issuer, audience, lifetime, and claims.
3. The `Authenticated` middleware supplies `CurrentUser` to handlers.
4. Repository operations use `CurrentUser.id` to isolate each user's data. Writes also require the `todos:write` scope.

Client middleware adds the Authorization header once around each complete pipeline.

The signing key is local to this example. A deployed application should supply its own verifier configuration, using a secret manager or trusted HTTPS JWKS endpoint. The pipeline package does not issue tokens, store passwords, or implement OAuth/OIDC flows.

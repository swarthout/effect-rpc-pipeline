# Effect RPC Pipeline example

This example keeps ordinary Effect RPC handler layers and adds pipelining at the HTTP and WebSocket boundaries. It demonstrates exact Effect RPC tags, capability authentication, projected references in payloads, mapped friend lookups, explicitly ordered mutations, native Effect streams, and a persistent WebSocket session.

It also includes a complete TodoMVC-style application in `src/todo.ts`, `src/todo-server.ts`, and `src/todo-client.ts`. Calls are normal Effects; `Pipeline.all` combines queries and `Pipeline.andThen` builds each mutation's selected refresh response. `watchTodos` is a standard streaming RPC that emits an initial snapshot and subsequent updates. `src/todo-live.ts` installs HTTP and WebSocket routes on the same `/rpc` path, while `todo-websocket-server.ts` and `todo-websocket-client.ts` are runnable native Effect examples.

From the repository root, run `npm run build`. Then in `examples/todoapp`:

- `npm install`
- `npm test` for the complete TodoMVC HTTP workflow
- `npm run start:websocket` to start the live server
- `npm run client:websocket` in another terminal to run the streaming client

# Effect RPC Pipeline example

This example keeps an ordinary Effect RPC handler layer and adds pipelining at the HTTP boundary. It demonstrates exact Effect RPC tags, capability authentication, projected references in payloads, mapped friend lookups, and explicitly ordered mutations.

It also includes a complete TodoMVC-style application in `src/todo.ts`, `src/todo-server.ts`, and `src/todo-client.ts`. Calls are normal Effects; `Pipeline.all` combines queries and `Pipeline.zipRight` orders each mutation before its refresh query. The server handlers use `Effect.gen` over an Effect-valued repository. The end-to-end test starts the real Node HTTP server, exercises the full workflow, and verifies that each state transition takes one HTTP request.

From the repository root, run `npm run build`, then in `examples/todoapp` run `npm install`, `npm test`, or `npm start`.

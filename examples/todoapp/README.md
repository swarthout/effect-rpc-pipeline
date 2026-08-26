# Effect RPC Pipeline example

This example keeps an ordinary Effect RPC handler layer and adds pipelining at the HTTP boundary. It demonstrates nested proxy objects, capability chaining, references in payloads, mapped friend lookups, and generator-ordered mutations without `Pipeline.after`.

It also includes a complete TodoMVC-style application in `src/todo.ts`, `src/todo-server.ts`, and `src/todo-client.ts`. The client uses `Pipeline.resolve` for snapshots and `Pipeline.run` plus `Pipeline.all` for mutation-and-refresh workflows. The server handlers use `Effect.gen` over an Effect-valued repository. The end-to-end test starts the real Node HTTP server, exercises the full workflow, and verifies that each state transition takes one HTTP request.

From the repository root, run `npm run build`, then in `examples/todoapp` run `npm install`, `npm test`, or `npm start`.

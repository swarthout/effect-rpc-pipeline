# Contracts and limits

## Compatibility

Version 0.1.0 is ESM only. Supported servers run Node.js 24.11+ in the 24.x line, or Node.js 26+. Browser clients require an ES2022-capable browser with `fetch`, WebSocket, and Web Crypto (`crypto.randomUUID`, generally requiring a secure context). CommonJS, Bun, and Deno are outside the tested release scope.

The tested Effect ecosystem baseline is 4.0.6. Use matching versions of Effect's platform and SQL packages. The peer range is deliberately limited to the 4.0 patch line (`~4.0.6`). Effect RPC, HTTP, sockets and SQL remain annotated unstable even though their import paths no longer include `unstable`. Review upstream changes and run the complete suite before extending the peer range.

## Construction and execution

Building a `Remote` performs no network I/O. Running it as an Effect executes its graph. Re-running the same remote executes the graph again, including mutations. `Effect.all` runs separate remote Effects separately; use `Pipeline.all` to send one graph.

Map and sequencing callbacks run synchronously on the client with symbolic inputs. Ordinary JavaScript branching, string interpolation, arithmetic, or array indexing on a symbolic value cannot inspect a server result. Project fields, pass the remote into an RPC, select it, or compose another map. Use an RPC for data-dependent decisions.

Maps create lexical item scopes. Each call constructed inside a map callback runs for each item, even if its payload is independent of the item. A remote constructed outside the callback is shared. Nested maps can reference outer items; item references cannot escape their defining map. `andThen` waits for all operations in the prior phase, including when the prior selection is a literal. Independent work inside a phase runs concurrently.

Use `Pipeline.field(remote, "then")` for fields reserved by JavaScript or Effect, including `then`, `pipe`, `graph`, `toString`, and `~effect/*` protocol keys. Normal `name` and `length` data fields can be projected directly. Root RPC tags `then` and `__effect_rpc_pipeline_*` are reserved. Capability methods also cannot shadow `release`, `invoke`, `_tag`, `capabilityId`, `definitionId`, `group`, `owner`, or `context`. Dots in other RPC tags have no special meaning.

## Values and schemas

Finite pipelines carry JSON data, undefined, and Effect Options. Handler result and error classes cross this boundary as data fields, without prototypes, identity, custom methods, or `instanceof` behavior. `Pipeline.Data<A>` expresses finite success data. Use tagged-error matching (`Effect.catchTag`) rather than `instanceof` on remote domain errors. Native streams and direct capability calls use their declared Effect codecs and have their own schema behavior.

Payloads are validated using the RPC payload schema on the server. Both native Options and null-encoded Options can be supplied. References pass earlier decoded handler data to subsequent payload validation. Arbitrary client-side schema transformations are not performed on graph expressions: schemas whose decoded values require Date, Map, Set, binary buffers, custom class behavior, or other non-data values are unsuitable for finite pipelines. Convert those values to explicit data transfer schemas or use native RPC outside a finite graph.

Unsupported input literals fail during graph construction. Unsupported final results, cycles, and oversized results fail with a protocol error instead of being silently coerced. Output structure is capped at 64 levels and 100,000 visited values. Undefined and Option values use reserved wire markers: `_id: "effect-rpc-pipeline/Undefined"` and `_id: "Option"`. Do not use those marker shapes as domain data. Objects merely tagged `Some` or `None` are preserved as ordinary domain objects.

Success schemas define handler contracts, but finite aggregate results are data selections, not independently reconstructed schema instances. Client schema-service requirements remain conservative; graph payload transformations execute on the server. Validate custom transport responses before treating them as a trusted contract. Do not expose adapter APIs directly to untrusted application input.

## Failure and atomicity

Graph errors return `PipelineProtocolError`, including malformed structures, invalid references or paths, unsupported RPCs and values, and exceeded limits. `PipelineExecutionError` represents safe infrastructure failures. Declared handler errors retain their tags and data. Transport failures use native `RpcClientError`. Unexpected defects remain Effect defects and use native RPC defect handling over a network. Interruption propagates through the graph and active callbacks.

Validation checks graph shape, scopes, references, cycles, paths and statically known root RPC tags before any handler starts. Payload validation and capability method validation can depend on earlier results and occur at invocation time. A runtime failure may happen after an earlier mutation has completed. Ordering is not isolation or rollback.

`Sql.transaction()` wraps the selected finite graph in one Effect SQL transaction. Native RPC calls, streams, and direct calls on an already exported capability do not automatically pass through pipeline execution middleware. Put transaction and authorization policy inside domain handlers too when those entry points require it. Remote peer calls are rejected while pipeline transaction middleware is active, to avoid holding a transaction open on a peer response.

An infrastructure transaction failure is marked `retryable: false`: a failed commit can have an unknown outcome. Do not automatically replay a mutation without application idempotency. `afterCommit` runs sequentially after a successful pipeline transaction, with outer execution services. Pass immutable data into deferred work; do not depend on an invocation-local principal, released connection, or request scope. Failures are reported through the configured callback and cannot undo a committed mutation. This mechanism is process-local and best-effort; durable delivery needs an outbox. Calling it outside an active transaction region is a defect.

## Lifetimes and authorization

HTTP clients are reusable; each finite graph acquires and closes an internal scope. WebSocket clients, streams, callbacks and persistent capabilities belong to their connection's scope. Closing or replacing a duplex session clears its exported server handles and fails pending peer calls. Old handles do not survive reconnect; reacquire them. Release remote capabilities explicitly when no longer needed. Local callback exports are retained for the client session lifetime.

The duplex readiness handshake has a ten-second timeout and fails promptly if its stream closes before Ready. Callback work is interrupted when the session stream ends. Capability definition IDs are unique within a module registry; development tools must isolate/restart that registry when reloading definitions.

Capabilities capture application services and principals at creation. Library request caches, transaction connections, deferred regions and execution policies are not retained. A captured principal is an application authorization decision, not automatic token revocation. Recheck changing roles, suspension, ownership, and resource existence inside capability handlers when required. The blog example demonstrates these checks.

Bearer helpers propagate credentials and delegate verification to the application. Native server middleware is authoritative for every protected invocation; client middleware is convenience wiring. Request caches must be partitioned by the actual principal or tenant when one graph can use several authorization contexts. A cache descriptor must be stable across lookups, and mutations must invalidate affected entries.

Client middleware shared by several calls runs once around the batch, with a synthetic request whose payload is the graph. Header propagation is supported; per-RPC payload rewriting or short-circuiting with a domain result is not. Handler wrapper scheduling flags (`Rpc.fork` and `Rpc.uninterruptible`) do not configure graph scheduling; use Effect combinators inside a domain handler when that handler needs an interruption policy.

## Limits and deployment

| Server option | Default | Meaning |
| --- | --- | --- |
| `maxNodes` | 1,000 | Nodes in the submitted graph |
| `maxMapItems` | 1,000 | Items in each mapped array |
| `maxInvocations` | 10,000 | Total root/capability invocations in one graph |
| `concurrency` | 64 | Active handler invocations across the entire graph, including all maps |
| `maxDepth` | 64 | Submitted structure depth and map scope depth |
| `maxExpressionNodes` | 100,000 | Visited request structure values, including literal data |
| `maxExecutionSteps` | 100,000 | Total node executions, map items, expression evaluations, and projection path segments |

The high-level client also caps literal construction depth at 64; raising a server limit does not raise that fixed client guard. Finite positive options are floored to integers. Invalid or omitted options use the defaults. Each duplex session additionally caps registered server capabilities, pending reverse calls and queued callback events at 1,000 each. When a callback queue is saturated, cancellation delivery is best-effort; scope and connection cleanup still release local work.

The execution-step limit is shared across the entire graph and all map scopes. It bounds pure template expansion independently of RPC invocation counts and is checked as work runs, before full results are materialized. It does not measure time spent inside application handlers or schema codecs.

Invocation limits count attempted handler invocations. Limits do not guarantee an all-or-nothing outcome; a map's size and dynamic invocation cost may be known only after earlier work runs. Concurrency also bounds RequestResolver batch windows. A graph with many eligible calls may require several bulk SQL queries even when it uses one transport request.

Configure HTTP request/body limits, timeouts, connection quotas, authentication rate limits, TLS, CORS and proxy/origin policy at the application or deployment boundary. No automatic retry, exactly-once delivery, cross-connection capabilities, durable event delivery, or unbounded-input support is promised. Telemetry labels use the configured server definition, known RPC tags, and invocation kind; payloads and bearer credentials are not added as attributes.

# Contracts and limits

Use this page to check what can cross a pipeline, how work is scheduled, and what happens when execution fails. For examples, start with the [README](../../README.md) or [usage guide](usage.md).

## Compatibility

Version 0.1.0 supports these environments:

| Component | Requirement |
| --- | --- |
| Server | Node.js 24.11+ in the 24.x line, or Node.js 26+ |
| Browser client | ES2022, `fetch`, WebSocket, and Web Crypto |
| Module format | ESM |
| Effect packages | Matching versions of Effect, platform, and SQL packages; tested at 4.0.6 |

Browsers need `crypto.randomUUID`, which generally requires a secure context. CommonJS, Bun, and Deno are outside the tested release scope.

The Effect peer range is `~4.0.6`. Effect's RPC, HTTP, socket, and SQL APIs still carry unstable annotations even though their import paths no longer contain `unstable`. Review upstream changes and run the full suite before widening that range.

## Construction and execution

### When a graph runs

Building a `Remote` performs no network I/O. Running it as an Effect executes its graph. Running it again repeats that work, including mutations.

Use `Pipeline.all` to combine remote values into one graph. `Effect.all` runs the remote Effects separately and can send separate requests.

### Symbolic callback inputs

Map and sequencing callbacks run synchronously on the client. Their inputs describe future server results.

You can project fields, pass them to RPCs, select them, or compose another map. JavaScript branching, interpolation, arithmetic, and array indexing cannot inspect those future results. Put decisions that need the data in an RPC handler.

### Maps and phases

A call constructed inside a map callback runs for each item, even if its payload does not use that item. A remote constructed outside the callback is shared.

Nested maps can reference outer items. An item reference cannot escape the map that defines it.

`andThen` waits for every operation in the preceding phase, even if that phase selects a literal. Independent work within a phase can run concurrently.

### Reserved names

Use `Pipeline.field(remote, name)` when a result field collides with a JavaScript or Effect property. For example, use `Pipeline.field(remote, "then")` rather than `remote.then`.

| Location | Reserved names |
| --- | --- |
| Direct field projection | `then`, `pipe`, `graph`, `toString`, and `~effect/*` protocol keys |
| Root RPC tags | `then` and names starting with `__effect_rpc_pipeline_` |
| Capability methods | `release`, `invoke`, `_tag`, `capabilityId`, `definitionId`, `group`, `owner`, and `context` |

Data fields named `name` and `length` project normally. Dots in other RPC tags have no special meaning.

## Values and schemas

### Finite results are data

Finite pipelines carry JSON data, `undefined`, and Effect `Option` values. Result and error classes cross the boundary as fields, without their prototypes, identity, or custom methods.

Use `Pipeline.Data<A>` to describe a finite success result. Match remote domain errors by tag, for example with `Effect.catchTag`, rather than `instanceof`.

Native streams and direct capability calls use their declared Effect codecs. Their schema behavior is separate from finite graph selections.

### Payload validation

The server validates each payload with its RPC schema. Both native Options and null-encoded Options are accepted. A reference to an earlier result supplies that decoded handler data to the next payload's validation.

Graph expressions do not run arbitrary client-side schema transformations. Finite graphs cannot carry decoded values that depend on `Date`, `Map`, `Set`, binary buffers, or custom class behavior. Represent those values with explicit data transfer schemas, or use native RPC outside a finite graph.

Success schemas define handler contracts. The aggregate response is the selected data structure; the client does not reconstruct schema class instances from it. Client schema-service requirements remain conservative, while graph payload transformations run on the server.

Custom transports must validate responses before treating them as trusted data. Adapter APIs should not be exposed directly to untrusted application input.

### Rejected values and wire markers

Unsupported input literals fail while the client builds the graph. Unsupported final results, cycles, and oversized results fail with a protocol error rather than being silently coerced.

Output is limited to 64 levels and 100,000 visited values.

These wire markers are reserved and must not be used as domain data:

- `_id: "effect-rpc-pipeline/Undefined"`
- `_id: "Option"`

Objects that are merely tagged `Some` or `None` remain ordinary domain objects.

## Failure and atomicity

### Error types

| Failure | Result |
| --- | --- |
| Invalid graph, reference, path, method, value, or limit | `PipelineProtocolError` |
| Server infrastructure failure | `PipelineExecutionError` |
| Declared handler error | Its original tag and data |
| Transport failure | Effect's `RpcClientError` |
| Unexpected defect | An Effect defect, using native RPC defect handling over a network |

Interruption propagates through the graph and active callbacks.

### Validation before execution

Before starting a handler, the server checks the graph's structure, scopes, references, cycles, paths, and statically known root RPC tags.

Payload validation and capability method validation may need earlier results, so those checks happen when the call is invoked. A runtime failure can therefore happen after an earlier mutation has completed. Ordering alone does not provide isolation or rollback.

### Transaction boundaries

`Sql.transaction()` wraps a selected finite graph in one Effect SQL transaction.

Native RPC calls, streams, and direct calls on an exported capability do not automatically enter pipeline execution middleware. If those entry points also need transactions or authorization, enforce that policy in their domain handlers.

Calls to remote peers are rejected while pipeline transaction middleware is active. This prevents a transaction from holding locks while it waits for a peer response.

Transaction infrastructure errors have `retryable: false`: a failed commit may have an unknown outcome. Add application idempotency before automatically replaying a mutation.

### Work after commit

`afterCommit` effects run sequentially after a successful pipeline transaction. They use the outer execution services, after the transaction connection has been released.

Pass immutable data into deferred work. It cannot depend on an invocation-local principal, a released connection, or the transaction's request scope.

Failures are reported through the configured callback and cannot undo a committed mutation. Delivery is process-local and best-effort; use an outbox for durable delivery. Calling `afterCommit` outside an active transaction region is a defect.

## Lifetimes and authorization

### Client and handle lifetimes

| Resource | Lifetime |
| --- | --- |
| HTTP client | Reusable; each finite graph acquires and closes an internal scope |
| WebSocket client and streams | The connection's owning scope |
| Persistent capability handle | The duplex session and connection that exported it |
| Local callback export | The client session |

Closing or replacing a duplex session clears its server handles and fails pending peer calls. After reconnecting, acquire new handles. Release a remote capability explicitly when it is no longer needed.

The readiness handshake times out after ten seconds. It also fails if the stream closes before Ready. Closing the session stream interrupts callback work.

Capability definition IDs are unique within a module registry. Development tooling must isolate or restart that registry when reloading definitions.

### Captured services and changing permissions

Capabilities capture application services and principals at creation. They do not retain library request caches, transaction connections, deferred regions, or execution policies.

A captured principal does not provide automatic token revocation. Check current roles, suspension, ownership, and resource existence in capability handlers when those conditions can change. The blog example demonstrates these checks.

### Authentication and caches

Bearer helpers propagate credentials and delegate verification to the application. Server middleware authenticates each protected invocation; handlers enforce the caller's resource permissions.

When one graph can use several principals or tenants, partition request caches by the actual identity. Create each cache descriptor once and invalidate affected entries after mutations.

### Client middleware behavior

Client middleware shared by several calls runs once around the batch. It receives a synthetic request whose payload is the graph. Header propagation is supported; per-RPC payload rewriting and short-circuiting with a domain result are not.

Handler wrapper flags such as `Rpc.fork` and `Rpc.uninterruptible` do not configure graph scheduling. Use Effect combinators inside a domain handler when it needs its own interruption policy.

## Limits and deployment

### Graph limits

Set these options under `limits` on the server:

| Server option | Default | Meaning |
| --- | --- | --- |
| `maxNodes` | 1,000 | Nodes in the submitted graph |
| `maxMapItems` | 1,000 | Items in each mapped array |
| `maxInvocations` | 10,000 | Total root/capability invocations in one graph |
| `concurrency` | 64 | Active handler invocations across the graph, including maps |
| `maxDepth` | 64 | Submitted structure depth and map scope depth |
| `maxExpressionNodes` | 100,000 | Visited request structure values, including literal data |
| `maxExecutionSteps` | 100,000 | Node executions, map items, expression evaluations, and projection path segments |

Finite positive options are floored to integers. Invalid or omitted options use the defaults.

The high-level client has a fixed literal-depth cap of 64. Raising the server limit does not raise that client cap.

### What the budgets count

The execution-step budget is shared across the graph and all maps. It bounds template expansion even when the templates make no RPC calls. Checks happen while work runs, before full results are materialized.

This budget does not measure CPU time inside handlers or schema codecs. Invocation limits count attempted handler calls.

Dynamic costs can become known only after earlier work runs. Exceeding a limit does not undo completed mutations.

Concurrency also affects RequestResolver batch sizes. A graph can use several bulk database queries while still using one transport request.

### Session limits

Each duplex session caps these resources at 1,000 each:

- Registered server capabilities.
- Pending reverse calls.
- Queued callback events.

When the callback queue is full, cancellation delivery is best-effort. Scope and connection cleanup still release local work.

### Deployment responsibilities

Configure body limits, timeouts, connection quotas, authentication rate limits, TLS, CORS, and proxy/origin policy at the application or deployment boundary.

The library does not provide automatic retries, exactly-once delivery, capabilities that survive a connection, durable event delivery, or unbounded inputs.

Telemetry labels use the configured server definition, known RPC tags, and invocation kind. They do not include payloads or bearer credentials.

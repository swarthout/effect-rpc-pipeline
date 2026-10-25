# API reference

Choose a module by the task you need to perform. Each module page includes its published types, options, and function signatures.

For a working example, start with the [README quickstart](../README.md#quickstart). The [usage guide](guides/usage.md) explains the integrations in more detail.

## Modules

| Task | Module | Main entry points |
| --- | --- | --- |
| Compose and select remote results | [Pipeline](api/Pipeline.md) | `all`, `map`, `andThen`, `zipRight`, `field` |
| Create a client | [PipelineClient](api/PipelineClient.md) | `makeHttp`, `makeWebSocket`, `makeInProcess`, `layerClient*` |
| Serve or execute a pipeline | [PipelineServer](api/PipelineServer.md) | `layerHttp`, `layerWebSocket`, `handle` |
| Define methods tied to an implementation | [Capability](api/Capability.md) | `make`, `.schema`, `.fromHandlers`, `release` |
| Connect bearer authentication | [Auth](api/Auth.md) | `bearerToken`, `layerBearer`, `layerClientBearer`, `assertCoverage` |
| Batch and cache backend reads | [RequestBatching](api/RequestBatching.md) | `cache`, `Middleware`, `layer` |
| Run database work atomically | [Sql](api/Sql.md) | `transaction`, `afterCommit` |
| Add tracing and metrics | [Telemetry](api/Telemetry.md) | `make` |
| Build a custom persistent transport | [Duplex](api/Duplex.md) | Session protocol and adapters |

Import a module from its subpath, such as `effect-rpc-pipeline/Pipeline`. The package root also exports module namespaces and re-exports Pipeline members directly.

## Choose a client lifetime

| Client | Ownership | Supports streams and persistent handles? |
| --- | --- | --- |
| HTTP | Reusable facade; each execution owns its internal scope | No |
| WebSocket | An Effect `Scope` or service Layer owns the connection | Yes |
| In-process | Runs a finite graph through the server in the same process | No |

See [contracts and limits](guides/contracts.md) for serialization rules, capability lifetimes, and transaction boundaries.

## Server middleware lifecycle

The server applies middleware in this order:

1. Reject malformed or oversized request structures.
2. Run `request` middleware around the remaining request flow.
3. Validate the graph.
4. Run `execution` middleware around the complete graph. This is the transaction boundary.
5. Run `invocation` middleware around each root or capability call, including its native RPC middleware.

Request middleware can observe graph-validation failures. Structures rejected in step 1 never reach lifecycle middleware.

When several middleware entries use the same hook, the first array entry is outermost. Effects use their normal dynamic Effect context.

Custom middleware errors are not automatically added to an unrelated RPC group's client type. Use declared RPC errors or an application facade to expose additional failures.

## Custom adapters

Protocol schemas, graph constructors, duplex RPCs, context services, and wire conversion helpers are public for adapter authors. Adapters must still enforce graph validation, authentication, connection ownership, and the [transport contract](guides/contracts.md).

The protocol is pre-1.0. Deploy clients and servers built from the same package version.

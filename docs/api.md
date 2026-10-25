# API reference

Use the namespace exports from `effect-rpc-pipeline` or the subpath imports below. The package root also re-exports Pipeline members directly. Each module page includes all published types, options, constants, classes, and function signatures, generated from the built declarations.

| Module | Application entry points |
| --- | --- |
| [Pipeline](api/Pipeline.md) | `Remote`, `Data`, `all`, `map`, `andThen`, `zipRight`, `field` |
| [PipelineClient](api/PipelineClient.md) | `Client`, `makeHttp`, `makeWebSocket`, `makeInProcess`, `make`, `layerClient*` |
| [PipelineServer](api/PipelineServer.md) | `layerHttp`, `layerWebSocket`, `handle`, `ServerOptions`, `makeMiddleware` |
| [Capability](api/Capability.md) | `make`, definition `.schema` and `.fromHandlers`, `release` |
| [Auth](api/Auth.md) | `bearerToken`, `layerBearer`, `layerClientBearer`, `assertCoverage` |
| [RequestBatching](api/RequestBatching.md) | `cache`, `RequestScope`, `Middleware`, `layer` |
| [Sql](api/Sql.md) | `transaction`, `afterCommit` |
| [Telemetry](api/Telemetry.md) | `make`, tracing and metric options |
| [Duplex](api/Duplex.md) | Session protocol and custom persistent transport integration |

Start with the [README quickstart](../README.md). The [usage guide](guides/usage.md) illustrates advanced composition and integration. Read [contracts and limits](guides/contracts.md) before implementing a custom transport or relying on transaction, serialization, or capability lifetime behavior.

HTTP facades are reusable and own a scope for each execution. WebSocket clients require an owning `Scope`; their streams and remote capabilities share that connection lifetime. In-process clients run the finite pipeline server and do not support streams or persistent handles.

The server lifecycle is request middleware, graph validation, execution middleware, then invocation middleware around each handler and its native RPC middleware. Request middleware sees structurally valid requests, including requests rejected by graph validation. Malformed or oversized structures are rejected before lifecycle middleware runs. Middleware is applied in array order, with the first entry outermost.

`request` wraps the validated execution flow; `execution` wraps the complete graph and is the transaction boundary; `invocation` wraps an actual root or capability call. Effects execute with their normal dynamic Effect context. Custom middleware error types are not automatically added to an unrelated RPC group's client contract; use declared RPC errors or an application facade for additional failures.

Protocol schemas, graph constructors, individual duplex RPCs, context services and wire conversion helpers are public for adapter authors. They do not replace graph validation, authentication, connection ownership, or the [transport contract](guides/contracts.md). The protocol is pre-1.0: deploy client and server builds from the same package version.

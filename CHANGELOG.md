# Changelog

## 0.1.0

Initial public release candidate. Adds Effect-native finite RPC dependency graphs, typed capabilities and client callbacks, HTTP and WebSocket integrations, request-local batching, SQL transactions, after-commit effects, and telemetry.

Release preparation upgrades all direct dependencies to their stable releases as of October 25, 2026, including Effect 4.0.6, TypeScript 7.0.2, Vitest 5.0.5, Vite 8.3.5 and Foldkit 0.169.0.

Changes from the private RC-based implementation:

- Use stable Effect paths (`effect/rpc`, `effect/http`, `effect/sql`, `effect/socket`). See the [migration guide](docs/guides/migration.md).
- Fix concurrent Effect combinators mistaking symbolic remotes for completed results; preserve `name`/`length` projections and add `Pipeline.field` for reserved fields.
- Give map templates lexical item scopes; correctly execute dependent and nested mapped calls, respect phase barriers, and enforce global invocation concurrency and execution-work limits. Compile dependencies once to avoid repeated descendant scans.
- Validate malformed requests, lexical references, cycles, paths, discards, unknown root methods, and structural limits before starting handlers.
- Preserve undefined values and tagged error messages; distinguish Options from domain tags and reject unsupported/cyclic final values without silent coercion. Finite success types use `Pipeline.Data` to omit class methods.
- Stop capabilities retaining request caches, SQL transaction connections, deferred regions, execution policies and request scopes. Bound server handles and callback queues; close replaced duplex sessions.
- Mark transaction infrastructure failures as unsafe to retry automatically.
- Fix blog refresh-token rotation races, explicit production configuration, capability authorization revocation checks, draft event visibility, WebSocket proxying, and not-found HTTP status.
- Add guides, generated API signatures, compiled README examples, CI and clean packed-consumer checks.

The wire representation and finite result contracts changed before the first public release. Upgrade clients and servers together. See [contracts and limits](docs/guides/contracts.md) for remaining supported-value and lifetime constraints.

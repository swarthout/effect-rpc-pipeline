# Sql

Run a finite pipeline in an Effect SQL transaction and schedule work after a successful commit.

## Common tasks

- Add `transaction()` to server middleware to wrap a graph in one transaction.
- Use `transaction({ when })` to choose which graphs need it.
- Call `afterCommit` inside a transactional handler to register best-effort follow-up effects.

After-commit effects run sequentially. For durable delivery, use an outbox.

`TransactionFailed` has `retryable: false` because the commit outcome may be unknown. Add application idempotency before replaying a mutation.

Import from `effect-rpc-pipeline/Sql`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

## Complete signatures

These signatures come from the package declarations. Relative imports refer to other package modules.

```ts
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { PipelineExecutionError } from "./Pipeline.js";
import { type ExecutionContext, type Middleware } from "./PipelineServer.js";
export interface TransactionOptions {
    /** Select which validated pipelines use a transaction. The default is every pipeline. */
    readonly when?: (context: ExecutionContext) => boolean;
    /** Reports post-commit failures. The mutation is already committed and is not failed or retried. */
    readonly onAfterCommitFailure?: (cause: unknown) => Effect.Effect<void>;
}
/** Registers best-effort work that runs sequentially after the active SQL transaction commits. */
export declare const afterCommit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>;
/** Runs each selected, validated pipeline in one Effect SQL transaction. */
export declare const transaction: (options?: TransactionOptions) => Middleware<PipelineExecutionError, SqlClient.SqlClient>;
```

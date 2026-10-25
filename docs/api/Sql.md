# Sql

Wrap selected pipeline graphs in an Effect SQL transaction. afterCommit registers sequential best-effort effects for a successful commit. TransactionFailed is never automatically retryable; use an application idempotency policy.

Import from `effect-rpc-pipeline/Sql`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

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

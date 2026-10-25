import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { denyPeerCalls } from "./ExecutionPolicy.js"
import { PipelineExecutionError } from "./Pipeline.js"
import { makeMiddleware, type ExecutionContext, type Middleware } from "./PipelineServer.js"
import * as DeferredEffects from "./DeferredEffects.js"

class PipelineFailure {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}

export interface TransactionOptions {
  /** Select which validated pipelines use a transaction. The default is every pipeline. */
  readonly when?: (context: ExecutionContext) => boolean
  /** Reports post-commit failures. The mutation is already committed and is not failed or retried. */
  readonly onAfterCommitFailure?: (cause: unknown) => Effect.Effect<void>
}

/** Registers best-effort work that runs sequentially after the active SQL transaction commits. */
export const afterCommit = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
  DeferredEffects.add(effect)

/** Runs each selected, validated pipeline in one Effect SQL transaction. */
export const transaction = (options?: TransactionOptions): Middleware<PipelineExecutionError, SqlClient.SqlClient> =>
  makeMiddleware<SqlClient.SqlClient, PipelineExecutionError>({
    execution: (effect, context) => {
      if (options?.when !== undefined && !options.when(context)) return effect
      return Effect.flatMap(SqlClient.SqlClient, (sql) => {
        const region = DeferredEffects.makeRegion()
        const guarded = DeferredEffects.provideRegion(
          Effect.catchCause(effect, (cause) => Effect.fail(new PipelineFailure(cause))),
          region
        )
        const transaction = sql.withTransaction(denyPeerCalls(
          guarded,
          "Peer interaction is disabled while atomic execution is active; complete the transaction before calling the remote peer"
        )).pipe(Effect.catch((error) => error instanceof PipelineFailure
          ? Effect.failCause(error.cause)
          : Effect.fail(new PipelineExecutionError({
            message: "SQL transaction failed",
            code: "TransactionFailed",
            // A failed COMMIT can have an unknown outcome. Replaying a mutation
            // is unsafe without application-level idempotency.
            retryable: false
          }))))
        return transaction.pipe(
          Effect.flatMap((value) => DeferredEffects.drain(
            region,
            options?.onAfterCommitFailure ?? ((cause) => Effect.logError("Post-commit effect failed", cause))
          ).pipe(Effect.as(value)))
        )
      }) as any
    }
  })

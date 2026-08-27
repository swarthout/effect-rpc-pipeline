import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { denyPeerCalls } from "./ExecutionPolicy.js"
import { PipelineExecutionError } from "./Pipeline.js"
import { makeMiddleware, type ExecutionContext, type Middleware } from "./PipelineServer.js"

class PipelineFailure {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}

export interface TransactionOptions {
  /** Select which validated pipelines use a transaction. The default is every pipeline. */
  readonly when?: (context: ExecutionContext) => boolean
}

/** Runs each selected, validated pipeline in one Effect SQL transaction. */
export const transaction = (options?: TransactionOptions): Middleware<PipelineExecutionError, SqlClient.SqlClient> =>
  makeMiddleware<SqlClient.SqlClient, PipelineExecutionError>({
    execution: (effect, context) => {
      if (options?.when !== undefined && !options.when(context)) return effect
      return Effect.flatMap(SqlClient.SqlClient, (sql) => {
        const guarded = Effect.catchCause(effect, (cause) => Effect.fail(new PipelineFailure(cause)))
        return sql.withTransaction(denyPeerCalls(
          guarded,
          "Peer interaction is disabled while atomic execution is active; complete the transaction before calling the remote peer"
        )).pipe(
          Effect.catch((error) => error instanceof PipelineFailure
            ? Effect.failCause(error.cause)
            : Effect.fail(new PipelineExecutionError({
              message: "SQL transaction failed",
              code: "TransactionFailed",
              retryable: true
            })))
        )
      }) as any
    }
  })

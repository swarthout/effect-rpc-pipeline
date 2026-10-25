import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Metric from "effect/Metric"
import { makeMiddleware, type Middleware } from "./PipelineServer.js"

export interface TracingOptions {
  /** Create a child span for each actual root or capability invocation. */
  readonly invocations?: boolean
  readonly spanPrefix?: string
}

export interface MetricsOptions {
  readonly prefix?: string
}

export interface TelemetryOptions {
  /** Enabled by default. */
  readonly tracing?: boolean | TracingOptions
  /** Enabled by default. */
  readonly metrics?: boolean | MetricsOptions
}

const outcome = <A, E>(exit: Exit.Exit<A, E>): string => {
  if (Exit.isSuccess(exit)) return "success"
  if (Cause.hasDies(exit.cause)) return "defect"
  if (Cause.interruptors(exit.cause).size > 0) return "interrupted"
  return "failure"
}

/** Adds native Effect spans and low-cardinality metrics to pipeline execution. */
export const make = (options?: TelemetryOptions): Middleware => {
  const tracing = options?.tracing ?? true
  const metrics = options?.metrics ?? true
  const tracingOptions = typeof tracing === "object" ? tracing : undefined
  const metricsOptions = typeof metrics === "object" ? metrics : undefined
  const spanPrefix = tracingOptions?.spanPrefix ?? "Pipeline"
  const metricPrefix = metricsOptions?.prefix ?? "effect_rpc_pipeline"
  const requestCount = Metric.counter(`${metricPrefix}_requests_total`, { incremental: true })
  const requestDuration = Metric.timer(`${metricPrefix}_request_duration`)
  const requestOutcomes = Metric.frequency(`${metricPrefix}_request_outcomes`)
  const nodeCount = Metric.histogram(`${metricPrefix}_nodes`, { boundaries: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] })
  const invocationCount = Metric.counter(`${metricPrefix}_invocations_total`, { incremental: true })
  const invocationDuration = Metric.timer(`${metricPrefix}_invocation_duration`)
  const invocationOutcomes = Metric.frequency(`${metricPrefix}_invocation_outcomes`)

  return makeMiddleware({
    request: (effect, context) => {
      let instrumented = effect
      if (metrics !== false) {
        const attributes = { definition: context.definitionId }
        instrumented = Effect.andThen(
          Metric.update(Metric.withAttributes(nodeCount, attributes), context.request.nodes.length),
          instrumented.pipe(
            Effect.track(Metric.withAttributes(requestCount, attributes), () => 1),
            Effect.trackDuration(Metric.withAttributes(requestDuration, attributes)),
            Effect.track(Metric.withAttributes(requestOutcomes, attributes), outcome)
          )
        )
      }
      if (tracing !== false) {
        instrumented = Effect.withSpan(instrumented, `${spanPrefix}.execute`, {
          attributes: {
            "rpc.pipeline.definition": context.request.definitionId,
            "rpc.pipeline.version": context.request.version,
            "rpc.pipeline.nodes": context.request.nodes.length
          }
        })
      }
      return instrumented
    },
    invocation: (effect, context) => {
      let instrumented = effect
      const attributes = {
        definition: context.definitionId,
        rpc: context.rpc._tag,
        kind: context.kind
      }
      if (metrics !== false) {
        instrumented = instrumented.pipe(
          Effect.track(Metric.withAttributes(invocationCount, attributes), () => 1),
          Effect.trackDuration(Metric.withAttributes(invocationDuration, attributes)),
          Effect.track(Metric.withAttributes(invocationOutcomes, attributes), outcome)
        )
      }
      if (tracing !== false && tracingOptions?.invocations !== false) {
        instrumented = Effect.withSpan(instrumented, `${spanPrefix}.${context.rpc._tag}`, {
          attributes: {
            "rpc.pipeline.definition": context.request.definitionId,
            "rpc.pipeline.node": context.nodeId,
            "rpc.pipeline.kind": context.kind
          }
        })
      }
      return instrumented
    }
  })
}

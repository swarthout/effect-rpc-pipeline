# Telemetry

Add Effect tracing and metrics around pipeline execution.

## Common tasks

- Call `make()` and add the result to server middleware.
- Configure tracing and metrics separately, or set either to `false`.
- Disable invocation spans independently when only graph-level tracing is needed.

Tracing and metrics are enabled by default. Metric dimensions are bounded; payloads and credentials are excluded.

Import from `effect-rpc-pipeline/Telemetry`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

## Complete signatures

These signatures come from the package declarations. Relative imports refer to other package modules.

```ts
import { type Middleware } from "./PipelineServer.js";
export interface TracingOptions {
    /** Create a child span for each actual root or capability invocation. */
    readonly invocations?: boolean;
    readonly spanPrefix?: string;
}
export interface MetricsOptions {
    readonly prefix?: string;
}
export interface TelemetryOptions {
    /** Enabled by default. */
    readonly tracing?: boolean | TracingOptions;
    /** Enabled by default. */
    readonly metrics?: boolean | MetricsOptions;
}
/** Adds native Effect spans and low-cardinality metrics to pipeline execution. */
export declare const make: (options?: TelemetryOptions) => Middleware;
```

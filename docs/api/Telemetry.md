# Telemetry

Construct lifecycle middleware with native Effect spans and bounded metric dimensions. Tracing and metrics are enabled by default; invocation spans can be disabled independently. No payload or credential is added to telemetry.

Import from `effect-rpc-pipeline/Telemetry`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

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

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Metric from "effect/Metric"
import * as Schema from "effect/Schema"
import * as Tracer from "effect/Tracer"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { describe, expect, expectTypeOf, it } from "vitest"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"
import * as Telemetry from "../src/Telemetry.js"

const wrap = (events: Array<string>, name: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.andThen(
    Effect.sync(() => events.push(`${name}:start`)),
    effect.pipe(Effect.ensuring(Effect.sync(() => events.push(`${name}:end`))))
  )

describe("pipeline server middleware", () => {
  it("propagates services required by custom middleware", () => {
    class Audit extends Context.Service<Audit, { readonly record: Effect.Effect<void> }>()("test/PipelineAudit") {}
    const App = RpcGroup.make(Rpc.make("value", { success: Schema.Number }))
    const middleware = PipelineServer.makeMiddleware<Audit>({
      request: (effect) => Effect.andThen(Effect.flatMap(Audit, (audit) => audit.record), effect)
    })
    const handled = PipelineServer.handle(App, {
      version: 1,
      definitionId: "default",
      nodes: [],
      selection: { _tag: "literal" },
      discards: []
    }, { middleware: [middleware] })

    type IncludesAudit = Audit extends Effect.Services<typeof handled> ? true : false
    expectTypeOf<IncludesAudit>().toEqualTypeOf<true>()
  })

  it("uses stable request, execution, and invocation boundaries", async () => {
    const App = RpcGroup.make(Rpc.make("value", { success: Schema.Number }))
    const handlers = await Effect.runPromise(App.toHandlers({ value: () => Effect.succeed(42) }))
    const events: Array<string> = []
    const middleware = PipelineServer.makeMiddleware({
      request: (effect) => wrap(events, "request")(effect),
      execution: (effect) => wrap(events, "execution")(effect),
      invocation: (effect, context) => wrap(events, `rpc:${context.rpc._tag}`)(effect)
    })
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request) => PipelineServer.handle(App, request, { middleware: [middleware] }).pipe(
        Effect.provideContext(handlers)
      )
    }))

    expect(await Effect.runPromise(client.value())).toBe(42)
    expect(events).toEqual([
      "request:start",
      "execution:start",
      "rpc:value:start",
      "rpc:value:end",
      "execution:end",
      "request:end"
    ])
  })

  it("observes invalid requests without entering validated execution", async () => {
    const App = RpcGroup.make(Rpc.make("value", { success: Schema.Number }))
    const handlers = await Effect.runPromise(App.toHandlers({ value: () => Effect.succeed(42) }))
    const events: Array<string> = []
    const middleware = PipelineServer.makeMiddleware({
      request: (effect) => wrap(events, "request")(effect),
      execution: (effect) => wrap(events, "execution")(effect)
    })
    const response = await Effect.runPromise(PipelineServer.handle(App, {
      version: 1,
      definitionId: "wrong",
      nodes: [],
      selection: { _tag: "literal" },
      discards: []
    }, { middleware: [middleware] }).pipe(Effect.provideContext(handlers)))

    expect(response._tag).toBe("Failure")
    expect(events).toEqual(["request:start", "request:end"])
  })

  it("emits native Effect spans and bounded metrics for mapped invocations", async () => {
    const App = RpcGroup.make(
      Rpc.make("ids", { success: Schema.Array(Schema.String) }),
      Rpc.make("greet", { payload: { id: Schema.String }, success: Schema.String })
    )
    const handlers = await Effect.runPromise(App.toHandlers({
      ids: () => Effect.succeed(["a", "b"]),
      greet: ({ id }: { readonly id: string }) => Effect.succeed(`Hello ${id}`)
    }))
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    const registry = new Map<string, Metric.Metric.Metadata<any, any>>()
    const telemetry = Telemetry.make({
      tracing: { spanPrefix: "TestPipeline" },
      metrics: { prefix: "test_pipeline" }
    })
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request) => PipelineServer.handle(App, request, { middleware: [telemetry] }).pipe(
        Effect.provideContext(handlers),
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.provideService(Metric.MetricRegistry, registry)
      )
    }))

    const result = await Effect.runPromise(Pipeline.map(client.ids(), (id) => client.greet({ id })))
    const snapshots = Metric.snapshotUnsafe(Context.make(Metric.MetricRegistry, registry))

    expect(result).toEqual(["Hello a", "Hello b"])
    expect(spans.map((span) => span.name)).toEqual(expect.arrayContaining([
      "TestPipeline.execute",
      "TestPipeline.ids",
      "TestPipeline.greet",
      "TestPipeline.greet"
    ]))
    const invocationCounts = snapshots.filter((snapshot) => snapshot.id === "test_pipeline_invocations_total")
    expect(invocationCounts).toHaveLength(2)
    expect(invocationCounts.reduce((total, snapshot) =>
      total + (snapshot.type === "Counter" ? Number(snapshot.state.count) : 0), 0)).toBe(3)
    expect(snapshots.every((snapshot) => {
      const attributes = snapshot.attributes === undefined ? [] : Object.entries(snapshot.attributes)
      return attributes.every(([key]) => !["requestId", "clientId", "payload"].includes(key))
    })).toBe(true)
  })
})

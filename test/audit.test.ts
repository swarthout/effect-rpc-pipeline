import * as Effect from "effect/Effect"
import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import * as Exit from "effect/Exit"
import * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"
import * as SqlClient from "effect/sql/SqlClient"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { describe, expect, it } from "vitest"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"
import * as Telemetry from "../src/Telemetry.js"
import * as Capability from "../src/Capability.js"
import * as RequestBatching from "../src/RequestBatching.js"

const Rpcs = RpcGroup.make(
  Rpc.make("numbers", { success: Schema.Array(Schema.Number) }),
  Rpc.make("double", { payload: { value: Schema.Number }, success: Schema.Number }),
  Rpc.make("optional", { payload: { value: Schema.OptionFromNullOr(Schema.Number) }, success: Schema.Option(Schema.Number) }),
  Rpc.make("pair", { payload: { left: Schema.Number, right: Schema.Number }, success: Schema.Array(Schema.Number) }),
  Rpc.make("object", { success: Schema.Struct({ name: Schema.String, length: Schema.Number, then: Schema.String, nickname: Schema.optionalKey(Schema.String) }) }),
  Rpc.make("tagged", { success: Schema.Struct({ _tag: Schema.Literal("Some"), value: Schema.String }) })
)

const fixture = async (options: PipelineServer.ServerOptions<ReadonlyArray<PipelineServer.Middleware>> = {}) => {
  const calls: Array<number> = []
  const context = await Effect.runPromise(Rpcs.toHandlers({
    numbers: () => Effect.succeed([1, 2]),
    double: ({ value }) => (value === 1 ? Effect.sleep("2 millis") : Effect.void).pipe(
      Effect.andThen(Effect.sync(() => { calls.push(value); return value * 2 }))
    ),
    optional: ({ value }) => Effect.succeed(Option.map(value, (n) => n * 2)),
    pair: ({ left, right }) => Effect.succeed([left, right]),
    object: () => Effect.succeed({ name: "Ada", length: 3, then: "value" }),
    tagged: () => Effect.succeed({ _tag: "Some" as const, value: "domain data" })
  }))
  const handle = (request: Pipeline.PipelineRequest) => PipelineServer.handle(Rpcs, request, options).pipe(Effect.provideContext(context))
  const client = await Effect.runPromise(PipelineClient.make(Rpcs, { transport: handle }))
  return { calls, handle, client }
}

describe("release audit regressions", () => {
  it("works with concurrent Effect combinators and projects function metadata fields", async () => {
    const { client } = await fixture()
    expect(await Effect.runPromise(Effect.all([client.double({ value: 1 }), client.double({ value: 2 })], { concurrency: "unbounded" }))).toEqual([2, 4])
    const object = client.object()
    expect(await Effect.runPromise(Pipeline.all({ name: object.name, length: object.length, then: Pipeline.field(object, "then") }))).toEqual({ name: "Ada", length: 3, then: "value" })
  })

  it("projects an absent optional own field as undefined", async () => {
    const { client } = await fixture()
    expect(await Effect.runPromise(Pipeline.field(client.object(), "nickname"))).toBeUndefined()
  })

  it("preserves domain objects with Option-like tags", async () => {
    const { client } = await fixture()
    const result = await Effect.runPromise(client.tagged())
    expect(Option.isOption(result)).toBe(false)
    expect(result).toEqual({ _tag: "Some", value: "domain data" })
  })

  it("resolves dependent calls inside each mapped item", async () => {
    const { client } = await fixture()
    const result = await Effect.runPromise(Pipeline.map(client.numbers(), (value) => {
      const doubled = client.double({ value })
      return client.double({ value: doubled })
    }))
    expect(result).toEqual([4, 8])
  })

  it("maps Option-wrapped items and nested maps with lexical outer values", async () => {
    const { client } = await fixture()
    const optional = await Effect.runPromise(Pipeline.map(client.numbers(), (value) => client.optional({ value: Option.some(value) })))
    expect(optional).toEqual([Option.some(2), Option.some(4)])
    const nested = await Effect.runPromise(Pipeline.map(client.numbers(), (outer) =>
      Pipeline.map(client.numbers(), (inner) => client.pair({ left: outer, right: inner }))
    ))
    expect(nested).toEqual([[[1, 1], [1, 2]], [[2, 1], [2, 2]]])
  })

  it("orders mapped work after a mutation phase", async () => {
    const { client, calls } = await fixture()
    const result = await Effect.runPromise(client.double({ value: 10 }).pipe(Pipeline.andThen(() =>
      Pipeline.map(client.numbers(), (value) => client.double({ value }))
    )))
    expect(result).toEqual([2, 4])
    expect(calls[0]).toBe(10)
  })

  it("rejects unknown methods and undeclared references before any handler runs", async () => {
    const { handle, calls } = await fixture()
    const request: Pipeline.PipelineRequest = {
      version: 1, definitionId: "default", discards: [],
      nodes: [
        { _tag: "call", id: "a", method: "double", payload: { _tag: "literal", value: { value: 1 } }, dependencies: [] },
        { _tag: "call", id: "b", method: "unknown", payload: { _tag: "literal" }, dependencies: [] }
      ],
      selection: { _tag: "ref", id: "a", path: [] }
    }
    expect(await Effect.runPromise(handle(request))).toMatchObject({ _tag: "Failure", error: { code: "UnknownMethod" } })
    expect(calls).toEqual([])
    const invalid = { ...request, nodes: [request.nodes[0]!, { _tag: "call" as const, id: "b", method: "double", payload: { _tag: "ref" as const, id: "missing", path: [] }, dependencies: [] }] }
    expect(await Effect.runPromise(handle(invalid))).toMatchObject({ _tag: "Failure", error: { code: "InvalidReference" } })
    expect(calls).toEqual([])
  })

  it("rejects invalid discards, inherited paths, and malformed direct requests", async () => {
    const { handle } = await fixture({ middleware: [Telemetry.make()] })
    const request: Pipeline.PipelineRequest = {
      version: 1, definitionId: "default", discards: ["missing"], nodes: [], selection: { _tag: "literal", value: 1 }
    }
    expect(await Effect.runPromise(handle(request))).toMatchObject({ _tag: "Failure", error: { code: "InvalidReference" } })
    expect(await Effect.runPromise(handle(null as any))).toMatchObject({ _tag: "Failure", error: { _tag: "PipelineProtocolError" } })
    const inherited: Pipeline.PipelineRequest = { ...request, discards: [], nodes: [{ _tag: "call", id: "a", method: "object", payload: { _tag: "literal" }, dependencies: [] }], selection: { _tag: "ref", id: "a", path: ["__proto__"] } }
    expect(await Effect.runPromise(handle(inherited))).toMatchObject({ _tag: "Failure", error: { code: "InvalidPath" } })
  })

  it("caps actual invocations globally across independent maps", async () => {
    let active = 0
    let maximum = 0
    const App = RpcGroup.make(Rpc.make("numbers", { success: Schema.Array(Schema.Number) }), Rpc.make("wait", { payload: { value: Schema.Number }, success: Schema.Number }))
    const handlers = await Effect.runPromise(App.toHandlers({
      numbers: () => Effect.succeed([1, 2, 3]),
      wait: ({ value }) => Effect.sync(() => { maximum = Math.max(maximum, ++active) }).pipe(
        Effect.andThen(Effect.sleep("1 millis")), Effect.as(value), Effect.ensuring(Effect.sync(() => { active-- }))
      )
    }))
    const client = await Effect.runPromise(PipelineClient.make(App, { transport: (request) => PipelineServer.handle(App, request, { limits: { concurrency: 2 } }).pipe(Effect.provideContext(handlers)) }))
    await Effect.runPromise(Pipeline.all({ left: Pipeline.map(client.numbers(), (value) => client.wait({ value })), right: Pipeline.map(client.numbers(), (value) => client.wait({ value })) }))
    expect(maximum).toBeLessThanOrEqual(2)
    expect(active).toBe(0)
  })

  it("bounds nested pure maps and large templates independently of RPC counts", async () => {
    const { client } = await fixture({
      limits: { maxMapItems: 2, maxInvocations: 2, maxExecutionSteps: 25 }
    })
    const numbers = client.numbers()
    const nested = Pipeline.map(numbers, () => Pipeline.map(numbers, () => Pipeline.map(numbers, (value) => value)))
    expect(await Effect.runPromise(Effect.flip(nested))).toMatchObject({ _tag: "PipelineProtocolError", code: "LimitExceeded" })
    const largeTemplate = Pipeline.map(numbers, (value) => Array.from({ length: 30 }, () => value))
    expect(await Effect.runPromise(Effect.flip(largeTemplate))).toMatchObject({ _tag: "PipelineProtocolError", code: "LimitExceeded" })
    expect(await Effect.runPromise(numbers)).toEqual([1, 2])
  })

  it("retains sequencing even when an intermediate selection is a literal", async () => {
    const { client, calls } = await fixture()
    const program = client.double({ value: 1 }).pipe(
      Pipeline.andThen(() => "done"),
      Pipeline.andThen(() => client.double({ value: 2 }))
    )
    expect(await Effect.runPromise(program)).toBe(4)
    expect(calls).toEqual([1, 2])
  })

  it("decodes mixed native and null-encoded Options", async () => {
    const App = RpcGroup.make(Rpc.make("mixed", {
      payload: { native: Schema.Option(Schema.Number), nullable: Schema.OptionFromNullOr(Schema.Number) },
      success: Schema.Number
    }))
    const client = await Effect.runPromise(PipelineClient.makeInProcess(App).pipe(Effect.provide(App.toLayer({
      mixed: ({ native, nullable }) => Effect.succeed(Option.getOrElse(native, () => 0) + Option.getOrElse(nullable, () => 0))
    }))))
    expect(await Effect.runPromise(client.mixed({ native: Option.some(1), nullable: Option.some(2) }))).toBe(3)
  })

  it("rejects deep requests before recursive decoding", async () => {
    const { handle, calls } = await fixture()
    let selection: Pipeline.Expr = { _tag: "literal", value: 1 }
    for (let i = 0; i < 100; i++) selection = { _tag: "some", value: selection }
    expect(await Effect.runPromise(handle({ version: 1, definitionId: "default", nodes: [], discards: [], selection }))).toMatchObject({ _tag: "Failure", error: { code: "LimitExceeded" } })
    expect(calls).toEqual([])
  })

  it("does not capture request caches or transaction connections in capabilities", async () => {
    class Read extends Request.TaggedClass("audit/Read")<{}, number> {}
    let current = 1
    const resolver = RequestResolver.make<Read>((entries) => Effect.sync(() => {
      for (const entry of entries) entry.completeUnsafe(Exit.succeed(current))
    }))
    const cached = RequestBatching.cache(resolver, { capacity: 4 })
    class Transaction extends Context.Service<Transaction, string>()("audit/Transaction") {}
    const App = RpcGroup.make(Rpc.make("read", { success: Schema.Number }))
    const definition = Capability.make("audit/CacheLifetime", App)
    const capability = await Effect.runPromise(definition.fromHandlers({
      read: () => Effect.flatMap(cached, Cache.get(new Read()))
    }).pipe(
      Effect.provideService(RequestBatching.RequestScope, RequestBatching.makeScope()),
      Effect.provideService(Transaction, "released"),
      Effect.provideService(SqlClient.SqlClient, { transactionService: Transaction } as unknown as SqlClient.SqlClient)
    ))
    expect(Context.getOrUndefined(capability.context, Transaction)).toBeUndefined()
    expect(Capability.isSchema(definition.schema)).toBe(true)
    expect(await Effect.runPromise(capability.read())).toBe(1)
    current = 2
    expect(await Effect.runPromise(capability.read())).toBe(2)
  })

  it("round-trips undefined and tagged error messages without coercing unsupported values", async () => {
    const outcomes: Array<boolean> = []
    class Invalid extends Schema.TaggedError<Invalid>()("audit/Invalid", { message: Schema.String }) {}
    const App = RpcGroup.make(
      Rpc.make("unit", { success: Schema.Void }),
      Rpc.make("unsupported", { success: Schema.Unknown }),
      Rpc.make("invalid", { error: Invalid })
    )
    const client = await Effect.runPromise(PipelineClient.makeInProcess(App, {
      middleware: [PipelineServer.makeMiddleware<never>({ request: (effect) => effect.pipe(Effect.onExit((exit) => Effect.sync(() => { outcomes.push(Exit.isFailure(exit)) }))) })]
    }).pipe(Effect.provide(App.toLayer({
      unit: () => Effect.void,
      unsupported: () => Effect.succeed(new Date()),
      invalid: () => Effect.fail(new Invalid({ message: "Visible typed failure" }))
    }))))
    expect(await Effect.runPromise(Pipeline.all({ unit: client.unit(), array: [client.unit()] }))).toEqual({ unit: undefined, array: [undefined] })
    expect(await Effect.runPromise(Effect.flip(client.unsupported()))).toMatchObject({ _tag: "PipelineProtocolError", code: "UnsupportedValue" })
    expect(await Effect.runPromise(Effect.flip(client.invalid()))).toMatchObject({ _tag: "audit/Invalid", message: "Visible typed failure" })
    expect(outcomes).toEqual([false, true, true])
  })

  it("types class results as data and rejects non-data literals during construction", async () => {
    class Person extends Schema.Class<Person>("audit/Person")({ name: Schema.String }) {
      greet() { return `Hello ${this.name}` }
    }
    const App = RpcGroup.make(Rpc.make("person", { success: Person }), Rpc.make("input", { payload: Schema.Unknown }))
    const client = await Effect.runPromise(PipelineClient.makeInProcess(App).pipe(Effect.provide(App.toLayer({
      person: () => Effect.succeed(new Person({ name: "Ada" })), input: () => Effect.void
    }))))
    const person = await Effect.runPromise(client.person())
    expect(person).toEqual({ name: "Ada" })
    expect(person).not.toBeInstanceOf(Person)
    if (false) {
      // @ts-expect-error class methods do not cross a finite pipeline boundary
      person.greet()
    }
    expect(() => client.input(new Date())).toThrow(/JSON data/)
    expect(() => client.input(1n)).toThrow(/Unsupported/)
    const cyclic: { value?: unknown } = {}; cyclic.value = cyclic
    expect(() => client.input(cyclic)).toThrow(/cycles/)
  })
})

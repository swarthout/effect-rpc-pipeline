import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { describe, expect, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Duplex from "../src/Duplex.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

describe("security boundaries", () => {
  it("uses opaque capability ids and rejects duplicate definitions", async () => {
    const Rpcs = RpcGroup.make(Rpc.make("value", { success: Schema.String }))
    const definition = Capability.make("security/Opaque", Rpcs)
    const instance = await Effect.runPromise(definition.fromHandlers({ value: () => Effect.succeed("ok") }))
    expect(instance.capabilityId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
    expect(instance.capabilityId).not.toContain(definition.id)
    expect(() => Capability.make("security/Opaque", Rpcs)).toThrow(/already registered/)
  })

  it("binds capability schemas and wire results to their exact definitions", async () => {
    const Numbers = RpcGroup.make(Rpc.make("value", { success: Schema.Number }))
    const Strings = RpcGroup.make(Rpc.make("value", { success: Schema.String }))
    const NumberCapability = Capability.make("security/Number", Numbers)
    const StringCapability = Capability.make("security/String", Strings)
    const stringInstance = await Effect.runPromise(StringCapability.fromHandlers({ value: () => Effect.succeed("value") }))

    const wrongDefinition = await Effect.runPromise(Effect.flip(Schema.decodeUnknownEffect(NumberCapability.schema)(stringInstance)))
    expect(wrongDefinition).toBeDefined()

    const remote = Capability.fromRemoteRef({
      _tag: Capability.CapabilityRefTag,
      definitionId: NumberCapability.id,
      capabilityId: crypto.randomUUID(),
      owner: "server"
    }, () => Effect.succeed("not-a-number")) as Capability.CapabilityInstance<typeof Numbers>
    const invalidSuccess = await Effect.runPromise(Effect.flip(remote.value()))
    expect(invalidSuccess).toMatchObject({ _tag: "CapabilityTransportError" })
    expect(Capability.isRef({
      _tag: Capability.CapabilityRefTag,
      definitionId: NumberCapability.id,
      capabilityId: crypto.randomUUID(),
      owner: "attacker"
    })).toBe(false)
  })

  it("prevents cross-connection callback reply injection", async () => {
    const CallbackRpcs = RpcGroup.make(Rpc.make("approve", { success: Schema.Boolean }))
    const Callback = Capability.make("security/ReplyOwner", CallbackRpcs)
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const server = yield* Duplex.makeServer
      const stream = yield* server.open("session-owner", 7)
      const events = yield* Queue.unbounded<Duplex.SessionEvent>()
      yield* stream.pipe(Stream.runForEach((event) => Queue.offer(events, event)), Effect.forkScoped)
      yield* Queue.take(events)
      const local = yield* Callback.fromHandlers({ approve: () => Effect.succeed(true) })
      const ref = Capability.toRef(local, "client")
      const invocation = yield* server.invokeClient(7, ref, "approve", undefined).pipe(Effect.forkScoped)
      const event = yield* Queue.take(events)
      if (event._tag !== "Invoke") return yield* Effect.die("Expected callback invocation")
      const injected = yield* Effect.flip(server.reply(8, "session-owner", event.callId, { _tag: "Success", value: false }))
      yield* server.reply(7, "session-owner", event.callId, { _tag: "Success", value: true })
      return { injected, value: yield* Fiber.join(invocation) }
    })))
    expect(result.injected).toMatchObject({ _tag: "DuplexError", reason: "Unknown callback invocation" })
    expect(result.value).toBe(true)
  })

  it("binds server capabilities to session, definition, and connection", async () => {
    const Rpcs = RpcGroup.make(Rpc.make("value", { success: Schema.String }))
    const definition = Capability.make("security/SessionBinding", Rpcs)
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const server = yield* Duplex.makeServer
      yield* server.open("session-a", 1)
      const instance = yield* definition.fromHandlers({ value: () => Effect.succeed("ok") })
      server.registerServerCapability(1, instance)
      expect(server.getServerCapability(1, "session-a", definition.id, instance.capabilityId)).toBe(instance)
      expect(server.getServerCapability(2, "session-a", definition.id, instance.capabilityId)).toBeUndefined()
      expect(server.getServerCapability(1, "session-b", definition.id, instance.capabilityId)).toBeUndefined()
      expect(server.getServerCapability(1, "session-a", "security/Other", instance.capabilityId)).toBeUndefined()
      const duplicate = yield* Effect.flip(server.open("session-a", 2))
      expect(duplicate).toMatchObject({ _tag: "DuplexError" })
    })))
  })

  it("rejects capability export over HTTP-style pipelines", async () => {
    const SessionRpcs = RpcGroup.make(Rpc.make("whoami", { success: Schema.String }))
    const Session = Capability.make("security/HttpExport", SessionRpcs)
    const App = RpcGroup.make(Rpc.make("session", { success: Session.schema }))
    const handlers = await Effect.runPromise(App.toHandlers({
      session: () => Session.fromHandlers({ whoami: () => Effect.succeed("user-1") })
    }))
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request) => PipelineServer.handle(App, request, { id: "http-security" }).pipe(Effect.provideContext(handlers)),
      id: "http-security"
    }))
    const failure = await Effect.runPromise(Effect.flip(client.session()))
    expect(failure).toMatchObject({ _tag: "PipelineProtocolError", code: "UnsupportedRpc" })
  })

  it("enforces map and total invocation limits", async () => {
    const App = RpcGroup.make(
      Rpc.make("ids", { success: Schema.Array(Schema.Number) }),
      Rpc.make("double", { payload: { value: Schema.Number }, success: Schema.Number })
    )
    const handlers = await Effect.runPromise(App.toHandlers({
      ids: () => Effect.succeed([1, 2, 3]),
      double: ({ value }) => Effect.succeed(value * 2)
    }))
    const client = await Effect.runPromise(PipelineClient.make(App, {
      transport: (request) => PipelineServer.handle(App, request, {
        limits: { maxMapItems: 2, maxInvocations: 2, concurrency: 1 }
      }).pipe(Effect.provideContext(handlers))
    }))
    const failure = await Effect.runPromise(Effect.flip(Pipeline.map(client.ids(), (value) => client.double({ value }))))
    expect(failure).toMatchObject({ _tag: "PipelineProtocolError", code: "LimitExceeded" })
  })
})

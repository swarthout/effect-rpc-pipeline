import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import type { CapabilityInstance, CapabilityRef } from "./Capability.js"
import * as Capability from "./Capability.js"

export class DuplexError extends Schema.TaggedError<DuplexError>()("DuplexError", {
  reason: Schema.String,
  sessionId: Schema.optional(Schema.String),
  capabilityId: Schema.optional(Schema.String)
}) {}

/** Marks execution that must not wait for a remote peer while holding resources such as SQL locks. */
export class InTransaction extends Context.Reference<boolean>("effect-rpc-pipeline/DuplexInTransaction", {
  defaultValue: () => false
}) {}

export const CapabilityRefSchema: Schema.Schema<CapabilityRef> = Schema.Struct({
  _tag: Schema.Literal(Capability.CapabilityRefTag),
  definitionId: Schema.String,
  capabilityId: Schema.String,
  owner: Schema.Union([Schema.Literal("client"), Schema.Literal("server")])
})

const InvocationSchema = Schema.Struct({
  _tag: Schema.Literal("Invoke"),
  callId: Schema.String,
  capabilityId: Schema.String,
  method: Schema.String,
  payload: Schema.optionalKey(Schema.Unknown)
})

const ReadySchema = Schema.Struct({
  _tag: Schema.Literal("Ready"),
  sessionId: Schema.String
})

const CancelSchema = Schema.Struct({
  _tag: Schema.Literal("Cancel"),
  callId: Schema.String
})

export type SessionEvent = Schema.Schema.Type<typeof SessionEventSchema>
const SessionEventSchema = Schema.Union([ReadySchema, InvocationSchema, CancelSchema])

export const SessionRpc = Rpc.make("__effect_rpc_pipeline_session_v1", {
  payload: { sessionId: Schema.String },
  success: SessionEventSchema,
  error: DuplexError,
  stream: true
})

export const ReplyRpc = Rpc.make("__effect_rpc_pipeline_reply_v1", {
  payload: {
    sessionId: Schema.String,
    callId: Schema.String,
    exit: Schema.Struct({
      _tag: Schema.Union([Schema.Literal("Success"), Schema.Literal("Failure")]),
      value: Schema.optionalKey(Schema.Unknown)
    })
  },
  success: Schema.Void,
  error: DuplexError
})

export const CallServerCapabilityRpc = Rpc.make("__effect_rpc_pipeline_capability_v1", {
  payload: {
    sessionId: Schema.String,
    capabilityId: Schema.String,
    method: Schema.String,
    payload: Schema.optionalKey(Schema.Unknown)
  },
  success: Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) }),
  error: Schema.Unknown
})

export const ReleaseCapabilityRpc = Rpc.make("__effect_rpc_pipeline_release_v1", {
  payload: {
    sessionId: Schema.String,
    capabilityId: Schema.String
  },
  success: Schema.Void
})

export const Rpcs = RpcGroup.make(SessionRpc, ReplyRpc, CallServerCapabilityRpc, ReleaseCapabilityRpc)

type Invocation = Schema.Schema.Type<typeof InvocationSchema>
type Session = {
  readonly id: string
  readonly clientId: number
  readonly queue: Queue.Queue<SessionEvent, Cause.Done>
  readonly pending: Map<string, Deferred.Deferred<unknown, unknown>>
  readonly serverCapabilities: Map<string, CapabilityInstance>
  nextCallId: number
}

export type ServerService = {
  readonly open: (sessionId: string, clientId: number) => Effect.Effect<Stream.Stream<SessionEvent, never>, DuplexError>
  readonly reply: (sessionId: string, callId: string, exit: { readonly _tag: "Success" | "Failure"; readonly value?: unknown }) => Effect.Effect<void, DuplexError>
  readonly invokeClient: (clientId: number, ref: CapabilityRef, method: string, payload: unknown) => Effect.Effect<unknown, unknown>
  readonly registerServerCapability: (clientId: number, instance: CapabilityInstance) => CapabilityRef
  readonly getServerCapability: (clientId: number, capabilityId: string) => CapabilityInstance | undefined
  readonly callServerCapability: (clientId: number, capabilityId: string, method: string, payload: unknown) => Effect.Effect<unknown, unknown>
  readonly releaseServerCapability: (clientId: number, capabilityId: string) => void
}

export class Server extends Context.Service<Server, ServerService>()("effect-rpc-pipeline/DuplexServer") {}

export const makeServer = Effect.sync((): ServerService => {
  const sessionsById = new Map<string, Session>()
  const sessionsByClient = new Map<number, Session>()

  const close = (session: Session) => {
    sessionsById.delete(session.id)
    if (sessionsByClient.get(session.clientId) === session) sessionsByClient.delete(session.clientId)
    for (const deferred of session.pending.values()) Deferred.doneUnsafe(deferred, Effect.fail(new Capability.CapabilityTransportError({ reason: "Connection closed", capabilityId: "connection" })))
    session.pending.clear()
    session.serverCapabilities.clear()
  }

  return {
    open: (sessionId, clientId) => Effect.gen(function*() {
      const previous = sessionsById.get(sessionId)
      if (previous !== undefined) close(previous)
      const queue = yield* Queue.make<SessionEvent, Cause.Done>()
      const session: Session = { id: sessionId, clientId, queue, pending: new Map(), serverCapabilities: new Map(), nextCallId: 0 }
      sessionsById.set(sessionId, session)
      sessionsByClient.set(clientId, session)
      yield* Queue.offer(queue, { _tag: "Ready", sessionId })
      return Stream.fromQueue(queue).pipe(Stream.ensuring(Effect.sync(() => close(session))))
    }),
    reply: (sessionId, callId, exit) => Effect.suspend(() => {
      const session = sessionsById.get(sessionId)
      const deferred = session?.pending.get(callId)
      if (session === undefined || deferred === undefined) return Effect.fail(new DuplexError({ reason: "Unknown callback invocation", sessionId }))
      session.pending.delete(callId)
      Deferred.doneUnsafe(deferred, exit._tag === "Success" ? Effect.succeed(exit.value) : Effect.fail(exit.value))
      return Effect.void
    }),
    invokeClient: (clientId, ref, method, payload) => Effect.gen(function*() {
      if (yield* InTransaction) {
        return yield* Effect.fail(new Capability.CapabilityTransportError({
          reason: "A reverse RPC cannot run inside sqlTransaction; publish after commit or opt into a separate workflow",
          capabilityId: ref.capabilityId
        }))
      }
      const session = sessionsByClient.get(clientId)
      if (session === undefined) return yield* Effect.fail(new Capability.CapabilityTransportError({ reason: "WebSocket duplex session is not available", capabilityId: ref.capabilityId }))
      const callId = `${session.id}:${session.nextCallId++}`
      const deferred = yield* Deferred.make<unknown, unknown>()
      session.pending.set(callId, deferred)
      yield* Queue.offer(session.queue, {
        _tag: "Invoke",
        callId,
        capabilityId: ref.capabilityId,
        method,
        ...(payload === undefined ? {} : { payload })
      })
      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => Queue.offer(session.queue, { _tag: "Cancel", callId })),
        Effect.ensuring(Effect.sync(() => session.pending.delete(callId)))
      )
    }),
    registerServerCapability: (clientId, instance) => {
      const session = sessionsByClient.get(clientId)
      if (session === undefined) throw new DuplexError({ reason: "Persistent capabilities require a WebSocket duplex session", capabilityId: instance.capabilityId })
      session.serverCapabilities.set(instance.capabilityId, instance)
      return Capability.toRef(instance, "server")
    },
    getServerCapability: (clientId, capabilityId) => sessionsByClient.get(clientId)?.serverCapabilities.get(capabilityId),
    callServerCapability: (clientId, capabilityId, method, payload) => Effect.suspend(() => {
      const session = sessionsByClient.get(clientId)
      const instance = session?.serverCapabilities.get(capabilityId)
      if (session === undefined || instance === undefined) return Effect.fail(new Capability.CapabilityUnavailable({ reason: "Capability has been released", capabilityId }))
      return Capability.invokeLocal(instance, method, payload)
    }),
    releaseServerCapability: (clientId, capabilityId) => {
      sessionsByClient.get(clientId)?.serverCapabilities.delete(capabilityId)
    }
  }
})

export const handlers = (server: ServerService) => Rpcs.of({
  [SessionRpc._tag]: ({ sessionId }, { client }) => Stream.unwrap(server.open(sessionId, client.id)),
  [ReplyRpc._tag]: ({ sessionId, callId, exit }) => server.reply(sessionId, callId, exit),
  [CallServerCapabilityRpc._tag]: ({ capabilityId, method, payload }, { client }) =>
    server.callServerCapability(client.id, capabilityId, method, payload).pipe(
      Effect.map((value) => value === undefined ? {} : { value })
    ),
  [ReleaseCapabilityRpc._tag]: ({ capabilityId }, { client }) => Effect.sync(() => server.releaseServerCapability(client.id, capabilityId))
})

const transform = (value: unknown, f: (ref: CapabilityRef) => unknown, local: (instance: CapabilityInstance) => unknown): unknown => {
  if (Capability.isInstance(value)) return local(value)
  if (Capability.isRef(value)) return f(value)
  if (Option.isOption(value)) return Option.isNone(value) ? value : Option.some(transform(value.value, f, local))
  if (Array.isArray(value)) return value.map((item) => transform(item, f, local))
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item, f, local)]))
  return value
}

export const resolveServerValue = (server: ServerService, clientId: number, value: unknown): unknown => transform(
  value,
  (ref) => ref.owner === "client"
    ? Capability.fromRemoteRef(ref, (method, payload) => server.invokeClient(clientId, ref, method, payload))
    : server.getServerCapability(clientId, ref.capabilityId) ?? ref,
  (instance) => instance
)

export const encodeServerValue = (server: ServerService, clientId: number, value: unknown): unknown => transform(
  value,
  (ref) => ref,
  (instance) => server.registerServerCapability(clientId, instance)
)

export type ClientSession = {
  readonly sessionId: string
  readonly ready: Effect.Effect<void, DuplexError>
  readonly encodeLiteral: (value: unknown) => unknown
  readonly decode: (value: unknown) => unknown
}

export const makeClientSession = (
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof Rpcs>, any>
): Effect.Effect<ClientSession, never, Scope.Scope> => Effect.gen(function*() {
  const sessionId = globalThis.crypto.randomUUID()
  const localCapabilities = new Map<string, CapabilityInstance>()
  const invocations = new Map<string, Fiber.Fiber<void, any>>()
  const ready = yield* Deferred.make<void, DuplexError>()

  const reply = (callId: string, exit: { readonly _tag: "Success" | "Failure"; readonly value: unknown }) =>
    client[ReplyRpc._tag]({
      sessionId,
      callId,
      exit: exit.value === undefined ? { _tag: exit._tag } : exit
    })

  yield* client[SessionRpc._tag]({ sessionId }).pipe(
    Stream.runForEach((event) => {
      if (event._tag === "Ready") {
        Deferred.doneUnsafe(ready, Effect.void)
        return Effect.void
      }
      if (event._tag === "Cancel") {
        const fiber = invocations.get(event.callId)
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber).pipe(Effect.asVoid)
      }
      const instance = localCapabilities.get(event.capabilityId)
      if (instance === undefined) return reply(event.callId, {
        _tag: "Failure",
        value: new Capability.CapabilityUnavailable({ capabilityId: event.capabilityId, reason: "Capability has been released" })
      })
      return Effect.matchEffect(Capability.invokeLocal(instance, event.method, event.payload), {
        onFailure: (error) => reply(event.callId, { _tag: "Failure", value: error }),
        onSuccess: (value) => reply(event.callId, { _tag: "Success", value })
      }).pipe(
        Effect.ensuring(Effect.sync(() => invocations.delete(event.callId))),
        Effect.forkScoped,
        Effect.tap((fiber) => Effect.sync(() => invocations.set(event.callId, fiber))),
        Effect.asVoid
      )
    }),
    Effect.catchCause((cause) => {
      Deferred.doneUnsafe(ready, Effect.fail(new DuplexError({ reason: Cause.pretty(cause), sessionId })))
      return Effect.void
    }),
    Effect.forkScoped
  )

  const decode = (value: unknown): unknown => transform(
    value,
    (ref) => ref.owner === "server"
      ? Capability.fromRemoteRef(
        ref,
        (method, payload) => client[CallServerCapabilityRpc._tag]({
          sessionId,
          capabilityId: ref.capabilityId,
          method,
          ...(payload === undefined ? {} : { payload })
        }).pipe(Effect.map(({ value }) => value)),
        client[ReleaseCapabilityRpc._tag]({ sessionId, capabilityId: ref.capabilityId })
      )
      : localCapabilities.get(ref.capabilityId) ?? ref,
    (instance) => instance
  )

  return {
    sessionId,
    ready: Deferred.await(ready),
    encodeLiteral(value) {
      if (!Capability.isInstance(value)) return value
      if (value.owner === "local") localCapabilities.set(value.capabilityId, value)
      return Capability.toRef(value, value.owner === "local" ? "client" : "server")
    },
    decode
  }
})

export class Enabled extends Context.Reference<boolean>("effect-rpc-pipeline/DuplexEnabled", {
  defaultValue: () => false
}) {}

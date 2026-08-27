import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcTest from "effect/unstable/rpc/RpcTest"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { describe, expect, expectTypeOf, it } from "vitest"
import * as Capability from "../src/Capability.js"
import * as Duplex from "../src/Duplex.js"
import * as PipelineSql from "../src/Sql.js"

describe("bidirectional capability sessions", () => {
  it("lets the server invoke a typed capability exported by the client", async () => {
    class ApprovalFailed extends Schema.TaggedError<ApprovalFailed>()("ApprovalFailed", {
      reason: Schema.String
    }) {}
    const ApprovalRpcs = RpcGroup.make(Rpc.make("approve", {
      payload: { total: Schema.Number },
      success: Schema.Boolean,
      error: ApprovalFailed
    }))
    const Approval = Capability.make("test/Approval", ApprovalRpcs)

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const server = yield* Duplex.makeServer
      const handlerContext = yield* Duplex.Rpcs.toHandlers(Duplex.handlers(server))
      const rpc = yield* RpcTest.makeClient(Duplex.Rpcs).pipe(Effect.provideContext(handlerContext))
      const session = yield* Duplex.makeClientSession(rpc)
      yield* session.ready

      const local = yield* Approval.fromHandlers({
        approve: ({ total }) => Effect.succeed(total < 100)
      })
      const ref = session.encodeLiteral(local)
      const remote = Duplex.resolveServerValue(server, 0, ref) as typeof local
      const accepted = yield* remote.approve({ total: 42 })
      const rejected = yield* remote.approve({ total: 142 })
      const sql = { withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect } as SqlClient.SqlClient
      const transaction = PipelineSql.transaction().execution!
      const transactionFailure = yield* Effect.flip(transaction(
        remote.approve({ total: 1 }),
        {} as any
      ).pipe(Effect.provideService(SqlClient.SqlClient, sql)))

      expectTypeOf(remote.approve({ total: 1 })).toMatchTypeOf<Effect.Effect<boolean, ApprovalFailed | Capability.CapabilityUnavailable | Capability.CapabilityTransportError>>()
      return { accepted, rejected, transactionFailure }
    })))

    expect(result.accepted).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.transactionFailure).toMatchObject({ _tag: "CapabilityTransportError" })
  })

  it("round-trips a server capability and preserves typed failures", async () => {
    class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()("NotAuthenticated", {}) {}
    const AuthedRpcs = RpcGroup.make(
      Rpc.make("currentUser", { success: Schema.String }),
      Rpc.make("signOut", { success: Schema.Void }),
      Rpc.make("restricted", { success: Schema.String, error: NotAuthenticated })
    )
    const AuthedApi = Capability.make("test/AuthedApi", AuthedRpcs)

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const server = yield* Duplex.makeServer
      const handlerContext = yield* Duplex.Rpcs.toHandlers(Duplex.handlers(server))
      const rpc = yield* RpcTest.makeClient(Duplex.Rpcs).pipe(Effect.provideContext(handlerContext))
      const session = yield* Duplex.makeClientSession(rpc)
      yield* session.ready

      const local = yield* AuthedApi.fromHandlers({
        currentUser: () => Effect.succeed("user-1"),
        signOut: () => Effect.void,
        restricted: () => Effect.fail(new NotAuthenticated())
      })
      const ref = Duplex.encodeServerValue(server, 0, local)
      const remote = session.decode(ref) as typeof local
      const user = yield* remote.currentUser()
      const signedOut = yield* remote.signOut()
      const failure = yield* Effect.flip(remote.restricted())
      yield* Capability.release(remote)
      const released = yield* Effect.flip(remote.currentUser())
      return { user, signedOut, failure, released }
    })))

    expect(result.user).toBe("user-1")
    expect(result.signedOut).toBeUndefined()
    expect(result.failure).toMatchObject({ _tag: "NotAuthenticated" })
    expect(result.released).toMatchObject({ _tag: "CapabilityUnavailable" })
  })

  it("propagates interruption to an in-flight client capability", async () => {
    const CallbackRpcs = RpcGroup.make(Rpc.make("wait", { success: Schema.Void }))
    const Callback = Capability.make("test/CancellableCallback", CallbackRpcs)

    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const server = yield* Duplex.makeServer
      const handlerContext = yield* Duplex.Rpcs.toHandlers(Duplex.handlers(server))
      const rpc = yield* RpcTest.makeClient(Duplex.Rpcs).pipe(Effect.provideContext(handlerContext))
      const session = yield* Duplex.makeClientSession(rpc)
      yield* session.ready
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const local = yield* Callback.fromHandlers({
        wait: () => Effect.andThen(
          Deferred.succeed(started, undefined),
          Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
        )
      })
      const remote = Duplex.resolveServerValue(server, 0, session.encodeLiteral(local)) as typeof local
      const fiber = yield* remote.wait().pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(interrupted)
    })))
  })
})

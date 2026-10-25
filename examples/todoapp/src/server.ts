import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Headers from "effect/http/Headers"
import * as Rpc from "effect/rpc/Rpc"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"
import { AccessTokenVerifierLive, AuthenticatedLive } from "./todo-auth.js"
import { CurrentUser } from "./todo.js"
import { AppRpcs, AuthedCapability, Forbidden, User } from "./schema.js"

const users = new Map([
  ["usr_100", { id: "usr_100", name: "Ada", lastSeen: 0 }],
  ["usr_101", { id: "usr_101", name: "Grace", lastSeen: 0 }],
  ["usr_102", { id: "usr_102", name: "Linus", lastSeen: 0 }],
  ["usr_103", { id: "usr_103", name: "Barbara", lastSeen: 0 }]
])

export let profileLookups = 0
export let mutationCount = 0

const UserRepository = {
  get: (id: string) => Effect.sync(() => {
    profileLookups++
    const user = users.get(id)
    if (!user) throw new Error(`Unknown user ${id}`)
    return new User(user)
  }),
  updateLastSeen: (id: string, timestamp: number) => Effect.sync(() => {
    mutationCount++
    const user = users.get(id)
    if (!user) throw new Error(`Unknown user ${id}`)
    const updated = { ...user, lastSeen: timestamp }
    users.set(id, updated)
    return new User(updated)
  })
}

export const AppHandlers = AppRpcs.of({
  openSession: () => Effect.gen(function*() {
    const currentUser = yield* CurrentUser
    return yield* AuthedCapability.fromHandlers({
      getUserId: () => Effect.succeed(currentUser.id),
      getFriendIds: () => Effect.succeed(["usr_101", "usr_102", "usr_103"])
    })
  }),
  getUserProfile: ({ id }) => Effect.gen(function*() {
    return yield* UserRepository.get(id)
  }),
  updateLastSeen: ({ id, timestamp }) => Effect.gen(function*() {
    const currentUser = yield* CurrentUser
    if (currentUser.id !== id) return yield* Effect.fail(new Forbidden())
    return yield* UserRepository.updateLastSeen(id, timestamp)
  })
})

export const AppLive = AppRpcs.toLayer(AppHandlers).pipe(Layer.provide(AccessTokenVerifierLive))
const AppServices = Layer.merge(Layer.merge(AppLive, AuthenticatedLive), AccessTokenVerifierLive)
const ServerTelemetry = PipelineTelemetry.make({ metrics: { prefix: "example_app_rpc" } })

// Native Effect composition for a real RpcServer host. Existing AppLive is reused unchanged.
export const ServerLive = PipelineServer.layerHttp({
  group: AppRpcs,
  id: "example-app",
  path: "/rpc",
  middleware: [ServerTelemetry]
}).pipe(Layer.provide(AppServices))

export const WebSocketServerLive = PipelineServer.layerWebSocket({
  group: AppRpcs,
  id: "example-app",
  path: "/rpc",
  middleware: [ServerTelemetry]
}).pipe(Layer.provide(AppServices))

export const handlePipeline = async (request: unknown, authorization?: string) => Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const handlers = yield* AppRpcs.toHandlers(AppHandlers).pipe(Effect.provide(AccessTokenVerifierLive))
    const auth = yield* Layer.build(Layer.merge(AuthenticatedLive, AccessTokenVerifierLive))
    return yield* PipelineServer.handle(AppRpcs, request as any, {
      id: "example-app",
      metadata: {
        client: new Rpc.ServerClient(1),
        requestId: "example-http",
        headers: Headers.fromInput({ authorization })
      }
    }).pipe(Effect.provideContext(Context.merge(handlers, auth))) as any
  })) as Effect.Effect<any, unknown, never>
)

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { AppRpcs, AuthedCapability, User } from "./schema.js"

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
  authenticate: ({ token }) => Effect.gen(function*() {
    return yield* AuthedCapability.fromHandlers({
      getUserId: () => Effect.succeed(token === "demo-token" ? "usr_100" : "usr_101"),
      getFriendIds: () => Effect.succeed(["usr_101", "usr_102", "usr_103"])
    })
  }),
  getUserProfile: ({ id }) => Effect.gen(function*() {
    return yield* UserRepository.get(id)
  }),
  updateLastSeen: ({ id, timestamp }) => Effect.gen(function*() {
    return yield* UserRepository.updateLastSeen(id, timestamp)
  })
})

export const AppLive = AppRpcs.toLayer(AppHandlers)

// Native Effect composition for a real RpcServer host. Existing AppLive is reused unchanged.
export const ServerLive = PipelineServer.layerHttp({
  group: AppRpcs,
  id: "example-app",
  path: "/rpc",
  protocol: "http"
}).pipe(Layer.provide(AppLive))

export const handlePipeline = async (request: unknown) => {
  const context = await Effect.runPromise(AppRpcs.toHandlers(AppHandlers))
  return Effect.runPromise(PipelineServer.handle(AppRpcs, request as any, { id: "example-app" }).pipe(Effect.provideContext(context)) as any)
}

import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import * as Capability from "effect-rpc-pipeline/Capability"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import * as PipelineSql from "effect-rpc-pipeline/Sql"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"

const User = Schema.Struct({ id: Schema.String, name: Schema.String })
type User = typeof User.Type
class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { email: Schema.String }) {}

// snippet:capability-definition:start
const SessionRpcs = RpcGroup.make(
  Rpc.make("currentUser", { success: User }),
  Rpc.make("greet", { success: Schema.String })
)

const UserSession = Capability.make("app/UserSession", SessionRpcs)
const OpenSession = Rpc.make("openSession", { success: UserSession.schema })
// snippet:capability-definition:end

const NotificationSink = Capability.make("app/NotificationSink", RpcGroup.make(
  Rpc.make("notify", { payload: { message: Schema.String }, success: Schema.Boolean })
))

export const AppRpcs = RpcGroup.make(
  Rpc.make("findUser", { payload: { email: Schema.String }, success: User, error: UserNotFound }),
  Rpc.make("getProfile", { payload: { userId: Schema.String }, success: Schema.Struct({ bio: Schema.String }) }),
  Rpc.make("listFriendIds", { payload: { userId: Schema.String }, success: Schema.Array(Schema.String) }),
  Rpc.make("findUserByHandle", { payload: { handle: Schema.String }, success: Schema.Option(User) }),
  Rpc.make("renameUser", { payload: { userId: Schema.String, name: Schema.String }, success: User }),
  Rpc.make("watchUsers", { success: User, stream: true }),
  OpenSession,
  Rpc.make("registerNotifications", {
    payload: { sink: NotificationSink.schema },
    success: Schema.Boolean,
    error: Schema.Union([Capability.CapabilityUnavailable, Capability.CapabilityTransportError])
  })
)
type Client = PipelineClient.Client<typeof AppRpcs>

export const selection = (rpc: Client, email: string) => Effect.gen(function*() {
  // snippet:selection:start
  const user = rpc.findUser({ email })

  const account = yield* Pipeline.all({
    user,
    profile: rpc.getProfile({ userId: user.id }),
    friendIds: rpc.listFriendIds({ userId: user.id })
  })
  // snippet:selection:end
  return account
})

export const arrays = (rpc: Client, userId: string) => Effect.gen(function*() {
  // snippet:map:start
  const friends = yield* Pipeline.map(
    rpc.listFriendIds({ userId }),
    (friendId) => ({
      id: friendId,
      profile: rpc.getProfile({ userId: friendId })
    })
  )
  // snippet:map:end
  return friends
})

export const optional = (rpc: Client, handle: string) => Effect.gen(function*() {
  // snippet:option:start
  const profile = yield* Pipeline.map(
    rpc.findUserByHandle({ handle }),
    (user) => rpc.getProfile({ userId: user.id })
  )
  // snippet:option:end
  return profile
})

export const mutation = (rpc: Client, userId: string, name: string) => Effect.gen(function*() {
  // snippet:phase:start
  const refreshed = yield* rpc.renameUser({ userId, name }).pipe(
    Pipeline.andThen((user) => ({
      user,
      profile: rpc.getProfile({ userId: user.id }),
      friendIds: rpc.listFriendIds({ userId })
    }))
  )
  // snippet:phase:end
  return refreshed
})

export const errors = (rpc: Client, email: string) => {
  // snippet:errors:start
  const maybeUser = rpc.findUser({ email }).pipe(
    Effect.catchTag("UserNotFound", () => Effect.succeed(null))
  )
  // snippet:errors:end
  return maybeUser
}

// snippet:client-service:start
class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof AppRpcs>
>()("app/AppClient") {}

const AppClientLive = PipelineClient.layerClientHttp(AppClient, AppRpcs, {
  url: "http://127.0.0.1:8787/rpc"
}).pipe(Layer.provide(RpcSerialization.layerJson))

const loadUser = Effect.gen(function*() {
  const rpc = yield* AppClient
  return yield* rpc.findUser({ email: "ada@example.com" })
}).pipe(Effect.provide(AppClientLive))
// snippet:client-service:end

export const headers = (rpc: Client, email: string, token: string) => Effect.gen(function*() {
  // snippet:headers:start
  const user = rpc.findUser({ email })
  const account = yield* Pipeline.all({
    user,
    profile: rpc.getProfile({ userId: user.id })
  }).pipe(RpcClient.withHeaders({ authorization: `Bearer ${token}` }))
  // snippet:headers:end
  return account
})

// snippet:websocket-routes:start
const Routes = Layer.merge(
  PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc" }),
  PipelineServer.layerWebSocket({ group: AppRpcs, path: "/rpc" })
)
// snippet:websocket-routes:end

// snippet:websocket:start
const watchUsers = Effect.scoped(Effect.gen(function*() {
  const rpc = yield* PipelineClient.makeWebSocket(AppRpcs, {
    url: "ws://127.0.0.1:8787/rpc"
  })

  yield* rpc.watchUsers().pipe(
    Stream.runForEach((user) => Effect.log("User changed", user.id))
  )
})).pipe(
  Effect.provide(RpcSerialization.layerJson),
  Effect.provide(Socket.layerWebSocketConstructorGlobal)
)
// snippet:websocket:end

// snippet:capability-handler:start
class CurrentUser extends Context.Service<CurrentUser, User>()("app/CurrentUser") {}

const openSession = Effect.gen(function*() {
  const user = yield* CurrentUser
  return yield* UserSession.fromHandlers({
    currentUser: () => Effect.succeed(user),
    greet: () => Effect.succeed(`Hello ${user.name}`)
  })
})
// snippet:capability-handler:end

export const capabilities = (rpc: Client) => Effect.gen(function*() {
  // snippet:capability-pipeline:start
  const session = rpc.openSession()
  const account = yield* Pipeline.all({
    user: session.currentUser(),
    greeting: session.greet()
  })
  // snippet:capability-pipeline:end
  return account
})

export const persistentCapability = (rpc: Client) => Effect.gen(function*() {
  // snippet:capability-persistent:start
  // rpc is a WebSocket client whose connection scope is still open.
  const session = yield* rpc.openSession()
  const user = yield* session.currentUser()
  yield* Capability.release(session)
  // snippet:capability-persistent:end
  return user
})

export const callbacks = (rpc: Client) => Effect.gen(function*() {
  // snippet:callback:start
  const sink = yield* NotificationSink.fromHandlers({
    notify: ({ message }) => Effect.log(message).pipe(Effect.as(true))
  })

  yield* rpc.registerNotifications({ sink })
  // snippet:callback:end
})

class Users extends Context.Service<Users, {
  readonly findMany: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<User>>
}>()("app/Users") {}

// snippet:batching:start
class UserNotFoundById extends Schema.TaggedError<UserNotFoundById>()("UserNotFoundById", { id: Schema.String }) {}

class GetUser extends Request.TaggedClass("GetUser")<
  { readonly id: string }, User, UserNotFoundById
> {}

const UserResolver = Effect.map(Users, (users) => RequestResolver.make<GetUser>((entries) => Effect.gen(function*() {
  const rows = yield* users.findMany(entries.map((entry) => entry.request.id))
  const byId = new Map(rows.map((user) => [user.id, user]))

  for (const entry of entries) {
    const user = byId.get(entry.request.id)
    entry.completeUnsafe(user === undefined
      ? Exit.fail(new UserNotFoundById({ id: entry.request.id }))
      : Exit.succeed(user))
  }
})))

// Construct this descriptor once, rather than inside each lookup.
const UserCache = RequestBatching.cache(UserResolver, { capacity: 1_024 })

const getUser = (id: string) => Effect.flatMap(
  UserCache,
  Cache.get(new GetUser({ id }))
)
// snippet:batching:end

// snippet:middleware:start
const TransactionalRoutes = PipelineServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  middleware: [
    PipelineTelemetry.make(),
    PipelineSql.transaction()
  ]
})
// snippet:middleware:end

export const committed = (user: User) => Effect.gen(function*() {
  // snippet:after-commit:start
  yield* PipelineSql.afterCommit(
    Effect.log("User renamed", user.id)
  )
  // snippet:after-commit:end
})

// Retain named examples for readers without executing network programs.
export { AppClient, AppClientLive, loadUser, Routes, watchUsers, UserSession, openSession, UserCache, getUser, TransactionalRoutes }

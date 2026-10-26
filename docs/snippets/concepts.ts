import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { AppRpcs } from "./overview.js"
import { AppRpcs as ExistingRpcs } from "./rpcs.js"

type Client = PipelineClient.Client<typeof AppRpcs>

const sequential = (rpc: Client, email: string) => Effect.gen(function*() {
  // narrative:sequential:start
  const user = yield* rpc.findUser({ email })
  const profile = yield* rpc.getProfile({ userId: user.id })

  return { name: user.name, bio: profile.bio }
  // narrative:sequential:end
})

const mapped = (rpc: Client, userId: string) => Effect.gen(function*() {
  // narrative:map:start
  const friends = yield* Pipeline.map(
    rpc.listFriendIds({ userId }),
    (friendId) => ({
      id: friendId,
      bio: rpc.getProfile({ userId: friendId }).bio
    })
  )
  // narrative:map:end
  return friends
})

const AppLive = ExistingRpcs.toLayer({
  findUser: () => Effect.succeed({ id: "ada", name: "Ada" }),
  getProfile: ({ userId }) => Effect.succeed({ bio: `Profile for ${userId}` })
})

// narrative:adoption:start
const PipelineRoutes = PipelineServer.layerHttp({
  group: ExistingRpcs,
  path: "/pipeline"
}).pipe(Layer.provide(AppLive))
// narrative:adoption:end

// narrative:services:start
class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof ExistingRpcs>
>()("app/AppClient") {}

const AppClientLive = PipelineClient.layerClientHttp(
  AppClient,
  ExistingRpcs,
  { url: "http://127.0.0.1:8787/pipeline" }
).pipe(Layer.provide(RpcSerialization.layerJson))
// narrative:services:end

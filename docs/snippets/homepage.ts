import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs } from "./overview.js"

class AppClient extends Context.Service<
  AppClient,
  PipelineClient.Client<typeof AppRpcs>
>()("homepage/AppClient") {}

const AppClientLive = PipelineClient.layerClientHttp(AppClient, AppRpcs, {
  url: "http://127.0.0.1:8787/rpc"
}).pipe(Layer.provide(RpcSerialization.layerJson))

type Client = PipelineClient.Client<typeof AppRpcs>

const effectIntegration = (email: string) => {
  // homepage:effect:start
  const loadUser = Effect.gen(function*() {
    const rpc = yield* AppClient
    return yield* rpc.findUser({ email }).pipe(
      Effect.catchTag(
        "UserNotFound",
        () => Effect.succeed(null)
      )
    )
  }).pipe(Effect.provide(AppClientLive))
  // homepage:effect:end
  return loadUser
}

const dependentCalls = (rpc: Client, email: string) => Effect.gen(function*() {
  // homepage:roundTrips:start
  const user = rpc.findUser({ email })

  const profile = yield* rpc.getProfile({
    userId: user.id
  })
  // homepage:roundTrips:end
  return profile
})

const querySelection = (rpc: Client, email: string) => Effect.gen(function*() {
  // homepage:query:start
  const user = rpc.findUser({ email })

  const account = yield* Pipeline.all({
    name: user.name,
    bio: rpc.getProfile({ userId: user.id }).bio
  })
  // homepage:query:end
  return account
})

const mutationSelection = (rpc: Client, userId: string, name: string) => Effect.gen(function*() {
  // homepage:mutation:start
  const account = yield* rpc.renameUser({ userId, name }).pipe(
    Pipeline.andThen((user) => ({
      name: user.name,
      bio: rpc.getProfile({ userId: user.id }).bio
    }))
  )
  // homepage:mutation:end
  return account
})

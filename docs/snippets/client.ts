import * as Effect from "effect/Effect"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs } from "./rpcs.js"

const program = Effect.gen(function*() {
  const rpc = yield* PipelineClient.makeHttp(AppRpcs, {
    url: "http://127.0.0.1:8787/rpc"
  })
  const user = rpc.findUser({ email: "ada@example.com" })
  return yield* Pipeline.all({
    user,
    profile: rpc.getProfile({ userId: user.id })
  })
}).pipe(Effect.provide(RpcSerialization.layerJson))

console.log(await Effect.runPromise(program))

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { createServer } from "node:http"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { AppRpcs } from "./rpcs.js"

const Handlers = AppRpcs.toLayer({
  findUser: () => Effect.succeed({ id: "ada", name: "Ada" }),
  getProfile: ({ userId }) => Effect.succeed({ bio: `Profile for ${userId}` })
})

const Routes = PipelineServer.layerHttp({ group: AppRpcs, path: "/rpc" }).pipe(
  Layer.provide(Handlers)
)

const Server = HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787, host: "127.0.0.1" })),
  Layer.provide(RpcSerialization.layerJson)
)

Layer.launch(Server).pipe(NodeRuntime.runMain)

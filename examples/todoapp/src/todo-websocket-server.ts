import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { createServer } from "node:http"
import { TodoLiveRoutes } from "./todo-live.js"

const ServerLive = HttpRouter.serve(TodoLiveRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  Layer.provide(RpcSerialization.layerJson)
)

Layer.launch(ServerLive).pipe(NodeRuntime.runMain)

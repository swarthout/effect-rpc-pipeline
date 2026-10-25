import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { createServer } from "node:http"
import { mkdirSync } from "node:fs"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import { makeBlogLayers } from "./layers.js"

mkdirSync(new URL("../../.data", import.meta.url), { recursive: true })
const filename = new URL("../../.data/blog.db", import.meta.url).pathname
const { RoutesLive } = makeBlogLayers(filename)

const ServerLive = HttpRouter.serve(RoutesLive).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8788 }))
)

Layer.launch(ServerLive as Layer.Layer<never, never, never>).pipe(NodeRuntime.runMain)

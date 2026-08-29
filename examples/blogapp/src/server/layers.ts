import { SqliteClient } from "@effect/sql-sqlite-node"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as PipelineSql from "effect-rpc-pipeline/Sql"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import { AppRpcs, HealthRpc, RegisterRpc, LoginRpc, RefreshRpc, ListPostsRpc, GetPostRpc, GetUserRpc, ListCommentsRpc, WatchPostRpc, type BlogEvent } from "../shared/contracts.js"
import { BlogDatabase, BlogDatabaseLive } from "./database.js"
import { assertAuthenticationCoverage, makeAuthLayers } from "./authentication.js"
import { makeApplicationLayer, makeTokenServiceLayer } from "./handlers/application.js"
import { hashPassword } from "./security.js"

const publicRpcs = [HealthRpc, RegisterRpc, LoginRpc, RefreshRpc, ListPostsRpc, GetPostRpc, GetUserRpc, ListCommentsRpc, WatchPostRpc] as const
const mutationTags = new Set([
  "register", "refresh", "createPost", "updatePost", "deletePost", "addComment", "deleteComment",
  "toggleUpvote", "setUserSuspended", "setUserRole", "moderatePost", "moderateComment"
])

const auditMiddleware = PipelineServer.makeMiddleware({
  invocation: (effect, context) => Effect.annotateLogs(effect, {
    rpc: context.rpc._tag,
    requestId: String(context.metadata.requestId),
    pipelineNode: context.nodeId
  })
})

export const makeBlogLayers = (filename: string) => {
  const SqlLive = SqliteClient.layer({ filename })
  const DatabaseLive = BlogDatabaseLive.pipe(Layer.provide(SqlLive))
  const TokenLive = makeTokenServiceLayer()
  const BaseLive = Layer.merge(DatabaseLive, TokenLive)

  const InitializeLive = Layer.effectDiscard(Effect.gen(function*() {
    yield* assertAuthenticationCoverage.pipe(Effect.orDie)
    const database = yield* BlogDatabase
    yield* database.migrate
    const existing = yield* database.findUserByUsername("admin").pipe(Effect.option)
    if (existing._tag === "None") {
      const passwordHash = yield* hashPassword("admin-password-change-me")
      yield* database.createUser({ username: "admin", displayName: "Pipeline Admin", passwordHash, role: "Admin" }).pipe(Effect.orDie)
    }
  })).pipe(Layer.provide(BaseLive))

  const ServicesLive = Layer.unwrap(Effect.gen(function*() {
    const changes = yield* PubSub.unbounded<BlogEvent>()
    const handlers = yield* makeApplicationLayer(changes)
    return Layer.mergeAll(handlers, makeAuthLayers)
  })).pipe(Layer.provide(BaseLive))

  const telemetry = PipelineTelemetry.make({ tracing: { invocations: true, spanPrefix: "BlogRpc" }, metrics: { prefix: "blog_rpc" } })
  const transaction = PipelineSql.transaction({ when: (context) => context.rpcTags.some((tag) => mutationTags.has(tag)) })
  const RoutesLive = Layer.merge(
    PipelineServer.layerHttp({
      group: AppRpcs,
      path: "/rpc",
      id: "pipeline-press",
      middleware: [telemetry, transaction, auditMiddleware],
      limits: { maxNodes: 250, maxMapItems: 100, maxInvocations: 500, concurrency: 32 }
    }),
    PipelineServer.layerWebSocket({
      group: AppRpcs,
      path: "/rpc",
      id: "pipeline-press",
      middleware: [telemetry, transaction, auditMiddleware],
      limits: { maxNodes: 250, maxMapItems: 100, maxInvocations: 500, concurrency: 32 }
    })
  ).pipe(
    Layer.provide(ServicesLive),
    Layer.provide(BaseLive),
    Layer.provide(SqlLive),
    Layer.provide(RpcSerialization.layerJson)
  )

  return { RoutesLive: Layer.merge(RoutesLive, InitializeLive), BaseLive, InitializeLive }
}

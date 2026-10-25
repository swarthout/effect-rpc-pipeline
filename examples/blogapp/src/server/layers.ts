import { SqliteClient } from "@effect/sql-sqlite-node"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as PipelineSql from "effect-rpc-pipeline/Sql"
import * as PipelineTelemetry from "effect-rpc-pipeline/Telemetry"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { AppRpcs, HealthRpc, RegisterRpc, LoginRpc, RefreshRpc, ListPostsRpc, GetPostRpc, GetUserRpc, ListCommentsRpc, WatchPostRpc, type BlogEvent } from "../shared/contracts.js"
import { BlogDatabase, BlogDatabaseLive } from "./database.js"
import { assertAuthenticationCoverage, makeAuthLayers } from "./authentication.js"
import { makeApplicationLayer, makeTokenServiceLayer } from "./handlers/application.js"
import { hashPassword } from "./security.js"
import { SessionRoutesLive } from "./session-routes.js"
import { SessionServiceLive } from "./sessions.js"
import { BlogLookupsLive } from "./lookups.js"
import { AppPipelineClient, AuthenticatedClientLive, BlogClient, type BlogClientApi, makeFacade } from "../client/blog-client.js"

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
  const LookupsLive = BlogLookupsLive.pipe(Layer.provide(DatabaseLive))
  const SessionsLive = SessionServiceLive.pipe(Layer.provide(BaseLive))

  const InitializeLive = Layer.effectDiscard(Effect.gen(function*() {
    yield* assertAuthenticationCoverage.pipe(Effect.orDie)
    const database = yield* BlogDatabase
    yield* database.migrate
    const existing = yield* database.findUserByUsername("admin").pipe(Effect.option)
    if (existing._tag === "None") {
      const adminPassword = process.env.BLOG_ADMIN_PASSWORD ?? "admin-password-change-me"
      if (process.env.NODE_ENV === "production" && (process.env.BLOG_ADMIN_PASSWORD === undefined || adminPassword.length < 16)) {
        return yield* Effect.die(new Error("Initial production setup requires BLOG_ADMIN_PASSWORD with at least 16 characters"))
      }
      const passwordHash = yield* hashPassword(adminPassword)
      yield* database.createUser({ username: "admin", displayName: "Pipeline Admin", passwordHash, role: "Admin" }).pipe(Effect.orDie)
    }
  })).pipe(Layer.provide(BaseLive))

  const ServicesLive = Layer.unwrap(Effect.gen(function*() {
    const changes = yield* PubSub.unbounded<BlogEvent>()
    const handlers = yield* makeApplicationLayer(changes)
    return Layer.mergeAll(handlers, makeAuthLayers)
  })).pipe(Layer.provide(LookupsLive), Layer.provide(SessionsLive), Layer.provide(BaseLive))

  const telemetry = PipelineTelemetry.make({ tracing: { invocations: true, spanPrefix: "BlogRpc" }, metrics: { prefix: "blog_rpc" } })
  const transaction = PipelineSql.transaction({ when: (context) => context.rpcTags.some((tag) => mutationTags.has(tag)) })
  const pipelineMiddleware = [telemetry, transaction, auditMiddleware] as const
  const RpcRoutesLive = Layer.merge(
    PipelineServer.layerHttp({
      group: AppRpcs,
      path: "/rpc",
      id: "pipeline-press",
      middleware: pipelineMiddleware,
      limits: { maxNodes: 250, maxMapItems: 100, maxInvocations: 500, concurrency: 500 }
    }),
    PipelineServer.layerWebSocket({
      group: AppRpcs,
      path: "/rpc",
      id: "pipeline-press",
      middleware: pipelineMiddleware,
      limits: { maxNodes: 250, maxMapItems: 100, maxInvocations: 500, concurrency: 500 }
    })
  ).pipe(
    Layer.provide(ServicesLive),
    Layer.provide(BaseLive),
    Layer.provide(SqlLive),
    Layer.provide(RpcSerialization.layerJson)
  )

  const RoutesLive = Layer.merge(
    RpcRoutesLive,
    SessionRoutesLive.pipe(Layer.provide(SessionsLive))
  )

  const InProcessPipelineLive = PipelineClient.layerClientInProcess(AppPipelineClient, AppRpcs, {
    id: "pipeline-press",
    middleware: pipelineMiddleware,
    limits: { maxNodes: 250, maxMapItems: 100, maxInvocations: 500, concurrency: 500 }
  }).pipe(
    Layer.provide(AuthenticatedClientLive),
    Layer.provide(ServicesLive),
    Layer.provide(makeAuthLayers.pipe(Layer.provide(LookupsLive), Layer.provide(BaseLive))),
    Layer.provide(BaseLive),
    Layer.provide(SqlLive)
  )
  const InProcessClientLive = Layer.effect(
    BlogClient,
    Effect.map(AppPipelineClient, (rpc) => makeFacade(rpc) as unknown as BlogClientApi)
  ).pipe(Layer.provide(InProcessPipelineLive))

  return {
    RoutesLive: Layer.merge(RoutesLive, InitializeLive),
    InProcessClientLive: Layer.merge(InProcessClientLive, InitializeLive),
    BaseLive,
    SessionsLive,
    LookupsLive,
    InitializeLive
  }
}

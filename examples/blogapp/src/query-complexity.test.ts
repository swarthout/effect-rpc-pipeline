// @vitest-environment node

import { NodeHttpServer } from "@effect/platform-node"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"
import * as Socket from "effect/unstable/socket/Socket"
import { describe, expect, it } from "vitest"
import { BlogClient, layerWebSocketClient, makeHttpClient, withAccessToken } from "./client/blog-client.js"
import { BlogDatabase } from "./server/database.js"
import { makeBlogLayers } from "./server/layers.js"
import { AppRpcs, NotificationSink, type Post } from "./shared/contracts.js"
import {
  assertAllMethodsObserved,
  assertAllRpcsObserved,
  assertConstantDatabaseWork,
  makeQueryTraceCollector,
  type QueryReport,
  QueryComplexityError,
  trackMethodCalls,
  traceDatabaseWork
} from "./test-support/query-complexity.js"

// Start at two so every fixture contains both a repeated owner lookup and a
// distinct related author. This keeps the data shape stable while cardinality
// grows all the way to the application's configured map limit.
const fixtureSizes = [2, 16, 100] as const

type ScenarioName =
  | "health"
  | "feed"
  | "publicArticle"
  | "viewerArticle"
  | "me"
  | "myPosts"
  | "register"
  | "login"
  | "refresh"
  | "createPost"
  | "updatePost"
  | "addComment"
  | "toggleUpvote"
  | "deleteComment"
  | "adminSummary"
  | "setRole"
  | "setSuspended"
  | "moderatePost"
  | "moderateComment"
  | "deletePost"
  | "authorCapability"

type FixtureReport = {
  readonly reports: Record<ScenarioName, QueryReport>
  readonly facade: object
  readonly observedMethods: ReadonlySet<string>
}

type ScenarioReports = FixtureReport["reports"]

const makeFixtureReports = (size: number): Effect.Effect<FixtureReport, unknown> => Effect.scoped(Effect.gen(function*() {
  const filename = join(mkdtempSync(join(tmpdir(), `pipeline-blog-complexity-${size}-`)), "blog.db")
  const layers = makeBlogLayers(filename)
  const context = yield* Layer.build(Layer.merge(layers.InProcessClientLive, layers.BaseLive))
  const facade = Context.get(context, BlogClient)
  const observedMethods = new Set<string>()
  const client = trackMethodCalls(facade, observedMethods)
  const database = Context.get(context, BlogDatabase)

  const ownerSession = yield* client.register({
    username: `owner-${size}`,
    displayName: "Complexity Owner",
    password: "a sufficiently strong password"
  })
  const adminSession = yield* client.login({ username: "admin", password: "admin-password-change-me" })
  const target = yield* database.createPost(ownerSession.user.id, {
    title: `Complexity target ${size}`,
    excerpt: "A post used to measure query complexity.",
    body: "This article has enough content to satisfy validation while its related rows grow.",
    tags: ["complexity"],
    status: "Published"
  })
  const ownerComment = yield* database.createComment(target.id, ownerSession.user.id, "An owner comment")
  const moderationUser = yield* database.createUser({
    username: `moderation-${size}`,
    displayName: "Moderation Target",
    passwordHash: "test-only-password-hash",
    role: "Author"
  })
  for (let index = 0; index < size - 1; index++) {
    const user = yield* database.createUser({
      username: `reader-${size}-${index}`,
      displayName: `Reader ${index}`,
      passwordHash: "test-only-password-hash",
      role: "Author"
    })
    yield* database.createPost(user.id, {
      title: `Fixture post ${size} ${index}`,
      excerpt: "A fixture post with a distinct author.",
      body: "Fixture content is deliberately long enough for the blog validation rules.",
      tags: ["fixture"],
      status: "Published"
    })
    yield* database.createComment(target.id, user.id, `Fixture comment ${index}`)
  }

  const reports = {} as ScenarioReports
  const measure = <A, E, R>(name: ScenarioName, effect: Effect.Effect<A, E, R>) => traceDatabaseWork(effect).pipe(
    Effect.tap(({ report }) => Effect.sync(() => { reports[name] = report })),
    Effect.map(({ value }) => value),
    Effect.catchCause((cause) => Effect.die(new Error(`${name} failed:\n${Cause.pretty(cause)}`)))
  )
  const asOwner = <A, E, R>(effect: Effect.Effect<A, E, R>) => withAccessToken(effect, ownerSession.accessToken)
  const asAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) => withAccessToken(effect, adminSession.accessToken)

  yield* measure("health", client.health())
  yield* measure("feed", client.feed())
  yield* measure("publicArticle", client.post(target.slug))
  yield* measure("viewerArticle", asOwner(client.viewerPost(target.slug)))
  yield* measure("me", asOwner(client.me()))
  yield* measure("myPosts", asOwner(client.myPosts()))

  const measuredSession = yield* measure("register", client.register({
    username: `measured-${size}`,
    displayName: "Measured User",
    password: "another sufficiently strong password"
  }))
  yield* measure("login", client.login({ username: `measured-${size}`, password: "another sufficiently strong password" }))
  yield* measure("refresh", client.refresh(measuredSession.refreshToken))

  const created = yield* measure("createPost", asOwner(client.createPost({
    title: `Measured mutation ${size}`,
    excerpt: "A measured post mutation.",
    body: "This mutation body is long enough to pass validation consistently.",
    tags: ["measured"],
    status: "Draft"
  })))
  yield* measure("updatePost", asOwner(client.updatePost({
    ...created.post,
    title: `Updated measured mutation ${size}`,
    publishedAt: undefined
  } as unknown as Parameters<typeof client.updatePost>[0])))
  const commentsAfterMutation = yield* measure("addComment", asOwner(client.comment(target.id, "A measured comment")))
  const measuredComment = commentsAfterMutation.find((comment) => comment.body === "A measured comment")!
  yield* measure("toggleUpvote", asOwner(client.toggleUpvote(target.id)))
  yield* measure("deleteComment", asOwner(client.deleteComment(ownerComment.id, target.id)))

  yield* measure("adminSummary", asAdmin(client.admin()))
  yield* measure("setRole", asAdmin(client.setRole(moderationUser.id, "Reader")))
  yield* measure("setSuspended", asAdmin(client.setSuspended(moderationUser.id, true)))
  yield* measure("moderatePost", asAdmin(client.moderatePost(target.id, "Draft")))
  yield* measure("moderateComment", asAdmin(client.moderateComment(measuredComment.id)))
  yield* measure("deletePost", asOwner(client.deletePost(created.post.id)))

  const authorSession = client.openAuthorSession(target.id) as unknown as {
    readonly publish: () => Effect.Effect<Post, unknown>
  }
  yield* measure("authorCapability", asOwner(authorSession.publish()))

  return { reports, facade, observedMethods }
}))

const makeWebSocketReport = (): Effect.Effect<{
  readonly report: QueryReport
  readonly facade: object
  readonly observedMethods: ReadonlySet<string>
}, unknown> => {
  const collector = makeQueryTraceCollector()
  return Effect.withTracer(Effect.scoped(Effect.gen(function*() {
    const filename = join(mkdtempSync(join(tmpdir(), "pipeline-blog-complexity-ws-")), "blog.db")
    const { RoutesLive } = makeBlogLayers(filename)
    const ServerLive = HttpRouter.serve(RoutesLive, { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 }))
    )
    const context = yield* Layer.build(ServerLive as Layer.Layer<HttpServer.HttpServer, never, never>)
    const server = Context.get(context, HttpServer.HttpServer)
    if (server.address._tag !== "TcpAddress") return yield* Effect.die("Expected TCP test server")
    const http = `http://127.0.0.1:${server.address.port}/rpc`
    const websocket = `ws://127.0.0.1:${server.address.port}/rpc`

    const publicClient = yield* makeHttpClient(http)
    const session = yield* publicClient.register({
      username: "complexity-websocket",
      displayName: "Complexity WebSocket",
      password: "a sufficiently strong websocket password"
    })
    const author = yield* makeHttpClient(http, session.accessToken)
    const created = yield* author.createPost({
      title: "Complexity over WebSocket",
      excerpt: "Exercise streams and callbacks.",
      body: "This post exists to cover the non-finite WebSocket API boundaries.",
      tags: ["complexity"],
      status: "Draft"
    })
    collector.reset()

    return yield* Effect.gen(function*() {
      const facade = yield* BlogClient
      const observedMethods = new Set<string>()
      const client = trackMethodCalls(facade, observedMethods)
      const events = yield* Queue.unbounded<unknown>()
      const streamFiber = yield* client.watchPost(created.post.id).pipe(
        Stream.take(1),
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      )
      const authorSession = yield* client.openAuthorSession(created.post.id)
      yield* authorSession.publish()
      yield* Queue.take(events).pipe(Effect.timeout("3 seconds"), Effect.orDie)
      yield* Fiber.interrupt(streamFiber)

      const notifications = yield* Queue.unbounded<unknown>()
      const sink = yield* NotificationSink.fromHandlers({
        notify: ({ event }) => Queue.offer(notifications, event).pipe(Effect.as(true))
      })
      yield* client.registerNotificationSink(sink)
      yield* Queue.take(notifications).pipe(Effect.timeout("3 seconds"), Effect.orDie)
      return { report: collector.report(), facade, observedMethods }
    }).pipe(
      (effect) => withAccessToken(effect, session.accessToken),
      Effect.provide(layerWebSocketClient(websocket)),
      Effect.provide(Socket.layerWebSocketConstructorGlobal)
    )
  })), collector.tracer)
}

describe("query complexity infrastructure", () => {
  it("observes native Effect SQL and pipeline spans without application hooks", async () => {
    const report = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const filename = join(mkdtempSync(join(tmpdir(), "pipeline-blog-complexity-smoke-")), "blog.db")
      const context = yield* Layer.build(makeBlogLayers(filename).InProcessClientLive)
      const client = Context.get(context, BlogClient)
      return (yield* traceDatabaseWork(client.feed())).report
    })))

    expect(report.rpcTags).toContain("listPosts")
    expect(report.reads).toBeGreaterThan(0)
    expect(report.statements.some(({ fingerprint }) => fingerprint.includes("FROM posts"))).toBe(true)
  })

  it("rejects work whose query count grows with fixture size", async () => {
    const sample = (size: number) => Effect.gen(function*() {
      for (let index = 0; index < size; index++) {
        yield* Effect.void.pipe(Effect.withSpan("sql.execute", {
          attributes: { "db.query.text": "SELECT * FROM users WHERE id = ?" }
        }))
      }
    }).pipe(traceDatabaseWork, Effect.map(({ report }) => ({ size, report })))
    const samples = await Effect.runPromise(Effect.all([sample(1), sample(8)]))

    expect(() => assertConstantDatabaseWork("synthetic N+1", samples)).toThrow(QueryComplexityError)
  })

  it("accepts one bulk query regardless of input cardinality", async () => {
    const sample = (size: number) => Effect.void.pipe(
      Effect.withSpan("sql.execute", {
        attributes: { "db.query.text": `SELECT * FROM users WHERE id IN (${Array.from({ length: size }, () => "?").join(",")})` }
      }),
      traceDatabaseWork,
      Effect.map(({ report }) => ({ size, report }))
    )
    const samples = await Effect.runPromise(Effect.all([sample(1), sample(8), sample(32)]))

    expect(() => assertConstantDatabaseWork("synthetic bulk lookup", samples, { maxReads: 1 })).not.toThrow()
  })

  it("keeps every blog query and mutation constant as related data grows", async () => {
    const samples = await Effect.runPromise(Effect.forEach(
      fixtureSizes,
      (size) => Effect.map(makeFixtureReports(size), (fixture) => ({ size, ...fixture })),
      { concurrency: 1 }
    ))

    const scenarioNames = Object.keys(samples[0]!.reports) as Array<ScenarioName>
    for (const name of scenarioNames) {
      assertConstantDatabaseWork(name, samples.map(({ size, reports }) => ({ size, report: reports[name] })), {
        maxReads: 12,
        maxWrites: 3
      })
    }
    const websocket = await Effect.runPromise(makeWebSocketReport())
    const reports = [...samples.flatMap(({ reports }) => Object.values(reports)), websocket.report]
    assertAllRpcsObserved(AppRpcs, reports)
    const observedMethods = new Set([
      ...samples.flatMap(({ observedMethods }) => [...observedMethods]),
      ...websocket.observedMethods
    ])
    assertAllMethodsObserved(samples[0]!.facade, observedMethods)
  }, 30_000)
})

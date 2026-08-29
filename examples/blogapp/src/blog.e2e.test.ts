// @vitest-environment node

import { NodeHttpServer } from "@effect/platform-node"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Socket from "effect/unstable/socket/Socket"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { describe, expect, it } from "vitest"
import { AppPipelineClient, BlogClient, layerWebSocketClient, makeHttpClient, withAccessToken } from "./client/blog-client.js"
import { AppRpcs, NotificationSink } from "./shared/contracts.js"
import { makeBlogLayers } from "./server/layers.js"

const testServer = <A, E, R>(run: (urls: { readonly http: string; readonly websocket: string }) => Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
  const filename = join(mkdtempSync(join(tmpdir(), "pipeline-blog-")), "blog.db")
  const { RoutesLive } = makeBlogLayers(filename)
  const ServerLive = HttpRouter.serve(RoutesLive, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 }))
  )
  const context = yield* Layer.build(ServerLive as Layer.Layer<HttpServer.HttpServer, never, never>)
  const server = Context.get(context, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") return yield* Effect.die("Expected TCP test server")
  return yield* run({
    http: `http://127.0.0.1:${server.address.port}/rpc`,
    websocket: `ws://127.0.0.1:${server.address.port}/rpc`
  })
}))

describe("Pipeline Press end to end", () => {
  const within = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) => effect.pipe(
    Effect.timeout("3 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.die(`${label} timed out`))
  )
  it("supports public reading and the complete authenticated blog workflow", async () => {
    const result = await Effect.runPromise(testServer(({ http }) => Effect.gen(function*() {
      const publicClient = yield* makeHttpClient(http)
      expect(yield* publicClient.health()).toBe("ok")
      expect(yield* publicClient.feed()).toEqual([])
      const unauthorized = yield* publicClient.comment("missing", "No anonymous comments").pipe(Effect.flip)
      expect(unauthorized).toMatchObject({ _tag: "Unauthorized" })

      const adaSession = yield* publicClient.register({ username: "ada", displayName: "Ada Lovelace", password: "correct horse battery" })
      const ada = yield* makeHttpClient(http, adaSession.accessToken)
      const created = yield* ada.createPost({
        title: "Pipelines as a query language",
        excerpt: "Compose the response you need.",
        body: "A pipeline lets clients combine dependent work while the server retains typed boundaries.",
        tags: ["effect", "rpc"],
        status: "Published"
      })
      const post = created.post
      const updated = yield* ada.updatePost({
        id: post.id, title: "Pipelines as a query language", excerpt: "Compose exactly the response you need.",
        body: post.body, tags: post.tags, status: "Published"
      })

      const publicFeed = yield* publicClient.feed("query")
      const publicDetails = yield* publicClient.post(post.slug)
      const graceSession = yield* publicClient.register({ username: "grace", displayName: "Grace Hopper", password: "another strong password" })
      const grace = yield* makeHttpClient(http, graceSession.accessToken)
      yield* grace.comment(post.id, "This keeps the transport surface small.")
      const voted = yield* grace.toggleUpvote(post.id)
      const graceDetails = yield* grace.viewerPost(post.slug)
      const comment = graceDetails.comments.at(0)!
      yield* grace.deleteComment(comment.comment.id, post.id)
      const remainingComments = yield* grace.comment(post.id, "This one is for the moderation queue.")

      const forbiddenEdit = yield* grace.updatePost({
        id: post.id, title: "Stolen title", excerpt: post.excerpt, body: post.body,
        tags: post.tags, status: "Published"
      }).pipe(Effect.flip)

      const refreshed = yield* publicClient.refresh(adaSession.refreshToken)
      const replay = yield* publicClient.refresh(adaSession.refreshToken).pipe(Effect.flip)
      const adminSession = yield* publicClient.login({ username: "admin", password: "admin-password-change-me" })
      const admin = yield* makeHttpClient(http, adminSession.accessToken)
      const summary = yield* admin.admin()
      const roleChanged = yield* admin.setRole(graceSession.user.id, "Reader")
      const moderatedComment = yield* admin.moderateComment(remainingComments.at(0)!.id)
      const unpublished = yield* admin.moderatePost(post.id, "Draft")
      const republished = yield* admin.moderatePost(post.id, "Published")
      const suspended = yield* admin.setSuspended(graceSession.user.id, true)
      const suspendedLogin = yield* publicClient.login({ username: "grace", password: "another strong password" }).pipe(Effect.flip)

      return { updated, publicFeed, publicDetails, voted, graceDetails, forbiddenEdit, refreshed, replay, summary, roleChanged, moderatedComment, unpublished, republished, suspended, suspendedLogin }
    })) as Effect.Effect<any, any, never>)

    expect(result.publicFeed).toHaveLength(1)
    expect(result.updated.post.excerpt).toContain("exactly")
    expect(result.publicDetails.viewerUpvoted._tag).toBe("None")
    expect(result.voted.upvoted).toBe(true)
    expect(result.graceDetails.viewerUpvoted).toMatchObject({ _tag: "Some", value: true })
    expect(result.forbiddenEdit).toMatchObject({ _tag: "Forbidden" })
    expect(result.refreshed.accessToken).not.toBe("")
    expect(result.replay).toMatchObject({ _tag: "Unauthorized" })
    expect(result.summary.users).toHaveLength(3)
    expect(result.roleChanged.users.find((user: any) => user.username === "grace").role).toBe("Reader")
    expect(result.moderatedComment.comments).toHaveLength(0)
    expect(result.unpublished.posts.find((post: any) => post.id === result.updated.post.id).status).toBe("Draft")
    expect(result.republished.posts.find((post: any) => post.id === result.updated.post.id).status).toBe("Published")
    expect(result.suspended.suspendedUsers).toBe(1)
    expect(result.suspendedLogin).toMatchObject({ _tag: "Suspended" })
  })

  it("keeps rotating refresh tokens in secure browser cookies", async () => {
    await Effect.runPromise(testServer(({ http }) => Effect.promise(async () => {
      const origin = http.slice(0, -"/rpc".length)
      const request = (path: string, options: RequestInit = {}) => fetch(`${origin}${path}`, {
        method: "POST",
        headers: { origin, ...(options.headers ?? {}) },
        ...options
      })
      const registered = await request("/session/register", {
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ username: "browser", displayName: "Browser User", password: "a browser-safe password" })
      })
      const body = await registered.json() as Record<string, unknown>
      expect(registered.status, JSON.stringify(body)).toBe(200)
      expect(body.accessToken).toEqual(expect.any(String))
      expect(body).not.toHaveProperty("refreshToken")
      const firstCookie = registered.headers.get("set-cookie")!
      expect(firstCookie).toContain("HttpOnly")
      expect(firstCookie).toContain("Secure")
      expect(firstCookie).toContain("SameSite=Lax")

      const refreshed = await request("/session/refresh", { headers: { origin, cookie: firstCookie.split(";", 1)[0]! } })
      expect(refreshed.status).toBe(200)
      const secondCookie = refreshed.headers.get("set-cookie")!
      expect(secondCookie).not.toBe(firstCookie)

      const replay = await request("/session/refresh", { headers: { origin, cookie: firstCookie.split(";", 1)[0]! } })
      expect(replay.status).toBe(401)
      const crossOrigin = await fetch(`${origin}/session/refresh`, {
        method: "POST",
        headers: { origin: "https://attacker.example", cookie: secondCookie.split(";", 1)[0]! }
      })
      expect(crossOrigin.status).toBe(403)

      const logout = await request("/session/logout", { headers: { origin, cookie: secondCookie.split(";", 1)[0]! } })
      expect(logout.status).toBe(204)
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0")
      const afterLogout = await request("/session/refresh", { headers: { origin, cookie: secondCookie.split(";", 1)[0]! } })
      expect(afterLogout.status).toBe(401)
    })))
  })

  it("runs streams, server capabilities, client callbacks, and pipelines over one WebSocket", async () => {
    const result = await Effect.runPromise(testServer(({ http, websocket }) => Effect.gen(function*() {
      const publicClient = yield* makeHttpClient(http)
      const session = yield* publicClient.register({ username: "linus", displayName: "Linus Torvalds", password: "distributed source control" })
      const httpClient = yield* makeHttpClient(http, session.accessToken)
      const created = yield* httpClient.createPost({
        title: "Live collaboration",
        excerpt: "Streams and capabilities share a connection.",
        body: "The same Effect RPC WebSocket carries ordinary calls, streams, and callbacks.",
        tags: ["websocket"],
        status: "Draft"
      })

      return yield* Effect.gen(function*() {
        const client = yield* BlogClient
        const rpc = yield* AppPipelineClient
        const events = yield* Queue.unbounded<unknown>()
        const streamFiber = yield* client.watchPost(created.post.id).pipe(
          Stream.take(1),
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped
        )

        const authorSession = yield* client.openAuthorSession(created.post.id)
        const published = yield* authorSession.publish()
        const event = yield* within("post event", Queue.take(events))
        yield* Fiber.interrupt(streamFiber)

        const notifications = yield* Queue.unbounded<unknown>()
        const sink = yield* NotificationSink.fromHandlers({
          notify: ({ event }) => Queue.offer(notifications, event).pipe(Effect.as(true))
        })
        const callbackAccepted = yield* client.registerNotificationSink(sink)
        const notification = yield* within("client callback", Queue.take(notifications))

        const combined = yield* Pipeline.all({
          current: rpc.me(),
          drafts: rpc.myPosts(),
          author: rpc.getUser({ id: published.authorId })
        })
        return { published, event, callbackAccepted, notification, combined }
      }).pipe(
        (effect) => withAccessToken(effect, session.accessToken),
        Effect.provide(layerWebSocketClient(websocket)),
        Effect.provide(Socket.layerWebSocketConstructorGlobal)
      )
    })) as Effect.Effect<any, any, never>)

    expect(result.published.status).toBe("Published")
    expect(result.event).toMatchObject({ kind: "PostChanged" })
    expect(result.callbackAccepted).toBe(true)
    expect(result.notification).toMatchObject({ postId: "welcome" })
    expect(result.combined.current.username).toBe("linus")
    expect(result.combined.author.displayName).toBe("Linus Torvalds")
  })
})

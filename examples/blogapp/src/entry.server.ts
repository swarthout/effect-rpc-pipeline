import { mkdirSync } from "node:fs"
import { Effect, ManagedRuntime, Option } from "effect"
import { Server } from "foldkit/experimental"
import { BlogClient } from "./client/blog-client.js"
import { makeBlogLayers } from "./server/layers.js"
import { Flags, init, view } from "./web/application.js"

mkdirSync(new URL("../.data", import.meta.url), { recursive: true })
const filename = new URL("../.data/blog.db", import.meta.url).pathname
const SsrRuntime = ManagedRuntime.make(makeBlogLayers(filename).InProcessClientLive)

export const loadFlags = (request: Request, client: BlogClient["Service"]): Effect.Effect<Flags, unknown> => Effect.gen(function*() {
  const pathname = new URL(request.url).pathname
  if (pathname.startsWith("/posts/")) {
    const slug = decodeURIComponent(pathname.slice("/posts/".length))
    return yield* client.post(slug).pipe(
      Effect.map((post) => ({ page: "Post" as const, feed: [], maybePost: Option.some(post) })),
      Effect.catchTag("NotFound", () => Effect.succeed({ page: "NotFound" as const, feed: [], maybePost: Option.none() }))
    )
  }
  return { page: "Feed" as const, feed: yield* client.feed(), maybePost: Option.none() }
})

const flagsForRequest = (request: Request): Effect.Effect<Flags> => Effect.promise(() => SsrRuntime.runPromise(
  Effect.flatMap(BlogClient, (client) => loadFlags(request, client))
)).pipe(Effect.orDie)

export const renderPage = (request: Request): Promise<Server.EntryResult> => Effect.runPromise(
  Effect.gen(function*() {
    const flags = yield* flagsForRequest(request)
    const rendered = yield* Server.renderToString(
      { Flags, init, view },
      { flags, buildId: import.meta.env.FOLDKIT_BUILD_ID }
    )
    return Server.Rendered(rendered, {
      status: flags.page === "NotFound" ? 404 : 200,
      headers: {
        "cache-control": request.headers.has("authorization") ? "private, no-store" : "public, max-age=30",
        "content-security-policy": "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin"
      }
    })
  })
)

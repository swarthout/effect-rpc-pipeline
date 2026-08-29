import { Effect } from "effect"
import { Server } from "foldkit/experimental"
import { init, view } from "./web/application.js"

export const renderPage = (request: Request): Promise<Server.EntryResult> => Effect.runPromise(
  Effect.gen(function*() {
    const rendered = yield* Server.renderToString(
      { init, view },
      { buildId: import.meta.env.FOLDKIT_BUILD_ID }
    )
    return Server.Rendered(rendered, {
      headers: {
        "cache-control": request.headers.has("authorization") ? "private, no-store" : "public, max-age=30",
        "content-security-policy": "default-src 'self'; connect-src 'self' ws:; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin"
      }
    })
  })
)

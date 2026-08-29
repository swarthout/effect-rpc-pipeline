// @vitest-environment node

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Server } from "foldkit/experimental"
import { describe, expect, it } from "vitest"
import { BlogClient, withAccessToken } from "./client/blog-client.js"
import { loadFlags } from "./entry.server.js"
import { makeBlogLayers } from "./server/layers.js"
import { Flags, init, view } from "./web/application.js"

describe("Pipeline Press SSR", () => {
  it("loads public pipeline data in process and hands it to Foldkit hydration", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const filename = join(mkdtempSync(join(tmpdir(), "pipeline-blog-ssr-")), "blog.db")
      const context = yield* Layer.build(makeBlogLayers(filename).InProcessClientLive)
      const client = Context.get(context, BlogClient)
      const session = yield* client.register({
        username: "ssr-author",
        displayName: "SSR Author",
        password: "a sufficiently strong password"
      })
      const created = yield* withAccessToken(client.createPost({
        title: "Rendered through the pipeline",
        excerpt: "The server runs the same dependency graph before rendering.",
        body: "Foldkit receives typed flags containing the complete public article and its author.",
        tags: ["ssr", "effect"],
        status: "Published"
      }), session.accessToken)
      const flags = yield* loadFlags(new Request(`http://localhost/posts/${created.post.slug}`), client)
      const rendered = yield* Server.renderToString(
        { Flags, init, view },
        { flags, buildId: "ssr-test" }
      )
      const missing = yield* loadFlags(new Request("http://localhost/posts/missing"), client)
      return { flags, html: rendered.html, missing }
    })))

    expect(result.flags.page).toBe("Post")
    expect(result.html).toContain("Rendered through the pipeline")
    expect(result.html).toContain("SSR Author")
    expect(result.html).toContain("data-foldkit-flags")
    expect(result.missing.page).toBe("NotFound")
  })
})

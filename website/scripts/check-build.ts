import assert from "node:assert/strict"
import { readFile, access } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import data from "../src/generated/content.json"

const directory = fileURLToPath(new URL("../dist/", import.meta.url))
const origin = process.env.SITE_ORIGIN ?? "https://swarthout.github.io"
const pages = ["", ...data.pages.map((page) => page.slug)]
const documents = new Map<string, string>()
for (const slug of pages) {
  const html = await readFile(resolve(directory, slug, "index.html"), "utf8")
  const url = `${data.base}${slug ? `${slug}/` : ""}`
  documents.set(url, html)
  assert.match(html, /<h1[ >]/, `Missing prerendered content at ${url}`)
  assert.match(html, /name="description"/, `Missing description at ${url}`)
  assert.ok(html.includes(`href="${origin}${url}"`), `Missing canonical at ${url}`)
  assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1, `Duplicate canonical at ${url}`)
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, `Duplicate IDs at ${url}`)
}

let linkCount = 0
for (const [path, html] of documents) {
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = new URL(match[1].replaceAll("&amp;", "&"), `${origin}${path}`)
    if (target.origin !== origin) {
      continue
    }
    assert.ok(
      target.pathname.startsWith(data.base),
      `Link escapes GitHub Pages base: ${path} → ${target.pathname}`,
    )
    const document = documents.get(target.pathname)
    if (document) {
      if (target.hash) {
        assert.ok(
          document.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`),
          `Broken anchor: ${path} → ${target.pathname}${target.hash}`,
        )
      }
    } else {
      const output = resolve(directory, target.pathname.slice(data.base.length))
      assert.ok(output.startsWith(directory), `Invalid asset path ${output}`)
      await access(output).catch(() => {
        throw new Error(`Missing local target: ${path} → ${target.pathname}`)
      })
    }
    linkCount++
  }
}
const notFound = await readFile(resolve(directory, "404.html"), "utf8")
assert.match(notFound, /This path ends here/)
assert.match(notFound, /name="robots" content="noindex"/)
await access(resolve(directory, ".nojekyll"))
const sitemap = await readFile(resolve(directory, "sitemap.xml"), "utf8")
assert.equal([...sitemap.matchAll(/<loc>/g)].length, pages.length)
console.log(
  `Verified ${documents.size} static pages, ${linkCount} local links/assets, anchors, metadata, sitemap, and 404`,
)

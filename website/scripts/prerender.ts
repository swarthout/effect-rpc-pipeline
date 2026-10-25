import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { Server } from "foldkit/experimental"
import data from "../src/generated/content.json"

const root = fileURLToPath(new URL("../", import.meta.url))
const directory = resolve(root, "dist")
const template = await readFile(resolve(directory, "index.html"), "utf8")
if (!template.includes('<div id="root"></div>')) {
  throw new Error("Run the client build before prerendering")
}
const base = data.base
const origin = process.env.SITE_ORIGIN ?? "https://swarthout.github.io"
const entry: { renderPage: (request: Request) => Promise<Server.EntryResult> } = await import(
  pathToFileURL(resolve(root, "dist-server/entry.server.js")).href
)
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
const urls = ["", ...data.pages.map((page) => page.slug)]

for (const slug of [...urls, "404"]) {
  const path = `${base}${slug ? `${slug}/` : ""}`
  const result = await entry.renderPage(new Request(`${origin}${path}`))
  if (result._tag !== "Rendered") {
    throw new Error(`Cannot prerender ${path}`)
  }
  const page = data.pages.find((page) => page.slug === slug)
  const description =
    page?.description ??
    "Compose typed Effect RPC calls into a single graph. Resolve dependencies on the server and return the data you select."
  const canonical = `${origin}${path}`
  const metadata = `<meta name="description" content="${escape(description)}">\n<meta property="og:type" content="website">\n<meta property="og:title" content="${escape(page ? `${page.title} | effect-rpc-pipeline` : "effect-rpc-pipeline")}">\n<meta property="og:description" content="${escape(description)}">\n${slug === "404" ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escape(canonical)}"><meta property="og:url" content="${escape(canonical)}">`}`
  const html = Server.injectIntoTemplate(template, result.application, {
    containerId: "root",
  }).replace("</head>", `${metadata}\n</head>`)
  const output = slug === "404" ? directory : resolve(directory, slug)
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, slug === "404" ? "404.html" : "index.html"), html)
}
await writeFile(resolve(directory, ".nojekyll"), "")
await writeFile(
  resolve(directory, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((slug) => `<url><loc>${origin}${base}${slug ? `${slug}/` : ""}</loc></url>`).join("")}</urlset>`,
)
console.log(`Prerendered ${urls.length} pages and a GitHub Pages 404 page`)

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Option } from "effect"
import * as Markdown from "@foldkit/markdown"
import { parseMarkdown } from "@foldkit/markdown/vite"
import { createHighlighter } from "shiki"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (path: string) => readFile(resolve(root, path), "utf8")
const readme = await read("README.md")
const usage = await read("docs/guides/usage.md")
const sections = (source: string) => source.split(/(?=^## )/m)
const pick = (source: string, titles: ReadonlyArray<string>) => {
  const available = sections(source)
  for (const title of titles) {
    if (!available.some((section) => section.startsWith(`## ${title}\n`))) {
      throw new Error(`Missing shared documentation section: ${title}`)
    }
  }
  return available
    .filter((section) => titles.some((title) => section.startsWith(`## ${title}\n`)))
    .join("\n")
}
const modules = [
  "Pipeline",
  "PipelineClient",
  "PipelineServer",
  "Capability",
  "Auth",
  "RequestBatching",
  "Sql",
  "Telemetry",
  "Duplex",
]
const definitions = [
  {
    slug: "getting-started",
    title: "Getting started",
    group: "Start here",
    source: "README.md",
    text:
      "# Getting started\n\nDefine an RPC contract, serve it on Node, and compose remote calls from a browser or Node client.\n\n" +
      pick(readme, ["Install", "Quickstart"]),
  },
  {
    slug: "concepts",
    title: "How pipelines work",
    group: "Start here",
    source: "docs/guides/how-pipelines-work.md",
    text: await read("docs/guides/how-pipelines-work.md"),
  },
  {
    slug: "guides/composition",
    title: "Composition",
    group: "Guides",
    source: "docs/guides/usage.md",
    text:
      "# Composition\n\nBuild a graph with remote values, select its result, then run it once.\n\n" +
      pick(usage, ["Compose finite calls", "Errors and requirements"]),
  },
  {
    slug: "guides/authentication",
    title: "Authentication",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# Authentication\n\n" + pick(usage, ["Authentication and authorization"]),
  },
  {
    slug: "guides/streams",
    title: "WebSockets and streams",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# WebSockets and streams\n\n" + pick(usage, ["WebSockets and streams"]),
  },
  {
    slug: "guides/capabilities",
    title: "Capabilities and callbacks",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# Capabilities and callbacks\n\n" + pick(usage, ["Typed capabilities"]),
  },
  {
    slug: "guides/batching",
    title: "Batching and caching",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# Batching and caching\n\n" + pick(usage, ["Backend request batching and caching"]),
  },
  {
    slug: "guides/transactions",
    title: "Transactions",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# Transactions\n\n" + pick(usage, ["Transactions"]),
  },
  {
    slug: "guides/observability",
    title: "Telemetry and middleware",
    group: "Guides",
    source: "docs/guides/usage.md",
    text:
      "# Telemetry and middleware\n\n" +
      pick(usage, ["Tracing and metrics", "Advanced server middleware"]),
  },
  {
    slug: "guides/transports",
    title: "Custom transports",
    group: "Guides",
    source: "docs/guides/usage.md",
    text: "# Custom transports\n\n" + pick(usage, ["Custom transports and direct execution"]),
  },
  {
    slug: "guides/contracts",
    title: "Contracts and limits",
    group: "Guides",
    source: "docs/guides/contracts.md",
    text: await read("docs/guides/contracts.md"),
  },
  {
    slug: "guides/migration",
    title: "Migrating to 0.1",
    group: "Guides",
    source: "docs/guides/migration.md",
    text: await read("docs/guides/migration.md"),
  },
  {
    slug: "examples",
    title: "Example applications",
    group: "Start here",
    source: "docs/guides/usage.md",
    text:
      "# Example applications\n\nThese complete applications demonstrate the library in use. Clone the repository to run them locally.\n\n" +
      pick(usage, ["TodoMVC example", "Full-stack blog example"]),
  },
  {
    slug: "api",
    title: "API overview",
    group: "API reference",
    source: "docs/api.md",
    text: await read("docs/api.md"),
  },
  ...(await Promise.all(
    modules.map(async (title) => ({
      slug: `api/${title}`,
      title,
      group: "API reference",
      source: `docs/api/${title}.md`,
      text: await read(`docs/api/${title}.md`),
    })),
  )),
]

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
const base = process.env.SITE_BASE ?? "/effect-rpc-pipeline/"
if (!/^\/(?:[\w-]+\/)*$/.test(base)) {
  throw new Error("SITE_BASE must be a normalized path with a trailing slash")
}
const github = "https://github.com/swarthout/effect-rpc-pipeline/blob/main/"
const highlighter = await createHighlighter({
  themes: ["github-light-high-contrast", "github-dark-high-contrast"],
  langs: ["typescript", "javascript", "json", "bash", "graphql", "text"],
})
const highlights: Record<string, string> = {}
const overview = await read("docs/snippets/overview.ts")
const heroCode = overview
  .split("// snippet:selection:start\n")
  .at(1)
  ?.split("// snippet:selection:end")
  .at(0)
  ?.trimEnd()
  .replace(/^  /gm, "")
  .trim()
if (!heroCode) {
  throw new Error("Missing the compiled README selection snippet")
}
highlights[heroCode] = highlighter.codeToHtml(heroCode, {
  lang: "typescript",
  themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
  defaultColor: false,
})

const homepageSource = await read("docs/snippets/homepage.ts")
const homepage: Record<string, string> = {}
for (const match of homepageSource.matchAll(
  /\/\/ homepage:(\w+):start\n([\s\S]*?)\n\s*\/\/ homepage:\1:end/g,
)) {
  const lines = match[2].split("\n")
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  )
  const code = lines
    .map((line) => line.slice(indent))
    .join("\n")
    .trim()
  homepage[match[1]] = code
  highlights[code] = highlighter.codeToHtml(code, {
    lang: "typescript",
    themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
    defaultColor: false,
  })
}
for (const name of ["effect", "roundTrips", "query", "mutation"]) {
  if (!homepage[name]) {
    throw new Error(`Missing homepage snippet: ${name}`)
  }
}

const headingsFor = (text: string) => {
  const counts = new Map<string, number>()
  let isFence = false
  return text.split("\n").flatMap((line) => {
    if (line.startsWith("```")) {
      isFence = !isFence
      return []
    }
    const match = /^(#{1,6}) (.+)$/.exec(line)
    if (isFence || !match) {
      return []
    }
    const title = match[2].replace(/`/g, "")
    const key = slugify(title)
    const count = counts.get(key) ?? 0
    counts.set(key, count + 1)
    return [{ level: match[1].length, title, id: count ? `${key}-${count}` : key }]
  })
}

const rewriteLink = (url: string, source: string, slug: string) => {
  if (/^(https?:|mailto:|tel:)/.test(url)) {
    return url
  }
  if (url.startsWith("#")) {
    return url
  }
  const [path, anchor] = url.split("#")
  const target = relative(root, resolve(root, dirname(source), path))
  const candidates = definitions.filter((page) => page.source === target)
  const page =
    candidates.find(
      (page) => anchor && headingsFor(page.text).some((heading) => heading.id === anchor),
    ) ??
    candidates.find((page) => page.slug === slug) ??
    candidates.at(0)
  if (page) {
    return `${base}${page.slug}/${anchor ? `#${anchor}` : ""}`
  }
  return `${github}${target}${anchor ? `#${anchor}` : ""}`
}

const pages = await Promise.all(
  definitions.map(async (definition) => {
    const symbols = definition.slug.startsWith("api/")
      ? [
          ...new Set(
            [
              ...definition.text.matchAll(
                /^export (?:declare )?(?:abstract )?(?:class|function|const|type|interface) ([A-Za-z_$][\w$]*)/gm,
              ),
            ].map((match) => match[1]),
          ),
        ]
      : []
    const symbolIndex = symbols.length
      ? `## Exports\n\n${symbols.map((name) => `[\`${name}\`](#symbol-${slugify(name)})`).join(" · ")}\n\n`
      : ""
    const indexedText = definition.text
      .replace(/^# ([^\n]+)\n\n## \1\n/, "# $1\n")
      .replace("```ts\n", `${symbolIndex}\`\`\`ts\n`)
    const source = indexedText
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_whole, label, url) =>
          `[${label}](${rewriteLink(url, definition.source, definition.slug)})`,
      )
    const document = parseMarkdown(source)
    const walk = async (blocks: ReadonlyArray<Markdown.Block>): Promise<void> => {
      for (const block of blocks) {
        if (block._tag === "CodeBlock") {
          const language = Option.getOrElse(block.maybeLanguage, () => "text")
          const lang = { ts: "typescript", js: "javascript", sh: "bash" }[language] ?? language
          const supported = highlighter.getLoadedLanguages().includes(lang)
          const seen = new Set<string>()
          const decorations = symbols.length
            ? block.value.split("\n").flatMap((line, index) => {
                const name =
                  /^export (?:declare )?(?:abstract )?(?:class|function|const|type|interface) ([A-Za-z_$][\w$]*)/
                    .exec(line)
                    ?.at(1)
                if (!name || seen.has(name)) {
                  return []
                }
                seen.add(name)
                return [
                  {
                    start: { line: index, character: 0 },
                    end: { line: index, character: line.length },
                    properties: { id: `symbol-${slugify(name)}`, class: "symbol-line" },
                  },
                ]
              })
            : []
          highlights[block.value] = highlighter.codeToHtml(block.value, {
            lang: supported ? lang : "text",
            themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
            defaultColor: false,
            decorations,
          })
        } else if (block._tag === "Blockquote") {
          await walk(block.blocks)
        } else if (block._tag === "List") {
          for (const item of block.items) {
            await walk(item.blocks)
          }
        }
      }
    }
    await walk(document.blocks)
    const headings = [
      ...headingsFor(source),
      ...symbols.map((title) => ({ level: 3, title, id: `symbol-${slugify(title)}` })),
    ]
    const description =
      source.split("\n").find((line) => line && !line.startsWith("#")) ?? definition.title
    return {
      slug: definition.slug,
      title: definition.title,
      group: definition.group,
      source: definition.source,
      description,
      headings,
      search: source.replace(/[`#*|]/g, ""),
      document: Markdown.encodeDocument(document),
    }
  }),
)
const groups = ["Start here", "Guides", "API reference"]
pages.sort((left, right) => groups.indexOf(left.group) - groups.indexOf(right.group))
highlighter.dispose()
await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true })
await writeFile(
  new URL("../src/generated/content.json", import.meta.url),
  JSON.stringify({ base, pages, highlights, heroCode, homepage }),
)
console.log(`Compiled ${pages.length} documentation pages from shared Markdown`)

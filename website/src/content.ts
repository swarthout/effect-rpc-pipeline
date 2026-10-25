import { Option } from "effect"
import * as Markdown from "@foldkit/markdown"
import data from "./generated/content.json"

export const base = import.meta.env.BASE_URL
export const pages = data.pages
export const heroCode = data.heroCode
export const href = (slug = "") => `${base}${slug ? `${slug}/` : ""}`
export const findPage = (slug: string) =>
  Option.fromNullishOr(pages.find((page) => page.slug === slug))
export type Page = (typeof pages)[number]
export const documentFor = (page: Page) => Markdown.decodeDocument(page.document)
const highlights: Readonly<Record<string, string>> = data.highlights
export const highlightFor = (code: string) => highlights[code]

export const searchPages = (query: string) => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) {
    return []
  }
  return pages
    .flatMap((page) => {
      const text = page.search.toLowerCase()
      if (!terms.every((term) => text.includes(term) || page.title.toLowerCase().includes(term))) {
        return []
      }
      const titleScore = terms.filter((term) => page.title.toLowerCase().includes(term)).length * 10
      const heading = page.headings.find((heading) =>
        terms.some((term) => heading.title.toLowerCase().includes(term)),
      )
      const firstIndex = text.indexOf(terms.at(0) ?? "")
      const start = Math.max(0, firstIndex - 60)
      return [
        {
          page,
          heading,
          score: titleScore + (heading ? 2 : 0),
          excerpt: page.search.slice(start, start + 180).replace(/\s+/g, " "),
        },
      ]
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
}

import { describe, expect, test } from "vitest"
import { Option } from "effect"
import { fromString } from "foldkit/url"
import { init, Message, update } from "./main"
import { base, pages, searchPages } from "./content"
import { routeForPath } from "./route"

const initial = () => init(Option.getOrThrow(fromString(`https://example.com${base}`))).model

test("navigation closes the mobile menu", () => {
  const opened = update(initial(), Message.ClickedMenu()).model
  const navigated = update(
    opened,
    Message.ChangedUrl({ url: Option.getOrThrow(fromString(`https://example.com${base}api/`)) }),
  ).model
  expect(navigated.menu).toBe("Closed")
})

describe("documentation discovery", () => {
  test("every content route resolves under the GitHub Pages prefix", () => {
    for (const page of pages) {
      expect(routeForPath(`${base}${page.slug}/`)).toEqual({ _tag: "Page", slug: page.slug })
    }
    expect(routeForPath(`${base}missing/`)._tag).toBe("NotFound")
    expect(routeForPath("/elsewhere/")._tag).toBe("NotFound")
  })
  test("finds reference symbols as well as guide topics", () => {
    expect(
      searchPages("maxExecutionSteps").some((result) => result.page.slug === "api/PipelineServer"),
    ).toBe(true)
    expect(searchPages("transaction").at(0)?.page.slug).toBe("guides/transactions")
    expect(searchPages("this-symbol-does-not-exist")).toEqual([])
    expect(searchPages(" ")).toEqual([])
  })
})

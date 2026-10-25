import { describe, expect, test } from "vitest"
import { Option } from "effect"
import { fromString } from "foldkit/url"
import { Demo, init, Message, update } from "./main"
import { base, pages, searchPages } from "./content"
import { routeForPath } from "./route"

const initial = () => init(Option.getOrThrow(fromString(`https://example.com${base}`))).model

describe("pipeline visualization", () => {
  test("walks from lazy construction to dependent work and selection", () => {
    const user = update(initial(), Message.ClickedDemoStep()).model
    expect(user.demo._tag).toBe("User")
    const parallel = update(user, Message.ClickedDemoStep()).model
    expect(parallel.demo._tag).toBe("Parallel")
    const complete = update(parallel, Message.ClickedDemoStep()).model
    expect(complete.demo._tag).toBe("Complete")
    expect(complete.demoPlayback).toBe("Paused")
  })
  test("reset invalidates an outstanding animation completion", () => {
    const playing = update(initial(), Message.ClickedDemoRun()).model
    const reset = update(playing, Message.ClickedDemoReset()).model
    const stale = update(
      reset,
      Message.CompletedWaitForStep({ revision: playing.demoRevision }),
    ).model
    expect(stale.demo).toEqual(Demo.Idle())
    expect(stale.demoPlayback).toBe("Paused")
  })
  test("navigation invalidates animation completions and closes the menu", () => {
    const playing = update(initial(), Message.ClickedDemoRun()).model
    const opened = update(playing, Message.ClickedMenu()).model
    const navigated = update(
      opened,
      Message.ChangedUrl({ url: Option.getOrThrow(fromString(`https://example.com${base}api/`)) }),
    ).model
    const stale = update(
      navigated,
      Message.CompletedWaitForStep({ revision: playing.demoRevision }),
    ).model
    expect(stale.menu).toBe("Closed")
    expect(stale.demo._tag).toBe("User")
    expect(stale.demoPlayback).toBe("Paused")
  })
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

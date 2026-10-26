import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const base = "/effect-rpc-pipeline/"

test("documentation uses readable body and code sizes", async ({ page }) => {
  await page.goto(`${base}getting-started/`)
  expect(
    await page
      .locator(".prose p")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(17)
  expect(
    await page
      .locator(".prose pre")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14)
  expect(
    await page
      .locator(".nav-item")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page
      .locator(".prose pre")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14)
})

test("homepage benefits link to evidence and switch between query and mutation selections", async ({
  page,
}) => {
  await page.goto(base)
  await page
    .getByRole("region", { name: "Core features" })
    .getByRole("link", { name: /Built for Effect/ })
    .click()
  await expect(page.locator("#effect-integration h2")).toBeInViewport()
  await expect(page.locator("#effect-integration")).toContainText("Effect.catchTag")
  await expect(page.locator("#fewer-round-trips")).toContainText("2 round trips")
  await expect(page.locator("#fewer-round-trips")).toContainText("1 round trip")
  const selection = page.getByRole("region", { name: "Selected query and mutation results" })
  await expect(selection.getByRole("button", { name: "Query", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(selection.getByLabel("Example selected response")).toContainText('"name": "Ada"')
  await selection.getByRole("button", { name: "After a mutation" }).click()
  await expect(selection.getByRole("button", { name: "After a mutation" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(selection).toContainText("Pipeline.andThen")
  await expect(selection.getByLabel("Example selected response")).toContainText('"name": "Augusta"')
  await selection.getByRole("button", { name: "Query", exact: true }).click()
  await expect(selection.getByLabel("Example selected response")).toContainText('"name": "Ada"')
})

test("text contrast passes on the homepage and docs in both themes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pipeline-theme", "Light"))
  for (const path of [
    base,
    `${base}getting-started/`,
    `${base}concepts/`,
    `${base}api/Pipeline/`,
  ]) {
    await page.goto(path)
    await expect(page.locator(".site")).toHaveAttribute("data-theme", "Light")
    for (const theme of ["Light", "Dark"]) {
      if (theme === "Dark") {
        await page.getByRole("button", { name: /Theme:/ }).click()
      }
      await expect(page.locator(".site")).toHaveAttribute("data-theme", theme)
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze()
      expect(
        results.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
      ).toEqual([])
    }
  }
})

test("homepage diagrams and enlarged text reflow on narrow screens", async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await expect(page.locator("#selected-results h2")).toBeVisible()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const headingSize = await page
    .locator("h1")
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%"
  })
  expect(
    await page.locator("h1").evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(headingSize * 2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole("button", { name: "After a mutation" }).click()
  await expect(page.getByLabel("Example selected response")).toContainText("Augusta")
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test("enlarged narrow-screen anchors stay clear of the header", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(`${base}getting-started/`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%"
  })
  await page.locator("#quickstart .heading-anchor").focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#quickstart")).toBeFocused()
  await expect
    .poll(() =>
      page
        .locator("#quickstart")
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top >=
            Math.max(0, document.querySelector(".header")!.getBoundingClientRect().bottom),
        ),
    )
    .toBe(true)
  await page.goto(`${base}getting-started/`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%"
  })
  await page.getByRole("button", { name: "Menu", exact: true }).click()
  await page.getByRole("searchbox").fill("makeHttp")
  await page
    .locator(".search-results")
    .getByRole("link")
    .filter({ has: page.getByText("PipelineClient", { exact: true }) })
    .click()
  await expect(page.locator("#symbol-makehttp")).toBeFocused()
  await expect
    .poll(() =>
      page
        .locator("#symbol-makehttp")
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top >=
            Math.max(0, document.querySelector(".header")!.getBoundingClientRect().bottom),
        ),
    )
    .toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

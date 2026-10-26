import { test, expect } from "@playwright/test"

const base = "/effect-rpc-pipeline/"

test("clicked anchors scroll and focus; page navigation starts at the top", async ({ page }) => {
  await page.goto(`${base}getting-started/`)
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Quickstart", exact: true })
    .click()
  await expect(page.locator("#quickstart")).toBeInViewport()
  await expect(page.locator("#quickstart")).toBeFocused()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page
    .getByRole("navigation", { name: "Documentation", exact: true })
    .getByRole("link", { name: "How pipelines work", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "How pipelines work", exact: true }),
  ).toBeInViewport()
  await expect(page.locator("#main-content")).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.getByRole("searchbox").fill("makeHttp")
  await page
    .locator(".search-results")
    .getByRole("link")
    .filter({ has: page.getByText("PipelineClient", { exact: true }) })
    .click()
  await expect(page.locator("#symbol-makehttp")).toBeInViewport()
  await expect(page.locator("#symbol-makehttp")).toBeFocused()
  await page.getByRole("link", { name: "Skip to content", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#main-content")).toBeFocused()
})

test("home identifies the package and hydrates its query selection", async ({ page }) => {
  const errors: Array<string> = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(base)
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "effect-rpc-pipeline",
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.locator(".hero-subtitle")).toHaveText("Effect-native RPC promise pipelining.")
  await expect(page.locator(".header .brand")).toHaveText("effect-rpc-pipeline")
  await page.getByRole("button", { name: "After a mutation" }).click()
  await expect(page.getByLabel("Example selected response")).toContainText("Augusta")
  expect(errors).toEqual([])
})

test("docs work at a deep URL with search, anchors, copy, and persisted themes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto(`${base}guides/contracts/`)
  await expect(
    page.getByRole("heading", { name: "Contracts and limits", exact: true }),
  ).toBeVisible()
  await page.getByRole("searchbox").fill("maxExecutionSteps")
  await expect(
    page.locator(".search-results").getByRole("link", { name: "PipelineServer", exact: false }),
  ).toBeVisible()
  await page
    .locator(".search-results")
    .getByRole("link", { name: "PipelineServer", exact: false })
    .click()
  await expect(page).toHaveURL(new RegExp(`${base}api/PipelineServer/`))
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `https://swarthout.github.io${base}api/PipelineServer/`,
  )
  await expect(page.getByRole("heading", { name: "PipelineServer", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Copy ts code" }).click()
  await expect(page.getByRole("button", { name: "Copy ts code" })).toHaveText("Copied ✓")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("maxExecutionSteps")
  await page.getByRole("button", { name: /Theme:/ }).click()
  await expect(page.locator(".site")).toHaveAttribute("data-theme", "Light")
  await page.getByRole("button", { name: /Theme:/ }).click()
  await expect(page.locator(".site")).toHaveAttribute("data-theme", "Dark")
  await page.reload()
  await expect(page.locator(".site")).toHaveAttribute("data-theme", "Dark")
  await page.goto(`${base}getting-started/#quickstart`)
  await expect(page.locator("#quickstart")).toBeInViewport()
})

test("prerendered documentation is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:4173${base}guides/capabilities/`)
  await expect(
    page.getByRole("heading", { name: "Capabilities and callbacks", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Define a capability", { exact: true }).first()).toBeVisible()
  await context.close()
})

test("mobile navigation and layout work from the landing page and deep pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base)
  await page.getByRole("button", { name: "Menu", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Documentation", exact: true })
    .getByRole("link", { name: "Getting started", exact: true })
    .click()
  await expect(page.getByRole("heading", { name: "Getting started", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  const isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(isOverflowing).toBe(false)
  await page.getByRole("button", { name: "Menu", exact: true }).click()
  await page.getByRole("searchbox").fill("transactions")
  await page
    .locator(".search-results")
    .getByRole("link", { name: "Transactions", exact: false })
    .first()
    .click()
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }).first(),
  ).toBeVisible()
})

import { Match, Option } from "effect"
import * as Markdown from "@foldkit/markdown"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { Message, type Model } from "./main"
import {
  documentFor,
  findPage,
  highlightFor,
  heroCode,
  href,
  pages,
  searchPages,
  type Page,
} from "./content"

const repository = "https://github.com/swarthout/effect-rpc-pipeline"
type Builder = HtmlBuilder<Message>
const link = (h: Builder, slug: string, text: string, className = "") =>
  h.a([h.Href(href(slug)), h.Class(className)], [text])
const brand = (h: Builder) =>
  h.a(
    [h.Href(href()), h.Class("brand"), h.AriaLabel("effect-rpc-pipeline home")],
    [
      h.img([h.Class("brand-mark"), h.Src(`${import.meta.env.BASE_URL}favicon.svg`), h.Alt("")]),
      h.span([], ["effect", h.span([h.Class("brand-slash")], ["/"]), "rpc-pipeline"]),
    ],
  )

const header = (model: Model, h: Builder) =>
  h.header(
    [h.Class("header")],
    [
      h.div(
        [h.Class("header-inner")],
        [
          brand(h),
          h.nav(
            [h.Class("header-links"), h.AriaLabel("Main navigation")],
            [
              link(h, "getting-started", "Documentation", "header-docs"),
              h.a([h.Href(repository), h.Class("github-link")], ["GitHub ↗"]),
              h.button(
                [
                  h.Class("theme-button"),
                  h.OnClick(Message.ClickedTheme()),
                  h.AriaLabel(`Theme: ${model.theme}. Change theme`),
                ],
                [
                  model.theme === "Dark" ? "☾" : "◐",
                  h.span([h.Class("theme-label")], [model.theme]),
                ],
              ),
              h.button(
                [
                  h.Class("mobile-menu"),
                  h.OnClick(Message.ClickedMenu()),
                  h.AriaExpanded(model.menu === "Open"),
                  h.AriaControls("docs-navigation"),
                ],
                [model.menu === "Open" ? "Close" : "Menu"],
              ),
            ],
          ),
        ],
      ),
    ],
  )

const codeBlock = (code: string, model: Model, h: Builder, label = "TypeScript") => {
  const highlighted = highlightFor(code)
  const isCopied = Option.contains(model.maybeCopied, code)
  return h.div(
    [h.Class("code-block")],
    [
      h.div(
        [h.Class("code-toolbar")],
        [
          h.span([], [label]),
          h.button(
            [h.OnClick(Message.ClickedCopy({ text: code })), h.AriaLabel(`Copy ${label} code`)],
            [isCopied ? "Copied ✓" : "Copy"],
          ),
        ],
      ),
      highlighted ? h.div([h.InnerHTML(highlighted)], []) : h.pre([], [h.code([], [code])]),
    ],
  )
}

const demoDescriptions = {
  Idle: {
    number: "00",
    title: "Build the graph",
    text: "Remote calls are lazy values. Connect them without sending a request.",
  },
  User: {
    number: "01",
    title: "Run the pipeline",
    text: "Send one graph to the server. findUser runs first because the other calls need its result.",
  },
  Parallel: {
    number: "02",
    title: "Resolve dependencies",
    text: "The user ID is available. getProfile and listFriendIds can now run concurrently.",
  },
  Complete: {
    number: "03",
    title: "Return the selection",
    text: "The server returns the selected user, profile, and friend IDs together.",
  },
}

export const demoView = (model: Model, h: Builder): Html => {
  const phase = model.demo._tag
  const description = demoDescriptions[phase]
  const userStatus = phase === "Idle" ? "Ready" : phase === "User" ? "Running" : "Complete"
  const childStatus =
    phase === "Parallel" ? "Running" : phase === "Complete" ? "Complete" : "Waiting"
  const node = (name: string, status: string, detail: string) =>
    h.div(
      [h.Class(`graph-node node-${status.toLowerCase()}`)],
      [
        h.div([h.Class("node-heading")], [h.span([h.Class("status-dot")], []), h.code([], [name])]),
        h.span([h.Class("node-detail")], [detail]),
        h.span([h.Class("node-status")], [status]),
      ],
    )
  return h.section(
    [
      h.Id("pipeline-demo"),
      h.Class("demo-section"),
      h.AriaLabel("Interactive pipeline execution demo"),
    ],
    [
      h.div(
        [h.Class("section-heading")],
        [
          h.p([h.Class("eyebrow")], ["FOLLOW THE DATA"]),
          h.h2([], ["One graph. Every dependency."]),
          h.p([], ["Step through a pipeline to see how the server schedules its work."]),
        ],
      ),
      h.div(
        [h.Class("demo-panel")],
        [
          h.div(
            [h.Class("demo-explanation")],
            [
              h.span([h.Class("step-number")], [description.number]),
              h.div(
                [h.AriaLive("polite"), h.Role("status")],
                [h.h3([], [description.title]), h.p([], [description.text])],
              ),
              h.div(
                [h.Class("demo-controls")],
                [
                  h.button(
                    [
                      h.Class("button button-primary"),
                      h.OnClick(Message.ClickedDemoRun()),
                      h.Disabled(model.demoPlayback === "Playing"),
                    ],
                    ["Run pipeline", " ↗"],
                  ),
                  h.button(
                    [
                      h.Class("button button-outline"),
                      h.OnClick(Message.ClickedDemoStep()),
                      h.Disabled(model.demoPlayback === "Playing" || phase === "Complete"),
                    ],
                    ["Next step"],
                  ),
                  h.button(
                    [h.Class("text-button"), h.OnClick(Message.ClickedDemoReset())],
                    ["Reset"],
                  ),
                ],
              ),
              h.p([h.Class("demo-caption")], ["Illustrative simulation · no network requests"]),
            ],
          ),
          h.div(
            [h.Class("graph")],
            [
              h.div(
                [h.Class("graph-topline")],
                [
                  h.span([], ["SERVER EXECUTION"]),
                  h.span([], [phase === "Idle" ? "Graph ready" : "1 pipeline request"]),
                ],
              ),
              h.div(
                [h.Class("graph-root")],
                [
                  node(
                    "findUser",
                    userStatus,
                    phase === "Parallel" || phase === "Complete"
                      ? 'id: "user_1"'
                      : '{ email: "ada@example.com" }',
                  ),
                ],
              ),
              h.div([h.Class("graph-connector"), h.AriaHidden(true)], [h.span([], ["user.id"])]),
              h.div(
                [h.Class("graph-children")],
                [
                  node("getProfile", childStatus, "{ userId: user.id }"),
                  node("listFriendIds", childStatus, "{ userId: user.id }"),
                ],
              ),
              h.div(
                [h.Class(`graph-result ${phase === "Complete" ? "result-complete" : ""}`)],
                [
                  h.span([], ["SELECTED RESULT"]),
                  h.code(
                    [],
                    [
                      phase === "Complete"
                        ? '{ user: { name: "Ada" }, profile: { bio: "…" }, friendIds: ["user_2"] }'
                        : "{ user, profile, friendIds }",
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const footer = (h: Builder) =>
  h.footer(
    [h.Class("footer")],
    [
      h.div([], [brand(h), h.p([], ["Effect-native RPC promise pipelining."])]),
      h.div(
        [h.Class("footer-links")],
        [
          link(h, "getting-started", "Get started"),
          h.a([h.Href(repository)], ["Source ↗"]),
          h.a([h.Href(`${repository}/blob/main/LICENSE`)], ["MIT license"]),
          h.a([h.Href("https://foldkit.dev")], ["Built with Foldkit ↗"]),
        ],
      ),
    ],
  )

const landing = (model: Model, h: Builder) =>
  h.main(
    [h.Id("main-content"), h.Tabindex(-1), h.Class("landing")],
    [
      h.section(
        [h.Class("hero")],
        [
          h.div(
            [h.Class("hero-copy")],
            [
              h.div(
                [h.Class("hero-meta")],
                [h.span([h.Class("version-pill")], ["v0.1"]), h.span([], ["BUILT ON EFFECT 4"])],
              ),
              h.h1([], ["Compose the calls.", h.br([]), h.span([], ["Skip the round trips."])]),
              h.p(
                [h.Class("hero-description")],
                [
                  "Connect typed RPC calls into a single graph. The server resolves dependencies, runs independent work concurrently, and returns the data you select.",
                ],
              ),
              h.div(
                [h.Class("hero-actions")],
                [
                  link(h, "getting-started", "Get started ↗", "button button-primary"),
                  link(h, "concepts", "How it works →", "button button-outline"),
                ],
              ),
              h.div(
                [h.Class("install-command")],
                [
                  h.code([], ["npm install effect-rpc-pipeline effect"]),
                  h.button(
                    [
                      h.OnClick(
                        Message.ClickedCopy({ text: "npm install effect-rpc-pipeline effect" }),
                      ),
                      h.AriaLabel("Copy install command"),
                    ],
                    [
                      Option.contains(model.maybeCopied, "npm install effect-rpc-pipeline effect")
                        ? "Copied ✓"
                        : "Copy",
                    ],
                  ),
                ],
              ),
              h.p([h.Class("hero-footnote")], ["TypeScript · Node.js · Modern browsers · MIT"]),
            ],
          ),
          h.div(
            [h.Class("hero-example")],
            [
              h.div(
                [h.Class("example-top")],
                [
                  h.span([h.Class("window-dots"), h.AriaHidden(true)], ["● ● ●"]),
                  h.span([], ["account.ts"]),
                  h.span([], ["ONE EXECUTION"]),
                ],
              ),
              codeBlock(heroCode, model, h),
              h.div(
                [h.Class("example-bottom")],
                [
                  h.span([h.Class("status-dot")], []),
                  h.span([], ["Compose now. Execute together."]),
                  h.code([], ["yield* →"]),
                ],
              ),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class("principles"), h.AriaLabel("Core features")],
        [
          ...[
            {
              number: "01",
              title: "Keep the types",
              text: "Use Effect RPC schemas, errors, services, and middleware. Remote values stay typed as you compose them.",
            },
            {
              number: "02",
              title: "Describe the dependencies",
              text: "Pass a remote result into the next call. The server waits for that value and schedules independent work together.",
            },
            {
              number: "03",
              title: "Choose what comes back",
              text: "Select objects, arrays, or individual fields. Intermediate results can stay on the server.",
            },
          ].map((item) =>
            h.div(
              [h.Class("principle")],
              [
                h.span([h.Class("eyebrow")], [item.number]),
                h.h2([], [item.title]),
                h.p([], [item.text]),
              ],
            ),
          ),
        ],
      ),
      demoView(model, h),
      h.section(
        [h.Class("explore-section")],
        [
          h.div(
            [h.Class("section-heading")],
            [
              h.p([h.Class("eyebrow")], ["GO FURTHER"]),
              h.h2([], ["A pipeline is just the beginning."]),
            ],
          ),
          h.div(
            [h.Class("explore-grid")],
            [
              ...[
                {
                  slug: "guides/capabilities",
                  label: "Capabilities & callbacks",
                  text: "Return typed, connection-scoped interfaces and call back into the client.",
                },
                {
                  slug: "guides/batching",
                  label: "Backend batching",
                  text: "Combine one pipeline request with request-scoped caches and bulk reads.",
                },
                {
                  slug: "guides/transactions",
                  label: "SQL transactions",
                  text: "Wrap graph execution in a transaction and defer effects until commit.",
                },
                {
                  slug: "api",
                  label: "Complete API reference",
                  text: "Explore every exported module, type, and function signature.",
                },
              ].map((item) =>
                h.a(
                  [h.Href(href(item.slug)), h.Class("explore-card")],
                  [h.h3([], [item.label, h.span([], ["↗"])]), h.p([], [item.text])],
                ),
              ),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class("cta")],
        [
          h.div(
            [],
            [
              h.p([h.Class("eyebrow")], ["START SMALL"]),
              h.h2([], ["Your first pipeline, end to end."]),
              h.p([], ["Define a contract. Start a server. Compose a client."]),
            ],
          ),
          link(h, "getting-started", "Read the quickstart ↗", "button button-primary"),
        ],
      ),
      footer(h),
    ],
  )

const sidebar = (model: Model, h: Builder) =>
  h.aside(
    [h.Id("docs-navigation"), h.Class(`sidebar ${model.menu === "Open" ? "sidebar-open" : ""}`)],
    [
      h.label([h.For("docs-search"), h.Class("search-label")], ["Search documentation"]),
      h.div(
        [h.Class("search-field")],
        [
          h.span([h.AriaHidden(true)], ["⌕"]),
          h.input([
            h.Id("docs-search"),
            h.Type("search"),
            h.Placeholder("Search the docs…"),
            h.Value(model.query),
            h.OnInput((query) => Message.ChangedSearch({ query })),
          ]),
        ],
      ),
      model.query.trim()
        ? h.div(
            [h.Class("search-results")],
            [
              h.p(
                [h.Role("status"), h.AriaLive("polite"), h.Class("search-summary")],
                [`${searchPages(model.query).length} results`],
              ),
              ...searchPages(model.query).map((result) =>
                h.a(
                  [
                    h.Href(
                      `${href(result.page.slug)}${result.heading ? `#${result.heading.id}` : ""}`,
                    ),
                  ],
                  [h.strong([], [result.page.title]), h.span([], [result.excerpt])],
                ),
              ),
            ],
          )
        : h.nav(
            [h.AriaLabel("Documentation")],
            [
              ...["Start here", "Guides", "API reference"].map((group) =>
                h.div(
                  [h.Class("nav-group")],
                  [
                    h.p([h.Class("nav-group-title")], [group]),
                    ...pages
                      .filter((page) => page.group === group)
                      .map((page) =>
                        h.a(
                          [
                            h.Href(href(page.slug)),
                            h.Class(
                              model.route._tag === "Page" && model.route.slug === page.slug
                                ? "nav-item active"
                                : "nav-item",
                            ),
                            ...(model.route._tag === "Page" && model.route.slug === page.slug
                              ? [h.AriaCurrent("page")]
                              : []),
                          ],
                          [page.title],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
    ],
  )

const prose = (page: Page, model: Model, h: Builder): Html => {
  const document = documentFor(page)
  const headings = document.blocks.filter((block) => block._tag === "Heading")
  const headingIds = new Map(
    headings.map((heading, index) => [heading, page.headings.at(index)?.id ?? ""]),
  )
  return Markdown.view(document, {
    views: {
      Heading: (heading, content) => {
        const id = headingIds.get(heading) ?? ""
        const attrs = [h.Id(id)]
        const nodes =
          heading.level === 1
            ? content
            : [
                ...content,
                h.a(
                  [h.Href(`#${id}`), h.Class("heading-anchor"), h.AriaLabel(`Link to ${id}`)],
                  ["#"],
                ),
              ]
        return Match.value(heading.level).pipe(
          Match.when(1, () => h.h1(attrs, nodes)),
          Match.when(2, () => h.h2(attrs, nodes)),
          Match.when(3, () => h.h3(attrs, nodes)),
          Match.when(4, () => h.h4(attrs, nodes)),
          Match.when(5, () => h.h5(attrs, nodes)),
          Match.orElse(() => h.h6(attrs, nodes)),
        )
      },
      CodeBlock: ({ value, maybeLanguage }) =>
        codeBlock(
          value,
          model,
          h,
          Option.getOrElse(maybeLanguage, () => "Code"),
        ),
      Table: (_table, header, rows) =>
        h.div([h.Class("table-scroll")], [h.table([], [h.thead([], [header]), h.tbody([], rows)])]),
    },
  })
}

const docsPage = (page: Page, model: Model, h: Builder) => {
  const index = pages.indexOf(page)
  const previous = pages.at(index - 1)
  const next = pages.at(index + 1)
  return h.div(
    [h.Class("docs-layout")],
    [
      sidebar(model, h),
      h.main(
        [h.Id("main-content"), h.Tabindex(-1), h.Class("docs-main")],
        [
          h.div(
            [h.Class("breadcrumb")],
            [
              link(h, "getting-started", "Documentation"),
              h.span([], ["/"]),
              h.span([], [page.group]),
            ],
          ),
          h.article([h.Class("prose")], [prose(page, model, h)]),
          h.div(
            [h.Class("page-edit")],
            [
              h.a(
                [h.Href(`${repository}/blob/main/${page.source}`)],
                ["View this page’s source ↗"],
              ),
            ],
          ),
          h.nav(
            [h.Class("page-neighbors"), h.AriaLabel("Previous and next pages")],
            [
              index > 0 && previous
                ? h.a(
                    [h.Href(href(previous.slug))],
                    [h.span([], ["← PREVIOUS"]), h.strong([], [previous.title])],
                  )
                : h.div([], []),
              next
                ? h.a(
                    [h.Href(href(next.slug))],
                    [h.span([], ["NEXT →"]), h.strong([], [next.title])],
                  )
                : h.div([], []),
            ],
          ),
          h.p(
            [h.Class("docs-footer")],
            [
              "effect-rpc-pipeline · MIT · ",
              h.a([h.Href("https://foldkit.dev")], ["Built with Foldkit"]),
            ],
          ),
        ],
      ),
      h.aside(
        [h.Class("toc")],
        [
          h.nav(
            [h.AriaLabel("On this page")],
            [
              h.p([h.Class("eyebrow")], ["ON THIS PAGE"]),
              ...page.headings
                .filter((heading) => heading.level === 2 || heading.level === 3)
                .map((heading) =>
                  h.a(
                    [h.Href(`#${heading.id}`), h.Class(heading.level === 3 ? "toc-child" : "")],
                    [heading.title],
                  ),
                ),
            ],
          ),
        ],
      ),
    ],
  )
}

export const view = (model: Model, h: Builder): Document => {
  const maybePage = model.route._tag === "Page" ? findPage(model.route.slug) : Option.none<Page>()
  const body = Option.match(maybePage, {
    onSome: (page) => docsPage(page, model, h),
    onNone: () =>
      model.route._tag === "Home"
        ? landing(model, h)
        : h.main(
            [h.Id("main-content"), h.Class("not-found")],
            [
              h.p([h.Class("eyebrow")], ["404 / PAGE NOT FOUND"]),
              h.h1([], ["This path ends here."]),
              h.p([], ["Find your way back to the documentation."]),
              link(h, "getting-started", "Get started →", "button button-primary"),
            ],
          ),
  })
  return {
    title: Option.match(maybePage, {
      onSome: (page) => `${page.title} | effect-rpc-pipeline`,
      onNone: () =>
        model.route._tag === "Home"
          ? "Typed RPC, fewer round trips | effect-rpc-pipeline"
          : "Page not found | effect-rpc-pipeline",
    }),
    canonical:
      model.route._tag === "NotFound"
        ? undefined
        : `${import.meta.env.SITE_ORIGIN}${href(model.route._tag === "Page" ? model.route.slug : "")}`,
    ogUrl:
      model.route._tag === "NotFound"
        ? undefined
        : `${import.meta.env.SITE_ORIGIN}${href(model.route._tag === "Page" ? model.route.slug : "")}`,
    body: h.div(
      [h.Class("site"), h.DataAttribute("theme", model.theme)],
      [
        h.a([h.Href("#main-content"), h.Class("skip-link")], ["Skip to content"]),
        header(model, h),
        model.route._tag !== "Page"
          ? h.div([h.Class("home-navigation")], [sidebar(model, h)])
          : h.empty,
        body,
        h.div([h.Role("status"), h.AriaLive("polite"), h.Class("sr-only")], [model.notice]),
      ],
    ),
  }
}

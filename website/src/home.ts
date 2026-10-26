import type { Html, HtmlBuilder } from "foldkit/html"
import { Message, type Model } from "./main"
import { homepage, href } from "./content"

type Builder = HtmlBuilder<Message>
type RenderCode = (code: string, label: string) => Html

export const benefits = [
  {
    id: "effect-integration",
    number: "01",
    title: "Built for Effect",
    text: "Compose RPC calls with the schemas, typed errors, services, and resource scopes you already use.",
  },
  {
    id: "fewer-round-trips",
    number: "02",
    title: "Fewer round trips",
    text: "Send dependent calls together so the next lookup can start on the server without another trip to the client.",
  },
  {
    id: "selected-results",
    number: "03",
    title: "Selected results",
    text: "Choose the fields returned by a query or the refreshed data returned after a mutation.",
  },
]

const heading = (h: Builder, number: string, title: string) =>
  h.div([h.Class("benefit-heading")], [h.p([h.Class("eyebrow")], [number]), h.h2([], [title])])

export const effectIntegrationView = (h: Builder, renderCode: RenderCode) =>
  h.section(
    [h.Id("effect-integration"), h.Class("benefit-section"), h.AriaLabel("Effect integration")],
    [
      heading(h, "01 / EFFECT INTEGRATION", "Use the Effect APIs you already know."),
      h.div(
        [h.Class("benefit-grid")],
        [
          h.div(
            [h.Class("benefit-copy")],
            [
              h.p(
                [],
                [
                  "Define your RPCs with Effect Schema and implement them with ordinary Effect handlers. The same RPC group gives the client its payload, result, and error types.",
                ],
              ),
              h.p(
                [],
                [
                  "A remote call is an Effect. Yield it in Effect.gen, handle a declared failure with catchTag, and provide application services through Layers.",
                ],
              ),
              h.a(
                [h.Href(href("guides/authentication")), h.Class("inline-link")],
                ["See authentication with Effect services →"],
              ),
            ],
          ),
          h.div(
            [h.Class("benefit-example")],
            [
              renderCode(homepage.effect, "Effect services and errors"),
              h.p(
                [h.Class("example-note")],
                [
                  "AppClient is an Effect service; AppClientLive supplies its HTTP implementation. This example uses the declared UserNotFound error.",
                ],
              ),
              h.p(
                [h.Class("example-note")],
                [
                  "HTTP executions own an internal request scope. WebSocket Layers own the connection used by streams and capability handles.",
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )

const tripRow = (h: Builder, operation: string) =>
  h.li(
    [h.Class("trip-row")],
    [
      h.span([h.Class("trip-endpoint")], ["Client"]),
      h.span([h.Class("trip-arrow"), h.AriaHidden(true)], ["→"]),
      h.code([h.Class("trip-operation")], [operation]),
      h.span([h.Class("trip-arrow"), h.AriaHidden(true)], ["→"]),
      h.span([h.Class("trip-endpoint")], ["Client"]),
    ],
  )

export const roundTripsView = (h: Builder, renderCode: RenderCode) =>
  h.section(
    [
      h.Id("fewer-round-trips"),
      h.Class("benefit-section"),
      h.AriaLabel("Fewer network round trips"),
    ],
    [
      heading(h, "02 / FEWER ROUND TRIPS", "Start the next lookup on the server."),
      h.div(
        [h.Class("benefit-grid")],
        [
          h.div(
            [h.Class("benefit-copy")],
            [
              h.p(
                [],
                [
                  "Suppose a page needs a user and that user’s profile. Sequential client calls wait for the user to arrive before requesting the profile.",
                ],
              ),
              h.p(
                [],
                [
                  "A pipeline sends both operations together. The server passes the user ID straight into getProfile, saving one network round trip in this example. That removes a wait from the page load.",
                ],
              ),
              h.p(
                [],
                [
                  "Independent calls can also run concurrently, up to the server’s limit. Handler and database work still take their usual time.",
                ],
              ),
              h.a(
                [h.Href(href("concepts")), h.Class("inline-link")],
                ["Read how pipeline execution works →"],
              ),
            ],
          ),
          h.div(
            [h.Class("benefit-example")],
            [
              renderCode(homepage.roundTrips, "Dependent calls"),
              h.p(
                [h.Class("example-note")],
                [
                  "user.id is a reference to the future result. Only the final yield sends the complete graph.",
                ],
              ),
            ],
          ),
        ],
      ),
      h.figure(
        [
          h.Class("round-trip-comparison"),
          h.AriaLabel(
            "Two dependent sequential RPC calls need two round trips; one pipeline needs one",
          ),
        ],
        [
          h.div(
            [h.Class("journey")],
            [
              h.div(
                [h.Class("journey-heading")],
                [h.h3([], ["Sequential RPC calls"]), h.span([], ["2 round trips"])],
              ),
              h.ol([], [tripRow(h, "findUser"), tripRow(h, "getProfile")]),
              h.p([], ["The client waits for the user ID between requests."]),
            ],
          ),
          h.div(
            [h.Class("journey journey-pipeline")],
            [
              h.div(
                [h.Class("journey-heading")],
                [h.h3([], ["Pipelined RPC calls"]), h.span([], ["1 round trip"])],
              ),
              h.ol([], [tripRow(h, "findUser → getProfile")]),
              h.p([], ["The server resolves the dependency within one request."]),
            ],
          ),
          h.figcaption([], ["Two dependent lookups, compared by client/server round trips."]),
        ],
      ),
    ],
  )

export const selectedResultsView = (model: Model, h: Builder, renderCode: RenderCode) => {
  const isMutation = model.selectionMode === "Mutation"
  const code = isMutation ? homepage.mutation : homepage.query
  return h.section(
    [
      h.Id("selected-results"),
      h.Class("benefit-section"),
      h.AriaLabel("Selected query and mutation results"),
    ],
    [
      heading(h, "03 / SELECTED RESULTS", "Return the fields your screen needs."),
      h.div(
        [h.Class("benefit-intro")],
        [
          h.p(
            [],
            [
              "Select fields from several RPCs into the response shape you want. The server can use intermediate values, such as a user ID, without returning them to the client.",
            ],
          ),
          h.p(
            [],
            [
              "After a mutation, use andThen to choose the refreshed data that comes back. The follow-up reads wait for the write and stay in the same pipeline request.",
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("selection-controls"), h.Role("group"), h.AriaLabel("Selection example")],
        [
          h.button(
            [
              h.OnClick(Message.ClickedSelectionMode({ mode: "Query" })),
              h.AriaPressed(String(!isMutation)),
            ],
            ["Query"],
          ),
          h.button(
            [
              h.OnClick(Message.ClickedSelectionMode({ mode: "Mutation" })),
              h.AriaPressed(String(isMutation)),
            ],
            ["After a mutation"],
          ),
        ],
      ),
      h.div(
        [h.Class("benefit-grid selection-grid")],
        [
          h.div(
            [h.Class("benefit-example")],
            [
              renderCode(code, isMutation ? "Mutation selection" : "Query selection"),
              h.p(
                [h.Class("example-note")],
                [
                  isMutation
                    ? "Rename the user, then select their updated name and profile bio."
                    : "Find the user, then select their name and profile bio.",
                ],
              ),
            ],
          ),
          h.figure(
            [
              h.Class("selection-diagram"),
              h.AriaLabel("The server uses the ID but returns only name and bio"),
            ],
            [
              h.div(
                [h.Class("selection-inputs")],
                [
                  h.div(
                    [],
                    [
                      h.strong([], [isMutation ? "renameUser" : "findUser"]),
                      h.span([], ["id → used by getProfile"]),
                      h.span([], ["name → selected"]),
                    ],
                  ),
                  h.div([], [h.strong([], ["getProfile"]), h.span([], ["bio → selected"])]),
                ],
              ),
              h.p([h.Class("selection-arrow")], ["↓ Selected response"]),
              h.div(
                [h.Class("selection-result"), h.Role("status"), h.AriaLive("polite")],
                [
                  h.pre(
                    [h.AriaLabel("Example selected response")],
                    [
                      JSON.stringify(
                        { name: isMutation ? "Augusta" : "Ada", bio: "Builds with Effect" },
                        null,
                        2,
                      ),
                    ],
                  ),
                ],
              ),
              h.figcaption(
                [],
                ["Example response. The user ID stays out of the returned selection."],
              ),
            ],
          ),
        ],
      ),
      h.p(
        [h.Class("benefit-footnote")],
        [
          "Selection controls the response payload. Backend queries and transaction boundaries remain explicit choices in your handlers and server configuration.",
        ],
      ),
      h.a(
        [h.Href(href("guides/composition")), h.Class("inline-link")],
        ["Explore selections, maps, and mutation phases →"],
      ),
    ],
  )
}

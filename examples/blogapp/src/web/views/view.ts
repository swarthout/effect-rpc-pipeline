import { Option } from "effect"
import { type Document, type Html, type HtmlBuilder } from "foldkit/html"
import { type Model, type Page } from "../model.js"
import { Message, type Message as MessageType } from "../message.js"
import { button } from "./components.js"
import { adminView, authView, editorView, feedView, postView } from "./pages.js"

const pages: Record<Page, (model: Model, h: HtmlBuilder<MessageType>) => Html> = {
  Feed: feedView, Post: postView, Login: (model, h) => authView(model, h, false),
  Register: (model, h) => authView(model, h, true), Editor: editorView, Admin: adminView
}

export const view = (model: Model, h: HtmlBuilder<MessageType>): Document => ({
  title: `${model.page} | Pipeline Press`,
  body: h.div([], [
    h.header([h.Class("header")], [h.button([h.Class("brand"), h.OnClick(Message.ClickedFeed())], ["Pipeline Press"]), h.nav([], [button("Articles", Message.ClickedFeed(), h, "nav"), Option.match(model.maybeSession, {
      onNone: () => button("Log in", Message.ClickedLogin(), h, "nav"),
      onSome: (session) => h.div([h.Class("nav-group")], [button("Write", Message.ClickedEditor(), h, "nav"), session.user.role === "Admin" ? button("Admin", Message.ClickedAdmin(), h, "nav") : h.empty, button("Log out", Message.ClickedLogout(), h, "nav")])
    })])]),
    model.error === "" ? h.empty : h.div([h.Class("error"), h.Role("alert")], [model.error]),
    pages[model.page](model, h)
  ])
})

import { Option } from "effect"
import { type Html, type HtmlBuilder } from "foldkit/html"
import { type Model } from "../model.js"
import { Message, type Message as MessageType } from "../message.js"
import { button, input, textarea } from "./components.js"

export const feedView = (model: Model, h: HtmlBuilder<MessageType>): Html => h.main([h.Class("stack")], [
  h.section([h.Class("hero")], [h.p([h.Class("eyebrow")], ["EFFECT RPC PIPELINES"]), h.h1([], ["Ideas worth composing"]), h.p([], ["Public reading, typed writes, and one round trip for the data each screen needs."])]),
  h.form([h.Class("search"), h.OnSubmit(Message.SubmittedSearch())], [input("search", "Search posts", model.search, (value) => Message.ChangedSearch({ value }), h), button("Search", Message.SubmittedSearch(), h)]),
  h.section([h.Class("cards")], model.feed.map(({ post, author }) => h.keyed("article")(post.id, [h.Class("card")], [
    h.div([h.Class("meta")], [`${author.displayName} · ${new Date(Option.getOrElse(post.publishedAt, () => post.createdAt)).toLocaleDateString()}`]),
    h.h2([], [post.title]), h.p([], [post.excerpt]),
    h.div([h.Class("meta")], [`${post.upvotes} upvotes · ${post.commentCount} comments · ${post.tags.join(" · ")}`]),
    button("Read article", Message.ClickedPost({ slug: post.slug }), h, "secondary")
  ])))
])

export const postView = (model: Model, h: HtmlBuilder<MessageType>): Html => Option.match(model.maybePost, {
  onNone: () => h.main([h.Class("panel")], ["Loading article…"]),
  onSome: (details) => h.main([h.Class("stack")], [
    h.article([h.Class("article")], [h.p([h.Class("eyebrow")], [details.author.displayName]), h.h1([], [details.post.title]), h.p([h.Class("lead")], [details.post.excerpt]), h.div([h.Class("prose")], details.post.body.split("\n").map((paragraph) => h.p([], [paragraph]))), h.div([h.Class("actions")], [button(`${details.post.upvotes} upvotes`, Message.ClickedUpvote(), h), details.canEdit ? button("Edit", Message.ClickedEditor(), h, "secondary") : h.empty])]),
    h.section([h.Class("panel stack")], [h.h2([], ["Discussion"]), Option.isSome(model.maybeSession) ? h.div([h.Class("stack")], [textarea("comment", "Add a comment", model.commentBody, (value) => Message.ChangedComment({ value }), h), button("Comment", Message.SubmittedComment(), h)]) : h.p([], ["Log in to join the discussion."]), ...details.comments.map(({ comment, author, canDelete }) => h.keyed("article")(comment.id, [h.Class("comment")], [h.strong([], [author.displayName]), h.p([], [comment.body]), canDelete ? button("Delete", Message.ClickedDeleteComment({ id: comment.id }), h, "danger") : h.empty]))])
  ])
})

export const notFoundView = (_model: Model, h: HtmlBuilder<MessageType>): Html => h.main([h.Class("panel stack")], [
  h.h1([], ["Article not found"]),
  h.p([], ["This article does not exist or is not published."]),
  button("Back to articles", Message.ClickedFeed(), h)
])

export const authView = (model: Model, h: HtmlBuilder<MessageType>, register: boolean): Html => h.main([h.Class("narrow panel stack")], [
  h.h1([], [register ? "Create an account" : "Log in"]),
  register ? input("display-name", "Display name", model.displayName, (value) => Message.ChangedDisplayName({ value }), h) : h.p([], ["Use admin / admin-password-change-me for the seeded administrator."]),
  input("username", "Username", model.username, (value) => Message.ChangedUsername({ value }), h),
  input("password", "Password", model.password, (value) => Message.ChangedPassword({ value }), h, "password"),
  button(register ? "Register" : "Log in", register ? Message.SubmittedRegister() : Message.SubmittedLogin(), h),
  button(register ? "Already have an account?" : "Create an account", register ? Message.ClickedLogin() : Message.ClickedRegister(), h, "secondary")
])

export const editorView = (model: Model, h: HtmlBuilder<MessageType>): Html => h.main([h.Class("narrow panel stack")], [
  h.h1([], [Option.isSome(model.editingPostId) ? "Edit post" : "Write a post"]),
  input("title", "Title", model.title, (value) => Message.ChangedTitle({ value }), h), input("excerpt", "Excerpt", model.excerpt, (value) => Message.ChangedExcerpt({ value }), h),
  textarea("body", "Body", model.body, (value) => Message.ChangedBody({ value }), h), input("tags", "Tags, comma separated", model.tags, (value) => Message.ChangedTags({ value }), h),
  h.label([h.Class("field")], [h.span([], ["Status"]), h.select([h.Value(model.postStatus), h.OnChange((value) => Message.SelectedPostStatus({ value: value === "Published" ? "Published" : "Draft" }))], [h.option([h.Value("Draft")], ["Draft"]), h.option([h.Value("Published")], ["Published"])])]),
  button("Save post", Message.SubmittedPost(), h)
])

export const adminView = (model: Model, h: HtmlBuilder<MessageType>): Html => Option.match(model.maybeAdmin, {
  onNone: () => h.main([h.Class("panel")], ["Loading administration…"]),
  onSome: (summary) => h.main([h.Class("stack")], [h.h1([], ["Administration"]), h.div([h.Class("stats")], [h.div([h.Class("stat")], [`${summary.users.length} users`]), h.div([h.Class("stat")], [`${summary.publishedPosts} published`]), h.div([h.Class("stat")], [`${summary.comments.length} comments`])]),
    h.section([h.Class("panel stack")], [h.h2([], ["Users"]), ...summary.users.map((user) => h.keyed("div")(user.id, [h.Class("admin-row")], [h.span([], [`${user.displayName} (@${user.username}) · ${user.role}`]), user.role === "Admin" ? h.empty : h.div([h.Class("actions")], [button(user.isSuspended ? "Reactivate" : "Suspend", Message.ClickedSuspendUser({ id: user.id, suspended: !user.isSuspended }), h, user.isSuspended ? "secondary" : "danger"), button(user.role === "Author" ? "Make reader" : "Make author", Message.ClickedSetRole({ id: user.id, role: user.role === "Author" ? "Reader" : "Author" }), h, "secondary")])]))]),
    h.section([h.Class("panel stack")], [h.h2([], ["Posts"]), ...summary.posts.map((post) => h.keyed("div")(post.id, [h.Class("admin-row")], [h.span([], [`${post.title} · ${post.status}`]), button(post.status === "Published" ? "Unpublish" : "Publish", Message.ClickedModeratePost({ id: post.id, status: post.status === "Published" ? "Draft" : "Published" }), h, "secondary")]))]),
    h.section([h.Class("panel stack")], [h.h2([], ["Comments"]), ...summary.comments.map((comment) => h.keyed("div")(comment.id, [h.Class("admin-row")], [h.span([], [comment.body]), button("Remove", Message.ClickedModerateComment({ id: comment.id }), h, "danger")]))])
  ])
})

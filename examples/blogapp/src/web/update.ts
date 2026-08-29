import { Option } from "effect"
import { type Update } from "foldkit"
import { evo } from "foldkit/struct"
import { type BlogClient } from "../client/blog-client.js"
import {
  AddComment, DeleteComment, LoadAdmin, LoadFeed, LoadPost, Login, ModerateComment, ModeratePost,
  Logout, Register, SavePost, SetRole, SetSuspended, ToggleUpvote
} from "./commands.js"
import { type Model } from "./model.js"
import { Message, type Message as MessageType } from "./message.js"

const token = (model: Model) => Option.map(model.maybeSession, (session) => session.accessToken)
const reloadPost = (model: Model) => Option.match(model.maybePost, {
  onNone: () => [], onSome: ({ post }) => [LoadPost({ slug: post.slug, maybeAccessToken: token(model) })]
})
const admin = (model: Model, make: (accessToken: string) => any) => Option.match(model.maybeSession, {
  onNone: () => ({ model: evo(model, { page: () => "Login" as const }) }),
  onSome: ({ accessToken }) => ({ model, commands: [make(accessToken)] })
})

export const update = (model: Model, message: MessageType) => Message.match<Update.Return<Model, MessageType, BlogClient>>(message, {
  ClickedFeed: () => ({ model: evo(model, { page: () => "Feed", loadState: () => "Loading", error: () => "" }), commands: [LoadFeed({ search: model.search })] }),
  ClickedLogin: () => ({ model: evo(model, { page: () => "Login", error: () => "" }) }),
  ClickedRegister: () => ({ model: evo(model, { page: () => "Register", error: () => "" }) }),
  ClickedEditor: () => Option.match(model.maybeSession, {
    onNone: () => ({ model: evo(model, { page: () => "Login" }) }),
    onSome: () => Option.match(model.maybePost, {
      onNone: () => ({ model: evo(model, { page: () => "Editor", editingPostId: () => Option.none(), title: () => "", excerpt: () => "", body: () => "", tags: () => "", postStatus: () => "Draft" }) }),
      onSome: ({ post }) => ({ model: evo(model, { page: () => "Editor", editingPostId: () => Option.some(post.id), title: () => post.title, excerpt: () => post.excerpt, body: () => post.body, tags: () => post.tags.join(", "), postStatus: () => post.status }) })
    })
  }),
  ClickedAdmin: () => admin(model, (accessToken) => LoadAdmin({ accessToken })),
  ClickedLogout: () => ({ model: evo(model, { maybeSession: () => Option.none(), maybePost: () => Option.none(), page: () => "Feed" }), commands: [Logout()] }),
  ClickedPost: ({ slug }) => ({ model: evo(model, { page: () => "Post", maybePost: () => Option.none(), loadState: () => "Loading", error: () => "" }), commands: [LoadPost({ slug, maybeAccessToken: token(model) })] }),
  ChangedSearch: ({ value }) => ({ model: evo(model, { search: () => value }) }), ChangedUsername: ({ value }) => ({ model: evo(model, { username: () => value }) }),
  ChangedDisplayName: ({ value }) => ({ model: evo(model, { displayName: () => value }) }), ChangedPassword: ({ value }) => ({ model: evo(model, { password: () => value }) }),
  ChangedTitle: ({ value }) => ({ model: evo(model, { title: () => value }) }), ChangedExcerpt: ({ value }) => ({ model: evo(model, { excerpt: () => value }) }),
  ChangedBody: ({ value }) => ({ model: evo(model, { body: () => value }) }), ChangedTags: ({ value }) => ({ model: evo(model, { tags: () => value }) }),
  ChangedComment: ({ value }) => ({ model: evo(model, { commentBody: () => value }) }), SelectedPostStatus: ({ value }) => ({ model: evo(model, { postStatus: () => value }) }),
  SubmittedSearch: () => ({ model: evo(model, { loadState: () => "Loading" }), commands: [LoadFeed({ search: model.search })] }),
  SubmittedLogin: () => ({ model: evo(model, { loadState: () => "Loading", error: () => "" }), commands: [Login({ username: model.username, password: model.password })] }),
  SubmittedRegister: () => ({ model: evo(model, { loadState: () => "Loading", error: () => "" }), commands: [Register({ username: model.username, displayName: model.displayName, password: model.password })] }),
  SubmittedPost: () => admin(model, (accessToken) => SavePost({ accessToken, id: model.editingPostId, title: model.title, excerpt: model.excerpt, body: model.body, tags: model.tags.split(",").map((x) => x.trim()).filter(Boolean), status: model.postStatus })),
  SubmittedComment: () => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => AddComment({ accessToken, postId: post.id, body: model.commentBody })) }),
  ClickedUpvote: () => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => ToggleUpvote({ accessToken, postId: post.id })) }),
  ClickedDeleteComment: ({ id }) => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => DeleteComment({ accessToken, id, postId: post.id })) }),
  ClickedSuspendUser: ({ id, suspended }) => admin(model, (accessToken) => SetSuspended({ accessToken, userId: id, suspended })),
  ClickedSetRole: ({ id, role }) => admin(model, (accessToken) => SetRole({ accessToken, userId: id, role })),
  ClickedModeratePost: ({ id, status }) => admin(model, (accessToken) => ModeratePost({ accessToken, postId: id, status })),
  ClickedModerateComment: ({ id }) => admin(model, (accessToken) => ModerateComment({ accessToken, commentId: id })),
  SucceededLoadFeed: ({ posts }) => ({ model: evo(model, { feed: () => posts, loadState: () => "Ready" }) }),
  SucceededLoadPost: ({ post }) => ({ model: evo(model, { maybePost: () => Option.some(post), loadState: () => "Ready" }) }),
  SucceededLogin: ({ session }) => ({ model: evo(model, { maybeSession: () => Option.some(session), page: () => "Feed", password: () => "", loadState: () => "Loading" }), commands: [LoadFeed({ search: model.search })] }),
  CompletedRestoreSession: ({ maybeSession }) => ({ model: evo(model, { maybeSession: () => maybeSession }) }),
  CompletedLogout: () => ({ model }),
  SucceededSavePost: () => ({ model: evo(model, { page: () => "Feed", editingPostId: () => Option.none(), title: () => "", excerpt: () => "", body: () => "", tags: () => "", loadState: () => "Loading" }), commands: [LoadFeed({ search: "" })] }),
  SucceededAddComment: () => ({ model: evo(model, { commentBody: () => "" }), commands: reloadPost(model) }),
  SucceededToggleUpvote: () => ({ model, commands: reloadPost(model) }), SucceededDeleteComment: () => ({ model, commands: reloadPost(model) }),
  SucceededLoadAdmin: ({ summary }) => ({ model: evo(model, { maybeAdmin: () => Option.some(summary), page: () => "Admin", loadState: () => "Ready" }) }),
  SucceededUpdateAdmin: ({ summary }) => ({ model: evo(model, { maybeAdmin: () => Option.some(summary), loadState: () => "Ready" }) }),
  FailedRequest: ({ error }) => ({ model: evo(model, { error: () => error, loadState: () => "Failed" }) })
})

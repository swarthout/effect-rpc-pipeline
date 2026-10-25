import { Option } from "effect"
import { type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
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
  onNone: () => ({ model: modifyFields(model, { page: () => "Login" as const }) }),
  onSome: ({ accessToken }) => ({ model, commands: [make(accessToken)] })
})

export const update = (model: Model, message: MessageType) => Message.match<Update.Return<Model, MessageType, BlogClient>>(message, {
  ClickedFeed: () => ({ model: modifyFields(model, { page: () => "Feed", loadState: () => "Loading", error: () => "" }), commands: [LoadFeed({ search: model.search })] }),
  ClickedLogin: () => ({ model: modifyFields(model, { page: () => "Login", error: () => "" }) }),
  ClickedRegister: () => ({ model: modifyFields(model, { page: () => "Register", error: () => "" }) }),
  ClickedEditor: () => Option.match(model.maybeSession, {
    onNone: () => ({ model: modifyFields(model, { page: () => "Login" }) }),
    onSome: () => Option.match(model.maybePost, {
      onNone: () => ({ model: modifyFields(model, { page: () => "Editor", editingPostId: () => Option.none(), title: () => "", excerpt: () => "", body: () => "", tags: () => "", postStatus: () => "Draft" }) }),
      onSome: ({ post }) => ({ model: modifyFields(model, { page: () => "Editor", editingPostId: () => Option.some(post.id), title: () => post.title, excerpt: () => post.excerpt, body: () => post.body, tags: () => post.tags.join(", "), postStatus: () => post.status }) })
    })
  }),
  ClickedAdmin: () => admin(model, (accessToken) => LoadAdmin({ accessToken })),
  ClickedLogout: () => ({ model: modifyFields(model, { maybeSession: () => Option.none(), maybePost: () => Option.none(), page: () => "Feed" }), commands: [Logout()] }),
  ClickedPost: ({ slug }) => ({ model: modifyFields(model, { page: () => "Post", maybePost: () => Option.none(), loadState: () => "Loading", error: () => "" }), commands: [LoadPost({ slug, maybeAccessToken: token(model) })] }),
  ChangedSearch: ({ value }) => ({ model: modifyFields(model, { search: () => value }) }), ChangedUsername: ({ value }) => ({ model: modifyFields(model, { username: () => value }) }),
  ChangedDisplayName: ({ value }) => ({ model: modifyFields(model, { displayName: () => value }) }), ChangedPassword: ({ value }) => ({ model: modifyFields(model, { password: () => value }) }),
  ChangedTitle: ({ value }) => ({ model: modifyFields(model, { title: () => value }) }), ChangedExcerpt: ({ value }) => ({ model: modifyFields(model, { excerpt: () => value }) }),
  ChangedBody: ({ value }) => ({ model: modifyFields(model, { body: () => value }) }), ChangedTags: ({ value }) => ({ model: modifyFields(model, { tags: () => value }) }),
  ChangedComment: ({ value }) => ({ model: modifyFields(model, { commentBody: () => value }) }), SelectedPostStatus: ({ value }) => ({ model: modifyFields(model, { postStatus: () => value }) }),
  SubmittedSearch: () => ({ model: modifyFields(model, { loadState: () => "Loading" }), commands: [LoadFeed({ search: model.search })] }),
  SubmittedLogin: () => ({ model: modifyFields(model, { loadState: () => "Loading", error: () => "" }), commands: [Login({ username: model.username, password: model.password })] }),
  SubmittedRegister: () => ({ model: modifyFields(model, { loadState: () => "Loading", error: () => "" }), commands: [Register({ username: model.username, displayName: model.displayName, password: model.password })] }),
  SubmittedPost: () => admin(model, (accessToken) => SavePost({ accessToken, id: model.editingPostId, title: model.title, excerpt: model.excerpt, body: model.body, tags: model.tags.split(",").map((x) => x.trim()).filter(Boolean), status: model.postStatus })),
  SubmittedComment: () => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => AddComment({ accessToken, postId: post.id, body: model.commentBody })) }),
  ClickedUpvote: () => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => ToggleUpvote({ accessToken, postId: post.id })) }),
  ClickedDeleteComment: ({ id }) => Option.match(model.maybePost, { onNone: () => ({ model }), onSome: ({ post }) => admin(model, (accessToken) => DeleteComment({ accessToken, id, postId: post.id })) }),
  ClickedSuspendUser: ({ id, suspended }) => admin(model, (accessToken) => SetSuspended({ accessToken, userId: id, suspended })),
  ClickedSetRole: ({ id, role }) => admin(model, (accessToken) => SetRole({ accessToken, userId: id, role })),
  ClickedModeratePost: ({ id, status }) => admin(model, (accessToken) => ModeratePost({ accessToken, postId: id, status })),
  ClickedModerateComment: ({ id }) => admin(model, (accessToken) => ModerateComment({ accessToken, commentId: id })),
  SucceededLoadFeed: ({ posts }) => ({ model: modifyFields(model, { feed: () => posts, loadState: () => "Ready" }) }),
  SucceededLoadPost: ({ post }) => ({ model: modifyFields(model, { maybePost: () => Option.some(post), loadState: () => "Ready" }) }),
  SucceededLogin: ({ session }) => ({ model: modifyFields(model, { maybeSession: () => Option.some(session), page: () => "Feed", password: () => "", loadState: () => "Loading" }), commands: [LoadFeed({ search: model.search })] }),
  CompletedRestoreSession: ({ maybeSession }) => ({ model: modifyFields(model, { maybeSession: () => maybeSession }) }),
  CompletedLogout: () => ({ model }),
  SucceededSavePost: () => ({ model: modifyFields(model, { page: () => "Feed", editingPostId: () => Option.none(), title: () => "", excerpt: () => "", body: () => "", tags: () => "", loadState: () => "Loading" }), commands: [LoadFeed({ search: "" })] }),
  SucceededAddComment: () => ({ model: modifyFields(model, { commentBody: () => "" }), commands: reloadPost(model) }),
  SucceededToggleUpvote: () => ({ model, commands: reloadPost(model) }), SucceededDeleteComment: () => ({ model, commands: reloadPost(model) }),
  SucceededLoadAdmin: ({ summary }) => ({ model: modifyFields(model, { maybeAdmin: () => Option.some(summary), page: () => "Admin", loadState: () => "Ready" }) }),
  SucceededUpdateAdmin: ({ summary }) => ({ model: modifyFields(model, { maybeAdmin: () => Option.some(summary), loadState: () => "Ready" }) }),
  FailedRequest: ({ error }) => ({ model: modifyFields(model, { error: () => error, loadState: () => "Failed" }) })
})

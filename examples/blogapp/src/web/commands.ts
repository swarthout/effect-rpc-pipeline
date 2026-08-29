import { Effect, Option, Schema as S } from "effect"
import { Command } from "foldkit"
import { makeHttpClient } from "../client/blog-client.js"
import { Message } from "./message.js"

const failed = (error: unknown) => Message.FailedRequest({ error: String(error) })
const safely = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
  Effect.catch((error) => Effect.succeed(failed(error))),
  Effect.scoped
)

export const LoadFeed = Command.define("LoadFeed", {
  args: { search: S.String }, messages: [Message.SucceededLoadFeed, Message.FailedRequest],
  execute: ({ search }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient()
    return Message.SucceededLoadFeed({ posts: yield* client.feed(search) })
  }))
})

export const LoadPost = Command.define("LoadPost", {
  args: { slug: S.String, maybeAccessToken: S.Option(S.String) }, messages: [Message.SucceededLoadPost, Message.FailedRequest],
  execute: ({ slug, maybeAccessToken }) => safely(Effect.gen(function*() {
    const token = Option.getOrUndefined(maybeAccessToken)
    const client = yield* makeHttpClient("/rpc", token)
    return Message.SucceededLoadPost({ post: yield* token === undefined ? client.post(slug) : client.viewerPost(slug) })
  }))
})

export const Login = Command.define("Login", {
  args: { username: S.String, password: S.String }, messages: [Message.SucceededLogin, Message.FailedRequest],
  execute: (input) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient()
    return Message.SucceededLogin({ session: yield* client.login(input) })
  }))
})

export const Register = Command.define("Register", {
  args: { username: S.String, displayName: S.String, password: S.String }, messages: [Message.SucceededLogin, Message.FailedRequest],
  execute: (input) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient()
    return Message.SucceededLogin({ session: yield* client.register(input) })
  }))
})

const postArgs = {
  accessToken: S.String, id: S.Option(S.String), title: S.String, excerpt: S.String, body: S.String,
  tags: S.Array(S.String), status: S.Literals(["Draft", "Published"])
}
export const SavePost = Command.define("SavePost", {
  args: postArgs, messages: [Message.SucceededSavePost, Message.FailedRequest],
  execute: ({ accessToken, id, ...input }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    yield* Option.match(id, { onNone: () => client.createPost(input), onSome: (postId) => client.updatePost({ id: postId, ...input }) })
    return Message.SucceededSavePost()
  }))
})

export const AddComment = Command.define("AddComment", {
  args: { accessToken: S.String, postId: S.String, body: S.String }, messages: [Message.SucceededAddComment, Message.FailedRequest],
  execute: ({ accessToken, postId, body }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken); yield* client.comment(postId, body)
    return Message.SucceededAddComment()
  }))
})

export const ToggleUpvote = Command.define("ToggleUpvote", {
  args: { accessToken: S.String, postId: S.String }, messages: [Message.SucceededToggleUpvote, Message.FailedRequest],
  execute: ({ accessToken, postId }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken); yield* client.toggleUpvote(postId)
    return Message.SucceededToggleUpvote()
  }))
})

export const DeleteComment = Command.define("DeleteComment", {
  args: { accessToken: S.String, id: S.String, postId: S.String }, messages: [Message.SucceededDeleteComment, Message.FailedRequest],
  execute: ({ accessToken, id, postId }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken); yield* client.deleteComment(id, postId)
    return Message.SucceededDeleteComment()
  }))
})

export const LoadAdmin = Command.define("LoadAdmin", {
  args: { accessToken: S.String }, messages: [Message.SucceededLoadAdmin, Message.FailedRequest],
  execute: ({ accessToken }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    return Message.SucceededLoadAdmin({ summary: yield* client.admin() })
  }))
})

export const SetSuspended = Command.define("SetSuspended", {
  args: { accessToken: S.String, userId: S.String, suspended: S.Boolean }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, userId, suspended }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    return Message.SucceededUpdateAdmin({ summary: yield* client.setSuspended(userId, suspended) })
  }))
})
export const SetRole = Command.define("SetRole", {
  args: { accessToken: S.String, userId: S.String, role: S.Literals(["Reader", "Author", "Admin"]) }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, userId, role }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    return Message.SucceededUpdateAdmin({ summary: yield* client.setRole(userId, role) })
  }))
})
export const ModeratePost = Command.define("ModeratePost", {
  args: { accessToken: S.String, postId: S.String, status: S.Literals(["Draft", "Published"]) }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, postId, status }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    return Message.SucceededUpdateAdmin({ summary: yield* client.moderatePost(postId, status) })
  }))
})
export const ModerateComment = Command.define("ModerateComment", {
  args: { accessToken: S.String, commentId: S.String }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, commentId }) => safely(Effect.gen(function*() {
    const client = yield* makeHttpClient("/rpc", accessToken)
    return Message.SucceededUpdateAdmin({ summary: yield* client.moderateComment(commentId) })
  }))
})

import { Effect, Option, Schema as S } from "effect"
import { Command } from "foldkit"
import { BlogClient, loginSession, logoutSession, refreshSession, registerSession, withAccessToken } from "../client/blog-client.js"
import { Message } from "./message.js"

const failed = (error: unknown) => Message.FailedRequest({ error: String(error) })
const safely = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
  Effect.catch((error) => Effect.succeed(failed(error))),
  Effect.scoped
)

export const LoadFeed = Command.define("LoadFeed", {
  args: { search: S.String }, messages: [Message.SucceededLoadFeed, Message.FailedRequest],
  execute: ({ search }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededLoadFeed({ posts: yield* client.feed(search) })
  }))
})

export const LoadPost = Command.define("LoadPost", {
  args: { slug: S.String, maybeAccessToken: S.Option(S.String) }, messages: [Message.SucceededLoadPost, Message.FailedRequest],
  execute: ({ slug, maybeAccessToken }) => safely(Effect.gen(function*() {
    const token = Option.getOrUndefined(maybeAccessToken)
    const client = yield* BlogClient
    const post = token === undefined
      ? client.post(slug)
      : withAccessToken(client.viewerPost(slug), token)
    return Message.SucceededLoadPost({ post: yield* post })
  }))
})

export const Login = Command.define("Login", {
  args: { username: S.String, password: S.String }, messages: [Message.SucceededLogin, Message.FailedRequest],
  execute: (input) => safely(Effect.map(loginSession(input), (session) => Message.SucceededLogin({ session })))
})

export const Register = Command.define("Register", {
  args: { username: S.String, displayName: S.String, password: S.String }, messages: [Message.SucceededLogin, Message.FailedRequest],
  execute: (input) => safely(Effect.map(registerSession(input), (session) => Message.SucceededLogin({ session })))
})

export const RestoreSession = Command.define("RestoreSession", {
  messages: [Message.CompletedRestoreSession],
  execute: refreshSession.pipe(
    Effect.option,
    Effect.map((maybeSession) => Message.CompletedRestoreSession({ maybeSession }))
  )
})

export const Logout = Command.define("Logout", {
  messages: [Message.CompletedLogout],
  execute: logoutSession.pipe(
    Effect.ignore,
    Effect.as(Message.CompletedLogout())
  )
})

const postArgs = {
  accessToken: S.String, id: S.Option(S.String), title: S.String, excerpt: S.String, body: S.String,
  tags: S.Array(S.String), status: S.Literals(["Draft", "Published"])
}
export const SavePost = Command.define("SavePost", {
  args: postArgs, messages: [Message.SucceededSavePost, Message.FailedRequest],
  execute: ({ accessToken, id, ...input }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    const save = Option.match(id, {
      onNone: () => Effect.asVoid(client.createPost(input)),
      onSome: (postId) => Effect.asVoid(client.updatePost({ id: postId, ...input }))
    })
    yield* withAccessToken(save, accessToken)
    return Message.SucceededSavePost()
  }))
})

export const AddComment = Command.define("AddComment", {
  args: { accessToken: S.String, postId: S.String, body: S.String }, messages: [Message.SucceededAddComment, Message.FailedRequest],
  execute: ({ accessToken, postId, body }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient; yield* withAccessToken(client.comment(postId, body), accessToken)
    return Message.SucceededAddComment()
  }))
})

export const ToggleUpvote = Command.define("ToggleUpvote", {
  args: { accessToken: S.String, postId: S.String }, messages: [Message.SucceededToggleUpvote, Message.FailedRequest],
  execute: ({ accessToken, postId }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient; yield* withAccessToken(client.toggleUpvote(postId), accessToken)
    return Message.SucceededToggleUpvote()
  }))
})

export const DeleteComment = Command.define("DeleteComment", {
  args: { accessToken: S.String, id: S.String, postId: S.String }, messages: [Message.SucceededDeleteComment, Message.FailedRequest],
  execute: ({ accessToken, id, postId }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient; yield* withAccessToken(client.deleteComment(id, postId), accessToken)
    return Message.SucceededDeleteComment()
  }))
})

export const LoadAdmin = Command.define("LoadAdmin", {
  args: { accessToken: S.String }, messages: [Message.SucceededLoadAdmin, Message.FailedRequest],
  execute: ({ accessToken }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededLoadAdmin({ summary: yield* withAccessToken(client.admin(), accessToken) })
  }))
})

export const SetSuspended = Command.define("SetSuspended", {
  args: { accessToken: S.String, userId: S.String, suspended: S.Boolean }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, userId, suspended }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededUpdateAdmin({ summary: yield* withAccessToken(client.setSuspended(userId, suspended), accessToken) })
  }))
})
export const SetRole = Command.define("SetRole", {
  args: { accessToken: S.String, userId: S.String, role: S.Literals(["Reader", "Author", "Admin"]) }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, userId, role }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededUpdateAdmin({ summary: yield* withAccessToken(client.setRole(userId, role), accessToken) })
  }))
})
export const ModeratePost = Command.define("ModeratePost", {
  args: { accessToken: S.String, postId: S.String, status: S.Literals(["Draft", "Published"]) }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, postId, status }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededUpdateAdmin({ summary: yield* withAccessToken(client.moderatePost(postId, status), accessToken) })
  }))
})
export const ModerateComment = Command.define("ModerateComment", {
  args: { accessToken: S.String, commentId: S.String }, messages: [Message.SucceededUpdateAdmin, Message.FailedRequest],
  execute: ({ accessToken, commentId }) => safely(Effect.gen(function*() {
    const client = yield* BlogClient
    return Message.SucceededUpdateAdmin({ summary: yield* withAccessToken(client.moderateComment(commentId), accessToken) })
  }))
})

import * as Effect from "effect/Effect"
import {
  AuthorSession, CurrentUser, Forbidden, NotificationSink, type PostStatus, type Principal
} from "../../shared/contracts.js"
import { requireScope } from "../authorization.js"
import { BlogDatabase } from "../database.js"

type EventPublisher = ReturnType<typeof import("../events.js").makeEvents>
type PostInput = { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }
type NotificationSinkInstance = typeof NotificationSink.schema.Type

export const makeContentHandlers = Effect.fn("makeContentHandlers")(function*(events: EventPublisher) {
  const database = yield* BlogDatabase
  const canManagePost = Effect.fn("canManagePost")(function*(principal: Principal, postId: string) {
    const post = yield* database.getPostById(postId)
    if (post.authorId !== principal.id && principal.role !== "Admin") return yield* new Forbidden({ action: "manage post" })
    return post
  })
  return {
    me: () => Effect.flatMap(CurrentUser, (principal) => database.getUser(principal.id)),
    myPosts: () => Effect.flatMap(CurrentUser, (principal) => database.listPostsByAuthor(principal.id)),
    createPost: (input: PostInput) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireScope(principal, "posts:write", "create post")
      const post = yield* database.createPost(principal.id, input)
      yield* events.publish("PostChanged", post.id, `${principal.username} created ${post.title}`)
      return post
    }),
    updatePost: ({ id, ...input }: PostInput & { readonly id: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireScope(principal, "posts:write", "update post"); yield* canManagePost(principal, id)
      const post = yield* database.updatePost(id, input)
      yield* events.publish("PostChanged", post.id, `${principal.username} updated ${post.title}`)
      return post
    }),
    deletePost: ({ id }: { id: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* canManagePost(principal, id)
      const removed = yield* database.deletePost(id); yield* events.publish("Moderated", id, `${principal.username} deleted a post`)
      return removed
    }),
    addComment: ({ postId, body }: { postId: string; body: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireScope(principal, "comments:write", "comment")
      const comment = yield* database.createComment(postId, principal.id, body)
      yield* events.publish("CommentAdded", postId, `${principal.username} commented`)
      return comment
    }),
    deleteComment: ({ id }: { id: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; const comment = yield* database.getComment(id)
      if (comment.authorId !== principal.id && principal.role !== "Admin") return yield* new Forbidden({ action: "delete comment" })
      const removed = yield* database.deleteComment(id); yield* events.publish("CommentDeleted", comment.postId, `${principal.username} deleted a comment`)
      return removed
    }),
    toggleUpvote: ({ postId }: { postId: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireScope(principal, "votes:write", "upvote")
      const upvoted = yield* database.toggleVote(postId, principal.id)
      yield* events.publish("VoteChanged", postId, `${principal.username} ${upvoted ? "upvoted" : "removed an upvote"}`)
      return upvoted
    }),
    hasUpvoted: ({ postId }: { postId: string }) => Effect.flatMap(CurrentUser, (principal) => database.hasUpvoted(postId, principal.id)),
    canDeleteComment: ({ commentId }: { commentId: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; const comment = yield* database.getComment(commentId)
      return comment.authorId === principal.id || principal.role === "Admin"
    }),
    openAuthorSession: ({ postId }: { postId: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* canManagePost(principal, postId)
      return yield* AuthorSession.fromHandlers({
        save: (input) => Effect.gen(function*() {
          yield* canManagePost(principal, postId); const current = yield* database.getPostById(postId)
          const post = yield* database.updatePost(postId, { ...input, status: current.status })
          yield* events.publish("PostChanged", postId, `${principal.username} saved ${post.title}`); return post
        }),
        publish: () => Effect.gen(function*() {
          yield* canManagePost(principal, postId); const current = yield* database.getPostById(postId)
          const post = yield* database.updatePost(postId, { ...current, status: "Published" })
          yield* events.publish("PostChanged", postId, `${principal.username} published ${post.title}`); return post
        }),
        remove: () => Effect.gen(function*() {
          yield* canManagePost(principal, postId); const removed = yield* database.deletePost(postId)
          yield* events.publish("Moderated", postId, `${principal.username} deleted a post`); return removed
        })
      })
    }),
    registerNotificationSink: ({ sink }: { sink: NotificationSinkInstance }) => Effect.gen(function*() {
      const principal = yield* CurrentUser
      return yield* sink.notify({ event: events.make("PostChanged", "welcome", `Notifications connected for ${principal.username}`) })
    })
  }
})

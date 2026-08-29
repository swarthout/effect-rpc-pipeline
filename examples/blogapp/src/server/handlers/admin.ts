import * as Effect from "effect/Effect"
import * as PipelineSql from "effect-rpc-pipeline/Sql"
import { CurrentUser, Forbidden, type PostStatus, type Role } from "../../shared/contracts.js"
import { requireAdmin } from "../authorization.js"
import { BlogDatabase } from "../database.js"
type EventPublisher = ReturnType<typeof import("../events.js").makeEvents>

export const makeAdminHandlers = Effect.fn("makeAdminHandlers")(function*(events: EventPublisher) {
  const database = yield* BlogDatabase
  return {
    adminSummary: () => Effect.gen(function*() { yield* requireAdmin(yield* CurrentUser); return yield* database.adminSummary }),
    setUserSuspended: ({ userId, suspended }: { userId: string; suspended: boolean }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireAdmin(principal)
      if (principal.id === userId) return yield* new Forbidden({ action: "suspend self" })
      return yield* database.updateUser(userId, { isSuspended: suspended })
    }),
    setUserRole: ({ userId, role }: { userId: string; role: Role }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireAdmin(principal)
      if (principal.id === userId) return yield* new Forbidden({ action: "change own role" })
      return yield* database.updateUser(userId, { role })
    }),
    moderatePost: ({ postId, status }: { postId: string; status: PostStatus }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireAdmin(principal)
      const post = yield* database.getPostById(postId)
      const updated = yield* database.updatePost(postId, { ...post, status })
      yield* PipelineSql.afterCommit(events.publish("Moderated", postId, `${principal.username} changed post status`))
      return updated
    }),
    moderateComment: ({ commentId }: { commentId: string }) => Effect.gen(function*() {
      const principal = yield* CurrentUser; yield* requireAdmin(principal)
      const comment = yield* database.getComment(commentId)
      const removed = yield* database.deleteComment(commentId)
      yield* PipelineSql.afterCommit(events.publish("Moderated", comment.postId, `${principal.username} moderated a comment`))
      return removed
    })
  }
})

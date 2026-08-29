import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import {
  BlogEvent
} from "../../shared/contracts.js"
import { BlogDatabase } from "../database.js"
import { BlogLookups } from "../lookups.js"
import { SessionService } from "../sessions.js"

export const makePublicHandlers = Effect.fn("makePublicHandlers")(function*(changes: PubSub.PubSub<BlogEvent>) {
  const database = yield* BlogDatabase
  const lookups = yield* BlogLookups
  const sessions = yield* SessionService
  return {
    health: () => Effect.succeed("ok"),
    register: (input: { username: string; displayName: string; password: string }) => Effect.map(sessions.register(input), ({ tokens }) => tokens),
    login: (input: { username: string; password: string }) => Effect.map(sessions.login(input), ({ tokens }) => tokens),
    refresh: ({ refreshToken }: { refreshToken: string }) => Effect.map(sessions.refresh(refreshToken), ({ tokens }) => tokens),
    listPosts: (input: Parameters<typeof database.listPublishedPosts>[0]) => database.listPublishedPosts(input),
    getPost: ({ slug }: { slug: string }) => database.getPublishedPostBySlug(slug),
    getUser: ({ id }: { id: string }) => lookups.userById(id),
    listComments: ({ postId }: { postId: string }) => database.listComments(postId),
    watchPost: ({ postId }: { postId: string }) => Stream.fromPubSub(changes).pipe(Stream.filter((change) => change.postId === postId))
  }
})

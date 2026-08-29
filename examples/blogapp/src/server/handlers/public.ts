import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import {
  BlogEvent
} from "../../shared/contracts.js"
import { BlogDatabase } from "../database.js"
import { SessionService } from "../sessions.js"
import { makeUserLookup } from "../user-batching.js"

export const makePublicHandlers = Effect.fn("makePublicHandlers")(function*(changes: PubSub.PubSub<BlogEvent>) {
  const database = yield* BlogDatabase
  const sessions = yield* SessionService
  const getUser = yield* makeUserLookup
  return {
    health: () => Effect.succeed("ok"),
    register: (input: { username: string; displayName: string; password: string }) => Effect.map(sessions.register(input), ({ tokens }) => tokens),
    login: (input: { username: string; password: string }) => Effect.map(sessions.login(input), ({ tokens }) => tokens),
    refresh: ({ refreshToken }: { refreshToken: string }) => Effect.map(sessions.refresh(refreshToken), ({ tokens }) => tokens),
    listPosts: (input: Parameters<typeof database.listPublishedPosts>[0]) => database.listPublishedPosts(input),
    getPost: ({ slug }: { slug: string }) => database.getPublishedPostBySlug(slug),
    getUser: ({ id }: { id: string }) => getUser(id),
    listComments: ({ postId }: { postId: string }) => database.listComments(postId),
    watchPost: ({ postId }: { postId: string }) => Stream.fromPubSub(changes).pipe(Stream.filter((change) => change.postId === postId))
  }
})

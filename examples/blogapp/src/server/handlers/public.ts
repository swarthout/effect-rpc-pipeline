import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import {
  AuthTokens, BlogEvent, InvalidInput, Suspended, Unauthorized, type User
} from "../../shared/contracts.js"
import { principalFor } from "../authorization.js"
import { BlogDatabase } from "../database.js"
import { hashPassword, tokenDigest, TokenService, verifyPassword } from "../security.js"
import { makeUserLookup } from "../user-batching.js"

export const makePublicHandlers = Effect.fn("makePublicHandlers")(function*(changes: PubSub.PubSub<BlogEvent>) {
  const database = yield* BlogDatabase
  const tokens = yield* TokenService
  const getUser = yield* makeUserLookup
  const issueTokens = Effect.fn("issueTokens")(function*(user: User, family = randomUUID()) {
    const access = yield* tokens.issueAccess(principalFor(user))
    const refresh = yield* tokens.issueRefresh(user.id, family)
    yield* database.saveRefreshToken({ digest: tokenDigest(refresh.token), family, userId: user.id, expiresAt: refresh.expiresAt })
    return new AuthTokens({ accessToken: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt, user })
  })
  return {
    health: () => Effect.succeed("ok"),
    register: ({ username, displayName, password }: { username: string; displayName: string; password: string }) => Effect.gen(function*() {
      if (password.length < 10) return yield* new InvalidInput({ field: "password", message: "Use at least ten characters" })
      const user = yield* database.createUser({ username, displayName, passwordHash: yield* hashPassword(password) })
      return yield* issueTokens(user)
    }),
    login: ({ username, password }: { username: string; password: string }) => Effect.gen(function*() {
      const record = yield* database.findUserByUsername(username).pipe(Effect.mapError(() => new Unauthorized({ reason: "Invalid username or password" })))
      if (record.user.isSuspended) return yield* new Suspended()
      if (!(yield* verifyPassword(password, record.passwordHash))) return yield* new Unauthorized({ reason: "Invalid username or password" })
      return yield* issueTokens(record.user)
    }),
    refresh: ({ refreshToken }: { refreshToken: string }) => Effect.gen(function*() {
      const claims = yield* tokens.verifyRefresh(refreshToken)
      const user = yield* database.getUser(claims.userId).pipe(Effect.mapError(() => new Unauthorized({ reason: "Refresh principal no longer exists" })))
      if (user.isSuspended) return yield* new Suspended()
      const access = yield* tokens.issueAccess(principalFor(user))
      const next = yield* tokens.issueRefresh(user.id, claims.family)
      yield* database.rotateRefreshToken(tokenDigest(refreshToken), { digest: tokenDigest(next.token), family: claims.family, userId: user.id, expiresAt: next.expiresAt })
        .pipe(Effect.mapError(() => new Unauthorized({ reason: "Refresh token was already used" })))
      return new AuthTokens({ accessToken: access.token, refreshToken: next.token, expiresAt: access.expiresAt, user })
    }),
    listPosts: (input: Parameters<typeof database.listPublishedPosts>[0]) => database.listPublishedPosts(input),
    getPost: ({ slug }: { slug: string }) => database.getPublishedPostBySlug(slug),
    getUser: ({ id }: { id: string }) => getUser(id),
    listComments: ({ postId }: { postId: string }) => database.listComments(postId),
    watchPost: ({ postId }: { postId: string }) => Stream.fromPubSub(changes).pipe(Stream.filter((change) => change.postId === postId))
  }
})

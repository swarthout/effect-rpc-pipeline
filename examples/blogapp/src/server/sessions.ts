import { randomUUID } from "node:crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { AuthTokens, Conflict, InvalidInput, Suspended, Unauthorized, type User } from "../shared/contracts.js"
import { principalFor } from "./authorization.js"
import { BlogDatabase } from "./database.js"
import { hashPassword, tokenDigest, TokenService, verifyPassword } from "./security.js"

export type IssuedSession = {
  readonly tokens: AuthTokens
  readonly refreshExpiresAt: number
}

export class SessionService extends Context.Service<SessionService, {
  readonly register: (input: { readonly username: string; readonly displayName: string; readonly password: string }) => Effect.Effect<IssuedSession, Conflict | InvalidInput>
  readonly login: (input: { readonly username: string; readonly password: string }) => Effect.Effect<IssuedSession, Unauthorized | Suspended>
  readonly refresh: (refreshToken: string) => Effect.Effect<IssuedSession, Unauthorized | Suspended>
  readonly logout: (refreshToken: string) => Effect.Effect<void>
}>()("blog/SessionService") {}

export const SessionServiceLive = Layer.effect(SessionService, Effect.gen(function*() {
  const database = yield* BlogDatabase
  const tokenService = yield* TokenService

  const issue = Effect.fn("SessionService.issue")(function*(user: User, family = randomUUID()) {
    const access = yield* tokenService.issueAccess(principalFor(user))
    const refresh = yield* tokenService.issueRefresh(user.id, family)
    yield* database.saveRefreshToken({
      digest: tokenDigest(refresh.token),
      family,
      userId: user.id,
      expiresAt: refresh.expiresAt
    })
    return {
      tokens: new AuthTokens({ accessToken: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt, user }),
      refreshExpiresAt: refresh.expiresAt
    }
  })

  return SessionService.of({
    register: Effect.fn("SessionService.register")(function*({ username, displayName, password }) {
      if (password.length < 10 || password.length > 1024) {
        return yield* new InvalidInput({ field: "password", message: "Use between ten and 1024 characters" })
      }
      if (username.trim().length < 3 || username.length > 64) return yield* new InvalidInput({ field: "username", message: "Use between three and 64 characters" })
      if (displayName.trim().length === 0 || displayName.length > 120) return yield* new InvalidInput({ field: "displayName", message: "Use between one and 120 characters" })
      const user = yield* database.createUser({ username, displayName, passwordHash: yield* hashPassword(password) })
      return yield* issue(user)
    }),
    login: Effect.fn("SessionService.login")(function*({ username, password }) {
      if (password.length > 1024 || username.length > 64) return yield* new Unauthorized({ reason: "Invalid username or password" })
      const record = yield* database.findUserByUsername(username).pipe(
        Effect.mapError(() => new Unauthorized({ reason: "Invalid username or password" }))
      )
      if (record.user.isSuspended) {
        return yield* new Suspended()
      }
      if (!(yield* verifyPassword(password, record.passwordHash))) {
        return yield* new Unauthorized({ reason: "Invalid username or password" })
      }
      return yield* issue(record.user)
    }),
    refresh: Effect.fn("SessionService.refresh")(function*(refreshToken) {
      const claims = yield* tokenService.verifyRefresh(refreshToken)
      const user = yield* database.getUser(claims.userId).pipe(
        Effect.mapError(() => new Unauthorized({ reason: "Refresh principal no longer exists" }))
      )
      if (user.isSuspended) {
        return yield* new Suspended()
      }
      const access = yield* tokenService.issueAccess(principalFor(user))
      const next = yield* tokenService.issueRefresh(user.id, claims.family)
      yield* database.rotateRefreshToken(tokenDigest(refreshToken), {
        digest: tokenDigest(next.token),
        family: claims.family,
        userId: user.id,
        expiresAt: next.expiresAt
      }).pipe(Effect.mapError(() => new Unauthorized({ reason: "Refresh token was already used" })))
      return {
        tokens: new AuthTokens({ accessToken: access.token, refreshToken: next.token, expiresAt: access.expiresAt, user }),
        refreshExpiresAt: next.expiresAt
      }
    }),
    logout: (refreshToken) => database.revokeRefreshToken(tokenDigest(refreshToken))
  })
}))

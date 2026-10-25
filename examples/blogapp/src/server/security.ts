import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { jwtVerify, SignJWT } from "jose"
import { Suspended, Unauthorized, type Principal, type Role } from "../shared/contracts.js"

const scrypt = promisify(nodeScrypt)
const issuer = "https://pipeline-press.local"
const audience = "pipeline-press-api"
const accessLifetimeSeconds = 15 * 60
const refreshLifetimeSeconds = 30 * 24 * 60 * 60

export const hashPassword = Effect.fn("hashPassword")(function*(password: string) {
  const salt = randomBytes(16).toString("hex")
  const derived = yield* Effect.tryPromise({
    try: () => scrypt(password, salt, 64) as Promise<Buffer>,
    catch: (cause) => cause
  }).pipe(Effect.orDie)
  return `${salt}:${derived.toString("hex")}`
})

export const verifyPassword = Effect.fn("verifyPassword")(function*(password: string, encoded: string) {
  const separator = encoded.indexOf(":")
  if (separator < 1) return false
  const salt = encoded.slice(0, separator)
  const expected = Buffer.from(encoded.slice(separator + 1), "hex")
  const actual = yield* Effect.tryPromise({
    try: () => scrypt(password, salt, expected.length) as Promise<Buffer>,
    catch: () => new Unauthorized({ reason: "Invalid username or password" })
  })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
})

export const tokenDigest = (token: string): string => createHash("sha256").update(token).digest("hex")

export class TokenService extends Context.Service<TokenService, {
  readonly issueAccess: (principal: Principal) => Effect.Effect<{ readonly token: string; readonly expiresAt: number }>
  readonly issueRefresh: (userId: string, family: string) => Effect.Effect<{ readonly token: string; readonly expiresAt: number }>
  readonly verifyAccess: (token: Redacted.Redacted<string>) => Effect.Effect<Principal, Unauthorized | Suspended>
  readonly verifyRefresh: (token: string) => Effect.Effect<{ readonly userId: string; readonly family: string }, Unauthorized>
}>()("blog/TokenService") {}

export const makeTokenServiceLayer = (secret = process.env.BLOG_JWT_SECRET ?? "pipeline-press-development-secret-at-least-32-bytes") => {
  if (process.env.NODE_ENV === "production" && (process.env.BLOG_JWT_SECRET === undefined || new TextEncoder().encode(secret).length < 32)) {
    throw new Error("Production requires BLOG_JWT_SECRET with at least 32 bytes")
  }
  return Layer.effect(
  TokenService,
  Effect.gen(function*() {
    const key = new TextEncoder().encode(secret)
    const issueAccess = Effect.fn("TokenService.issueAccess")(function*(principal: Principal) {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      const expiresAt = (now + accessLifetimeSeconds) * 1000
      const token = yield* Effect.promise(() => new SignJWT({
        username: principal.username,
        role: principal.role,
        scope: [...principal.scopes].join(" ")
      }).setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
        .setIssuer(issuer).setAudience(audience).setSubject(principal.id)
        .setIssuedAt(now).setExpirationTime(now + accessLifetimeSeconds).sign(key))
      return { token, expiresAt }
    })
    const issueRefresh = Effect.fn("TokenService.issueRefresh")(function*(userId: string, family: string) {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      const expiresAt = (now + refreshLifetimeSeconds) * 1000
      const token = yield* Effect.promise(() => new SignJWT({ family, kind: "refresh" })
        .setProtectedHeader({ alg: "HS256", typ: "rt+jwt" })
        .setIssuer(issuer).setAudience(audience).setSubject(userId)
        .setJti(randomBytes(16).toString("hex")).setIssuedAt(now)
        .setExpirationTime(now + refreshLifetimeSeconds).sign(key))
      return { token, expiresAt }
    })
    const verifyAccess = Effect.fn("TokenService.verifyAccess")(function*(token: Redacted.Redacted<string>) {
      const payload = yield* Effect.tryPromise({
        try: () => jwtVerify(Redacted.value(token), key, {
          algorithms: ["HS256"], issuer, audience, typ: "at+jwt", requiredClaims: ["sub", "exp", "iat"]
        }),
        catch: () => new Unauthorized({ reason: "Invalid or expired access token" })
      })
      const claims = payload.payload
      if (typeof claims.sub !== "string" || typeof claims.username !== "string" ||
        (claims.role !== "Reader" && claims.role !== "Author" && claims.role !== "Admin") || typeof claims.scope !== "string") {
        return yield* new Unauthorized({ reason: "Malformed access token claims" })
      }
      return { id: claims.sub, username: claims.username, role: claims.role as Role, scopes: new Set(claims.scope.split(" ").filter(Boolean)) }
    })
    const verifyRefresh = Effect.fn("TokenService.verifyRefresh")(function*(token: string) {
      const payload = yield* Effect.tryPromise({
        try: () => jwtVerify(token, key, {
          algorithms: ["HS256"], issuer, audience, typ: "rt+jwt", requiredClaims: ["sub", "exp", "iat", "jti"]
        }),
        catch: () => new Unauthorized({ reason: "Invalid or expired refresh token" })
      })
      if (typeof payload.payload.sub !== "string" || typeof payload.payload.family !== "string" || payload.payload.kind !== "refresh") {
        return yield* new Unauthorized({ reason: "Malformed refresh token claims" })
      }
      return { userId: payload.payload.sub, family: payload.payload.family }
    })
    return TokenService.of({ issueAccess, issueRefresh, verifyAccess, verifyRefresh })
  })
)
}

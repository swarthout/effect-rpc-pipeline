import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { BrowserSession } from "../shared/contracts.js"
import { SessionService, type IssuedSession } from "./sessions.js"

const refreshCookie = "pipeline_press_refresh"
const cookiePath = "/session"
if (process.env.NODE_ENV === "production" && !process.env.BLOG_PUBLIC_ORIGIN?.startsWith("https://")) {
  throw new Error("Production requires an HTTPS BLOG_PUBLIC_ORIGIN")
}

const LoginInput = Schema.Struct({ username: Schema.String, password: Schema.String })
const RegisterInput = Schema.Struct({ username: Schema.String, displayName: Schema.String, password: Schema.String })
const decodeLogin = Schema.decodeUnknownEffect(LoginInput)
const decodeRegister = Schema.decodeUnknownEffect(RegisterInput)
const encodeSession = HttpServerResponse.schemaJson(BrowserSession)

class SameOriginRequired extends Error {}

const errorStatus = (error: unknown): number => {
  if (error instanceof SameOriginRequired) return 403
  if (error !== null && typeof error === "object" && "_tag" in error) {
    if (error._tag === "InvalidInput") return 400
    if (error._tag === "Conflict") return 409
    if (error._tag === "Suspended") return 403
    if (error._tag === "Unauthorized") return 401
  }
  return 400
}

const errorResponse = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasDies(cause)) return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "Session request failed" }, { status: 500 }))
  const error = Cause.squash(cause)
  const message = error !== null && typeof error === "object" && "reason" in error
    ? String(error.reason)
    : error !== null && typeof error === "object" && "message" in error && error.message
      ? String(error.message)
      : "Session request failed"
  return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: errorStatus(error) }))
}

const requireSameOrigin = (request: { readonly headers: Readonly<Record<string, string | undefined>> }) => Effect.suspend(() => {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) {
    return Effect.fail(new SameOriginRequired("A same-origin request is required"))
  }
  return Effect.try({
    try: () => {
      const expectedOrigin = process.env.BLOG_PUBLIC_ORIGIN ?? `http://${host}`
      if (new URL(origin).origin !== new URL(expectedOrigin).origin || origin !== new URL(origin).origin) throw new SameOriginRequired("Cross-origin session request rejected")
    },
    catch: (error) => error
  })
})

const respondWithSession = ({ tokens, refreshExpiresAt }: IssuedSession) => encodeSession(new BrowserSession({
  accessToken: tokens.accessToken,
  expiresAt: tokens.expiresAt,
  user: tokens.user
})).pipe(Effect.flatMap(HttpServerResponse.setCookie(refreshCookie, tokens.refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: cookiePath,
  maxAge: Duration.millis(Math.max(0, refreshExpiresAt - Date.now()))
})))

const sessionHandler = <A>(
  sessions: SessionService["Service"],
  decode: (value: unknown) => Effect.Effect<A, unknown>,
  run: (input: A) => Effect.Effect<IssuedSession, unknown>
) => (request: any) => Effect.gen(function*() {
  yield* requireSameOrigin(request)
  const input = yield* request.json.pipe(Effect.flatMap(decode))
  return yield* run(input).pipe(Effect.flatMap(respondWithSession))
}).pipe(Effect.catchCause(errorResponse))

const refresh = (sessions: SessionService["Service"]) => (request: any) => Effect.gen(function*() {
  yield* requireSameOrigin(request)
  const token = request.cookies[refreshCookie]
  if (token === undefined) return yield* Effect.fail(new Error("Refresh cookie is required"))
  return yield* sessions.refresh(token).pipe(Effect.flatMap(respondWithSession))
}).pipe(Effect.catchCause(errorResponse))

const logout = (sessions: SessionService["Service"]) => (request: any) => Effect.gen(function*() {
  yield* requireSameOrigin(request)
  const token = request.cookies[refreshCookie]
  if (token !== undefined) yield* sessions.logout(token)
  return yield* HttpServerResponse.expireCookie(HttpServerResponse.empty({ status: 204 }), refreshCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: cookiePath
  })
}).pipe(Effect.catchCause(errorResponse))

export const SessionRoutesLive = Layer.unwrap(Effect.map(SessionService, (sessions) => Layer.mergeAll(
  HttpRouter.add("POST", "/session/login", sessionHandler(sessions, decodeLogin, sessions.login)),
  HttpRouter.add("POST", "/session/register", sessionHandler(sessions, decodeRegister, sessions.register)),
  HttpRouter.add("POST", "/session/refresh", refresh(sessions)),
  HttpRouter.add("POST", "/session/logout", logout(sessions))
)))

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Headers from "effect/http/Headers"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import { SignJWT, jwtVerify } from "jose"
import { AccessTokenVerifier, Authenticated, CurrentUser, Unauthorized, type User } from "./todo.js"

const issuer = "https://todo.example.test"
const audience = "todo-api"
// Local example key only. Production applications should inject a secret manager or remote JWKS verifier.
const developmentKey = new TextEncoder().encode("todo-example-only-secret-with-at-least-32-bytes")

const claimsToUser = (payload: { readonly sub?: string; readonly name?: unknown; readonly scope?: unknown }): User => {
  if (typeof payload.sub !== "string" || typeof payload.name !== "string" || typeof payload.scope !== "string") throw new Unauthorized()
  return CurrentUser.of({ id: payload.sub, name: payload.name, scopes: new Set(payload.scope.split(" ").filter(Boolean)) })
}

export const AccessTokenVerifierLive = Layer.succeed(AccessTokenVerifier, AccessTokenVerifier.of({
  verify: (token) => Effect.tryPromise({
    try: async () => {
      const { payload } = await jwtVerify(Redacted.value(token), developmentKey, {
        algorithms: ["HS256"],
        issuer,
        audience,
        typ: "at+jwt",
        requiredClaims: ["sub", "exp", "iat"]
      })
      return claimsToUser(payload)
    },
    catch: () => new Unauthorized()
  })
}))

export const AuthenticatedLive = PipelineAuth.layerBearer(Authenticated, {
  principal: CurrentUser,
  authenticate: (token) => Effect.flatMap(AccessTokenVerifier, (verifier) => verifier.verify(token)),
  unauthorized: () => new Unauthorized()
})

export const clientAuthLayer = (token: string) => RpcMiddleware.layerClient(Authenticated, ({ request, next }) =>
  next({ ...request, headers: Headers.set(request.headers, "authorization", `Bearer ${token}`) }))

export const makeAccessToken = (
  user: { readonly id: string; readonly name: string },
  lifetime = "15 minutes",
  scopes: ReadonlyArray<string> = ["todos:read", "todos:write"]
) => new SignJWT({ name: user.name, scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(lifetime)
    .sign(developmentKey)

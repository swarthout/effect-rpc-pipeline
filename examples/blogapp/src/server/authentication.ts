import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import { AccessTokenVerifier, AppRpcs, Authenticated, CurrentUser, Suspended, Unauthorized } from "../shared/contracts.js"
import { principalFor } from "./authorization.js"
import { BlogDatabase } from "./database.js"
import { TokenService } from "./security.js"

export const makeAuthLayers = Layer.unwrap(Effect.gen(function*() {
  const database = yield* BlogDatabase
  const tokens = yield* TokenService
  const verifier = AccessTokenVerifier.of({ verify: (token) => Effect.gen(function*() {
    const claims = yield* tokens.verifyAccess(token)
    const user = yield* database.getUser(claims.id).pipe(Effect.mapError(() => new Unauthorized({ reason: "User no longer exists" })))
    if (user.isSuspended) return yield* new Suspended()
    return principalFor(user)
  }) })
  return Layer.merge(
    Layer.succeed(AccessTokenVerifier, verifier),
    PipelineAuth.layerBearer(Authenticated, { principal: CurrentUser, authenticate: (token) => verifier.verify(token), unauthorized: () => new Unauthorized({ reason: "Bearer token required" }) })
  )
}))

export const assertAuthenticationCoverage = PipelineAuth.assertCoverage(AppRpcs, {
  public: ["health", "register", "login", "refresh", "listPosts", "getPost", "getUser", "listComments", "watchPost"],
  protectedBy: Authenticated
})

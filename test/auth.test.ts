import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Headers from "effect/http/Headers"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import { SignJWT, generateKeyPair, jwtVerify } from "jose"
import { describe, expect, it } from "vitest"
import * as Auth from "../src/Auth.js"
import * as Pipeline from "../src/Pipeline.js"
import * as PipelineClient from "../src/PipelineClient.js"
import * as PipelineServer from "../src/PipelineServer.js"

class CurrentUser extends Context.Service<CurrentUser, {
  readonly id: string
  readonly scopes: ReadonlySet<string>
}>()("security-test/CurrentUser") {}

class AccessTokenVerifier extends Context.Service<AccessTokenVerifier, {
  readonly verify: (token: Redacted.Redacted<string>) => Effect.Effect<CurrentUser["Service"], Unauthorized>
}>()("security-test/AccessTokenVerifier") {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

class Authenticated extends RpcMiddleware.Service<Authenticated, {
  readonly provides: CurrentUser
  readonly requires: AccessTokenVerifier
}>()("security-test/Authenticated", { error: Unauthorized }) {}

describe("authentication primitives", () => {
  it("strictly parses and redacts bearer credentials", () => {
    const valid = ["Bearer abc.def-_~+/=", "bearer token", "BEARER   token"]
    for (const authorization of valid) {
      const token = Auth.bearerToken({ authorization })
      expect(Option.isSome(token)).toBe(true)
      if (Option.isSome(token)) expect(String(token.value)).toBe("<redacted>")
    }
    expect(Option.isSome(Auth.bearerToken({ Authorization: "Bearer token" }))).toBe(true)
    for (const authorization of ["", "Bearer", "Bearer ", "Basic token", "Bearer token other", "Bearer token,other", "Bearer töken"]) {
      expect(Option.isNone(Auth.bearerToken({ authorization }))).toBe(true)
    }
    expect(Option.isNone(Auth.bearerToken({ authorization: "Bearer toolong" }, { maxLength: 8 }))).toBe(true)
  })

  it("verifies JWTs in native RPC middleware and provides CurrentUser", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256")
    const token = await new SignJWT({ scope: "todos:read todos:write" })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
      .setIssuer("https://issuer.example")
      .setAudience("todo-api")
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("5 minutes")
      .sign(privateKey)

    const verifier = AccessTokenVerifier.of({
      verify: (redacted) => Effect.tryPromise({
        try: async () => {
          const { payload } = await jwtVerify(Redacted.value(redacted), publicKey, {
            algorithms: ["ES256"],
            issuer: "https://issuer.example",
            audience: "todo-api",
            typ: "at+jwt",
            requiredClaims: ["sub", "exp", "iat"]
          })
          return CurrentUser.of({
            id: payload.sub!,
            scopes: new Set(typeof payload.scope === "string" ? payload.scope.split(" ") : [])
          })
        },
        catch: () => new Unauthorized()
      })
    })
    const authLayer = Auth.layerBearer(Authenticated, {
      principal: CurrentUser,
      authenticate: (credential) => Effect.flatMap(AccessTokenVerifier, (service) => service.verify(credential)),
      unauthorized: () => new Unauthorized()
    })
    const Protected = RpcGroup.make(Rpc.make("me", { success: Schema.String })).middleware(Authenticated)
    const Public = RpcGroup.make(Rpc.make("health", { success: Schema.String }))
    const App = Public.merge(Protected)

    await Effect.runPromise(Auth.assertCoverage(App, { public: ["health"], protectedBy: Authenticated }))
    const uncovered = await Effect.runPromise(Effect.flip(Auth.assertCoverage(App, { protectedBy: Authenticated })))
    expect(uncovered.rpcs).toEqual(["health"])

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const handlers = yield* App.toHandlers({
        health: () => Effect.succeed("ok"),
        me: () => Effect.map(CurrentUser, (user) => user.id)
      }).pipe(Effect.provideService(AccessTokenVerifier, verifier))
      const auth = yield* Layer.build(authLayer)
      const context = Context.add(Context.merge(handlers, auth), AccessTokenVerifier, verifier)
      const client = yield* PipelineClient.make(App, {
        transport: (request, options) => PipelineServer.handle(App, request, {
          metadata: {
            client: new Rpc.ServerClient(1),
            requestId: "jwt-test",
            headers: options?.headers ?? Headers.empty
          }
        }).pipe(Effect.provideContext(context))
      })
      const authenticated = yield* client.me().pipe(RpcClient.withHeaders({ authorization: `Bearer ${token}` }))
      const missing = yield* Effect.flip(client.me())
      const invalid = yield* Effect.flip(client.me().pipe(RpcClient.withHeaders({ authorization: "Bearer invalid.jwt.value" })))
      const mixed = yield* Effect.flip(Pipeline.all({ health: client.health(), me: client.me() }))
      const health = yield* client.health()
      let currentToken = Option.none<string>()
      const DynamicClientAuth = Auth.layerClientBearer(Authenticated, {
        token: Effect.sync(() => currentToken)
      })
      const dynamic = yield* PipelineClient.make(App, {
        transport: (request, options) => PipelineServer.handle(App, request, {
          metadata: {
            client: new Rpc.ServerClient(2),
            requestId: "dynamic-jwt-test",
            headers: options?.headers ?? Headers.empty
          }
        }).pipe(Effect.provideContext(context))
      }).pipe(Effect.provide(DynamicClientAuth))
      const dynamicHealth = yield* dynamic.health()
      const dynamicMissing = yield* Effect.flip(dynamic.me())
      currentToken = Option.some(token)
      const dynamicAuthenticated = yield* dynamic.me()
      return { authenticated, missing, invalid, mixed, health, dynamicHealth, dynamicMissing, dynamicAuthenticated }
    })))

    expect(result).toMatchObject({ authenticated: "user-1", health: "ok" })
    expect(result.missing).toMatchObject({ _tag: "Unauthorized" })
    expect(result.invalid).toMatchObject({ _tag: "Unauthorized" })
    expect(result.mixed).toMatchObject({ _tag: "Unauthorized" })
    expect(result.dynamicHealth).toBe("ok")
    expect(result.dynamicMissing).toMatchObject({ _tag: "Unauthorized" })
    expect(result.dynamicAuthenticated).toBe("user-1")
  })

  it("rejects expired, premature, wrong-algorithm, wrong-type, issuer, audience, and claim JWTs", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256")
    const make = (issuer: string, audience: string, expires: number) => new SignJWT({})
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey)
    const esTokens = await Promise.all([
      make("https://issuer.example", "todo-api", Math.floor(Date.now() / 1000) - 10),
      make("https://attacker.example", "todo-api", Math.floor(Date.now() / 1000) + 300),
      make("https://issuer.example", "other-api", Math.floor(Date.now() / 1000) + 300),
      new SignJWT({}).setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
        .setIssuer("https://issuer.example").setAudience("todo-api").setSubject("user-1")
        .setIssuedAt().setNotBefore("10 minutes").setExpirationTime("20 minutes").sign(privateKey),
      new SignJWT({}).setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer("https://issuer.example").setAudience("todo-api").setSubject("user-1")
        .setIssuedAt().setExpirationTime("5 minutes").sign(privateKey),
      new SignJWT({}).setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
        .setIssuer("https://issuer.example").setAudience("todo-api")
        .setIssuedAt().setExpirationTime("5 minutes").sign(privateKey)
    ])
    const wrongAlgorithm = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setIssuer("https://issuer.example").setAudience("todo-api").setSubject("user-1")
      .setIssuedAt().setExpirationTime("5 minutes")
      .sign(new TextEncoder().encode("a-different-strong-test-secret-at-least-32-bytes"))
    const tokens = [...esTokens, wrongAlgorithm]
    for (const token of tokens) {
      await expect(jwtVerify(token, publicKey, {
        algorithms: ["ES256"],
        issuer: "https://issuer.example",
        audience: "todo-api",
        typ: "at+jwt",
        requiredClaims: ["sub", "exp", "iat"]
      })).rejects.toBeDefined()
    }
  })
})

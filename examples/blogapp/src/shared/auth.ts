import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import { Suspended, Unauthorized } from "./errors.js"
import type { Role } from "./models.js"

export interface Principal { readonly id: string; readonly username: string; readonly role: Role; readonly scopes: ReadonlySet<string> }
export class CurrentUser extends Context.Service<CurrentUser, Principal>()("blog/CurrentUser") {}
export class AccessTokenVerifier extends Context.Service<AccessTokenVerifier, { readonly verify: (token: Redacted.Redacted<string>) => Effect.Effect<Principal, Unauthorized | Suspended> }>()("blog/AccessTokenVerifier") {}
export class Authenticated extends RpcMiddleware.Service<Authenticated, { readonly provides: CurrentUser; readonly requires: AccessTokenVerifier }>()("blog/Authenticated", { error: Schema.Union([Unauthorized, Suspended]), requiredForClient: true }) {}

import * as Effect from "effect/Effect"
import { Forbidden, type Principal, type Role, type User } from "../shared/contracts.js"

const scopesForRole = (role: Role): ReadonlySet<string> => new Set(role === "Admin"
  ? ["posts:write", "comments:write", "votes:write", "admin:write"]
  : role === "Author" ? ["posts:write", "comments:write", "votes:write"] : ["comments:write", "votes:write"])

export const principalFor = (user: User): Principal => ({
  id: user.id, username: user.username, role: user.role, scopes: scopesForRole(user.role)
})

export const requireScope = (principal: Principal, scope: string, action: string): Effect.Effect<void, Forbidden> =>
  principal.scopes.has(scope) ? Effect.void : Effect.fail(new Forbidden({ action }))

export const requireAdmin = (principal: Principal): Effect.Effect<void, Forbidden> =>
  principal.role === "Admin" ? Effect.void : Effect.fail(new Forbidden({ action: "admin" }))

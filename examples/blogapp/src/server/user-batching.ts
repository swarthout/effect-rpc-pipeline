import * as Cache from "effect/Cache"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import { NotFound, type User } from "../shared/contracts.js"
import { BlogDatabase } from "./database.js"

class UserById extends Request.TaggedClass("UserById")<{ readonly id: string }, User, NotFound> {}

export const makeUserLookup = Effect.gen(function*() {
  const database = yield* BlogDatabase
  const resolver = RequestResolver.make<UserById>((entries) => Effect.forEach(entries, (entry) =>
    database.getUser(entry.request.id).pipe(Effect.matchEffect({
      onFailure: (error) => Request.complete(entry, Exit.fail(error)),
      onSuccess: (user) => Request.complete(entry, Exit.succeed(user))
    })), { concurrency: "unbounded", discard: true }))
  return (id: string) => Effect.gen(function*() {
    const cache = yield* RequestBatching.cache(resolver, { capacity: 256 })
    return yield* Cache.get(cache, new UserById({ id }))
  })
})

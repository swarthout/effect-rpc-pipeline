import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Request from "effect/Request"
import * as RequestResolver from "effect/RequestResolver"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import { NotFound, User } from "../shared/contracts.js"
import { BlogDatabase } from "./database.js"

class UserById extends Request.TaggedClass("BlogUserById")<{ readonly id: string }, User, NotFound> {}

const completeById = <A extends { readonly id: string }, R extends Request.Any>(
  entries: ReadonlyArray<Request.Entry<R>>,
  values: ReadonlyArray<A>,
  resource: string
) => Effect.sync(() => {
  const byId = new Map(values.map((value) => [value.id, value]))
  for (const entry of entries) {
    const id = (entry.request as unknown as { readonly id: string }).id
    const value = byId.get(id)
    entry.completeUnsafe(value === undefined
      ? Exit.fail(new NotFound({ resource, id }))
      : Exit.succeed(value) as any)
  }
})

export class BlogLookups extends Context.Service<BlogLookups, {
  readonly userById: (id: string) => Effect.Effect<User, NotFound>
}>()("blog/BlogLookups") {}

export const BlogLookupsLive = Layer.effect(BlogLookups, Effect.gen(function*() {
  const database = yield* BlogDatabase
  const users = RequestResolver.make<UserById>((entries) => Effect.flatMap(
    database.getUsers(entries.map((entry) => entry.request.id)),
    (values) => completeById(entries, values, "User")
  ))
  // Construct the cache Effect once. Calling RequestBatching.cache inside the
  // lookup function would create one descriptor per item and defeat batching.
  const userCache = RequestBatching.cache(users, { capacity: 256 })
  return BlogLookups.of({
    userById: (id) => Effect.flatMap(userCache, Cache.get(new UserById({ id }))) as Effect.Effect<User, NotFound>
  })
}))

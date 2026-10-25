import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import * as SqlClient from "effect/sql/SqlClient"
import { describe, expect, it } from "vitest"
import { User } from "../shared/contracts.js"
import { BlogDatabase, BlogDatabaseLive } from "./database.js"
import { BlogLookups, BlogLookupsLive } from "./lookups.js"

const user = (id: string) => new User({
  id,
  username: id,
  displayName: id.toUpperCase(),
  bio: "",
  role: "Reader",
  isSuspended: false,
  createdAt: 1
})

describe("blog database request batching", () => {
  it("implements the bulk loader with one SQL statement", async () => {
    const statements: Array<string> = []
    const users = [
      { id: "user-1", username: "one", display_name: "One", bio: "", role: "Reader", is_suspended: 0, password_hash: "", created_at: 1 },
      { id: "user-2", username: "two", display_name: "Two", bio: "", role: "Author", is_suspended: 0, password_hash: "", created_at: 2 }
    ]
    const sql = Object.assign(
      (strings: TemplateStringsArray) => Effect.sync(() => {
        const statement = strings.join("?")
        statements.push(statement)
        return users
      }),
      { in: (values: ReadonlyArray<unknown>) => values }
    ) as unknown as SqlClient.SqlClient

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(BlogDatabaseLive.pipe(
        Layer.provide(Layer.succeed(SqlClient.SqlClient, sql))
      ))
      const database = Context.get(context, BlogDatabase)
      return yield* database.getUsers(["user-1", "user-2", "user-1"])
    })))

    expect(result.map(({ id }) => id)).toEqual(["user-1", "user-2"])
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain("FROM users")
  })

  it("turns mapped user lookups into one deduplicated bulk database call", async () => {
    const userBatches: Array<ReadonlyArray<string>> = []
    const database = {
      getUsers: (ids: ReadonlyArray<string>) => Effect.sync(() => {
        userBatches.push([...ids])
        return ids.map(user)
      })
    } as unknown as BlogDatabase["Service"]

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(BlogLookupsLive.pipe(
        Layer.provide(Layer.succeed(BlogDatabase, database))
      ))
      const lookups = Context.get(context, BlogLookups)
      return yield* Effect.gen(function*() {
        const users = yield* Effect.all([
          lookups.userById("user-1"),
          lookups.userById("user-2"),
          lookups.userById("user-1"),
          lookups.userById("user-3")
        ], { concurrency: "unbounded" })
        const cachedUser = yield* lookups.userById("user-2")
        return { users, cachedUser }
      }).pipe(Effect.provideService(RequestBatching.RequestScope, RequestBatching.makeScope()))
    })))

    expect(result.users.map(({ id }) => id)).toEqual(["user-1", "user-2", "user-1", "user-3"])
    expect(result.cachedUser.id).toBe("user-2")
    expect(userBatches).toEqual([["user-1", "user-2", "user-3"]])
  })
})

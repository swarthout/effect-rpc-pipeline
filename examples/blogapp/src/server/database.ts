import { randomUUID } from "node:crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { AdminSummary, Comment, Conflict, InvalidInput, NotFound, Post, type PostStatus, User, type Role } from "../shared/contracts.js"

type UserRow = { id: string; username: string; display_name: string; bio: string; role: Role; is_suspended: number; password_hash: string; created_at: number }
type PostRow = { id: string; author_id: string; slug: string; title: string; excerpt: string; body: string; tags: string; status: PostStatus; upvotes: number; comment_count: number; created_at: number; updated_at: number; published_at: number | null }
type CommentRow = { id: string; post_id: string; author_id: string; body: string; created_at: number }

const toUser = (row: UserRow) => new User({
  id: row.id, username: row.username, displayName: row.display_name, bio: row.bio,
  role: row.role, isSuspended: row.is_suspended === 1, createdAt: row.created_at
})
const toPost = (row: PostRow) => new Post({
  id: row.id, authorId: row.author_id, slug: row.slug, title: row.title, excerpt: row.excerpt,
  body: row.body, tags: JSON.parse(row.tags) as ReadonlyArray<string>, status: row.status,
  upvotes: row.upvotes, commentCount: row.comment_count, createdAt: row.created_at,
  updatedAt: row.updated_at, publishedAt: Option.fromNullishOr(row.published_at)
})
const toComment = (row: CommentRow) => new Comment({
  id: row.id, postId: row.post_id, authorId: row.author_id, body: row.body, createdAt: row.created_at
})

const slugify = (title: string): string => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export class BlogDatabase extends Context.Service<BlogDatabase, {
  readonly migrate: Effect.Effect<void>
  readonly createUser: (input: { readonly username: string; readonly displayName: string; readonly passwordHash: string; readonly role?: Role }) => Effect.Effect<User, Conflict>
  readonly findUserByUsername: (username: string) => Effect.Effect<{ readonly user: User; readonly passwordHash: string }, NotFound>
  readonly getUser: (id: string) => Effect.Effect<User, NotFound>
  readonly listUsers: Effect.Effect<ReadonlyArray<User>>
  readonly updateUser: (id: string, fields: { readonly role?: Role; readonly isSuspended?: boolean }) => Effect.Effect<User, NotFound>
  readonly saveRefreshToken: (input: { readonly digest: string; readonly family: string; readonly userId: string; readonly expiresAt: number }) => Effect.Effect<void>
  readonly rotateRefreshToken: (oldDigest: string, next: { readonly digest: string; readonly family: string; readonly userId: string; readonly expiresAt: number }) => Effect.Effect<void, NotFound>
  readonly createPost: (authorId: string, input: { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) => Effect.Effect<Post, InvalidInput | Conflict>
  readonly updatePost: (id: string, input: { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) => Effect.Effect<Post, InvalidInput | NotFound>
  readonly getPostById: (id: string) => Effect.Effect<Post, NotFound>
  readonly getPublishedPostBySlug: (slug: string) => Effect.Effect<Post, NotFound>
  readonly listPublishedPosts: (input: { readonly search: string; readonly tag: Option.Option<string>; readonly offset: number; readonly limit: number }) => Effect.Effect<ReadonlyArray<Post>>
  readonly listPostsByAuthor: (authorId: string) => Effect.Effect<ReadonlyArray<Post>>
  readonly listAllPosts: Effect.Effect<ReadonlyArray<Post>>
  readonly deletePost: (id: string) => Effect.Effect<boolean, NotFound>
  readonly createComment: (postId: string, authorId: string, body: string) => Effect.Effect<Comment, InvalidInput | NotFound>
  readonly listComments: (postId: string) => Effect.Effect<ReadonlyArray<Comment>>
  readonly listAllComments: Effect.Effect<ReadonlyArray<Comment>>
  readonly getComment: (id: string) => Effect.Effect<Comment, NotFound>
  readonly deleteComment: (id: string) => Effect.Effect<boolean, NotFound>
  readonly toggleVote: (postId: string, userId: string) => Effect.Effect<boolean, NotFound>
  readonly hasUpvoted: (postId: string, userId: string) => Effect.Effect<Option.Option<boolean>>
  readonly adminSummary: Effect.Effect<AdminSummary>
}>()("blog/BlogDatabase") {}

const firstOrNotFound = <A>(rows: ReadonlyArray<A>, resource: string, id: string): Effect.Effect<A, NotFound> => {
  const first = rows.at(0)
  return first === undefined ? Effect.fail(new NotFound({ resource, id })) : Effect.succeed(first)
}

const validatePost = (title: string, body: string): Effect.Effect<void, InvalidInput> => {
  if (title.trim().length < 3) return Effect.fail(new InvalidInput({ field: "title", message: "Use at least three characters" }))
  if (body.trim().length < 10) return Effect.fail(new InvalidInput({ field: "body", message: "Use at least ten characters" }))
  return Effect.void
}

export const BlogDatabaseLive = Layer.effect(BlogDatabase, Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const query = <A extends object = Record<string, unknown>>(strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Effect.Effect<ReadonlyArray<A>> =>
    Effect.orDie((sql as any)(strings, ...values))
  const migrate = Effect.gen(function*() {
    yield* query`PRAGMA foreign_keys = ON`
    yield* query`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, is_suspended INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    )`
    yield* query`CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, excerpt TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER
    )`
    yield* query`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
    )`
    yield* query`CREATE TABLE IF NOT EXISTS votes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
      PRIMARY KEY(post_id, user_id)
    )`
    yield* query`CREATE TABLE IF NOT EXISTS refresh_tokens (
      digest TEXT PRIMARY KEY, family TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL, used_at INTEGER
    )`
  }).pipe(Effect.orDie)

  const getUser = Effect.fn("BlogDatabase.getUser")(function*(id: string) {
    return yield* firstOrNotFound((yield* query<UserRow>`SELECT * FROM users WHERE id = ${id}`).map(toUser), "User", id)
  })
  const getPostById = Effect.fn("BlogDatabase.getPostById")(function*(id: string) {
    const rows = yield* query<PostRow>`SELECT p.*, COUNT(DISTINCT v.user_id) AS upvotes, COUNT(DISTINCT c.id) AS comment_count
      FROM posts p LEFT JOIN votes v ON v.post_id = p.id LEFT JOIN comments c ON c.post_id = p.id
      WHERE p.id = ${id} GROUP BY p.id`
    return yield* firstOrNotFound(rows.map(toPost), "Post", id)
  })
  const createUser = Effect.fn("BlogDatabase.createUser")(function*(input: { readonly username: string; readonly displayName: string; readonly passwordHash: string; readonly role?: Role }) {
    const id = randomUUID()
    const username = input.username.trim().toLowerCase()
    if (username.length < 3) return yield* new Conflict({ resource: "User", field: "username" })
    const existing = yield* query`SELECT id FROM users WHERE username = ${username}`
    if (existing.length > 0) return yield* new Conflict({ resource: "User", field: "username" })
    yield* query`INSERT INTO users (id, username, display_name, bio, role, is_suspended, password_hash, created_at)
      VALUES (${id}, ${username}, ${input.displayName.trim()}, '', ${input.role ?? "Author"}, 0, ${input.passwordHash}, ${Date.now()})`
    return yield* getUser(id).pipe(Effect.orDie)
  })
  const updateUser = Effect.fn("BlogDatabase.updateUser")(function*(id: string, fields: { readonly role?: Role; readonly isSuspended?: boolean }) {
    const current = yield* getUser(id)
    yield* query`UPDATE users SET role = ${fields.role ?? current.role}, is_suspended = ${fields.isSuspended === undefined ? Number(current.isSuspended) : Number(fields.isSuspended)} WHERE id = ${id}`
    return yield* getUser(id)
  })
  const createPost = Effect.fn("BlogDatabase.createPost")(function*(authorId: string, input: { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) {
    yield* validatePost(input.title, input.body)
    const id = randomUUID()
    const baseSlug = slugify(input.title)
    const slug = `${baseSlug}-${id.slice(0, 8)}`
    const now = Date.now()
    yield* query`INSERT INTO posts (id, author_id, slug, title, excerpt, body, tags, status, created_at, updated_at, published_at)
      VALUES (${id}, ${authorId}, ${slug}, ${input.title.trim()}, ${input.excerpt.trim()}, ${input.body.trim()}, ${JSON.stringify(input.tags)}, ${input.status}, ${now}, ${now}, ${input.status === "Published" ? now : null})`
    return yield* getPostById(id).pipe(Effect.orDie)
  })
  const updatePost = Effect.fn("BlogDatabase.updatePost")(function*(id: string, input: { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) {
    yield* validatePost(input.title, input.body)
    const current = yield* getPostById(id)
    const publishedAt = input.status === "Published" ? Option.getOrElse(current.publishedAt, () => Date.now()) : null
    yield* query`UPDATE posts SET title = ${input.title.trim()}, excerpt = ${input.excerpt.trim()}, body = ${input.body.trim()},
      tags = ${JSON.stringify(input.tags)}, status = ${input.status}, updated_at = ${Date.now()}, published_at = ${publishedAt} WHERE id = ${id}`
    return yield* getPostById(id)
  })
  const listComments = Effect.fn("BlogDatabase.listComments")(function*(postId: string) {
    return (yield* query<CommentRow>`SELECT * FROM comments WHERE post_id = ${postId} ORDER BY created_at`).map(toComment)
  })
  const deleteComment = Effect.fn("BlogDatabase.deleteComment")(function*(id: string) {
    yield* firstOrNotFound(yield* query`SELECT id FROM comments WHERE id = ${id}`, "Comment", id)
    yield* query`DELETE FROM comments WHERE id = ${id}`
    return true
  })
  const listAllPosts = Effect.map(query<PostRow>`SELECT p.*, COUNT(DISTINCT v.user_id) AS upvotes, COUNT(DISTINCT c.id) AS comment_count FROM posts p LEFT JOIN votes v ON v.post_id=p.id LEFT JOIN comments c ON c.post_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`, (rows) => rows.map(toPost))
  const listAllComments = Effect.map(query<CommentRow>`SELECT * FROM comments ORDER BY created_at DESC`, (rows) => rows.map(toComment))
  const listUsers = Effect.map(query<UserRow>`SELECT * FROM users ORDER BY created_at DESC`, (rows) => rows.map(toUser))
  const adminSummary = Effect.all({ users: listUsers, posts: listAllPosts, comments: listAllComments }).pipe(Effect.map(({ users, posts, comments }) => new AdminSummary({
    users, posts, comments, publishedPosts: posts.filter((post) => post.status === "Published").length,
    suspendedUsers: users.filter((user) => user.isSuspended).length
  })))

  return BlogDatabase.of({
    migrate,
    createUser,
    findUserByUsername: Effect.fn("BlogDatabase.findUserByUsername")(function*(username: string) {
      const rows = yield* query<UserRow>`SELECT * FROM users WHERE username = ${username.trim().toLowerCase()}`
      const row = yield* firstOrNotFound(rows, "User", username)
      return { user: toUser(row), passwordHash: row.password_hash }
    }),
    getUser,
    listUsers,
    updateUser,
    saveRefreshToken: (input) => query`INSERT INTO refresh_tokens (digest, family, user_id, expires_at) VALUES (${input.digest}, ${input.family}, ${input.userId}, ${input.expiresAt})`.pipe(Effect.asVoid, Effect.orDie),
    rotateRefreshToken: Effect.fn("BlogDatabase.rotateRefreshToken")(function*(oldDigest, next) {
      const rows = yield* query<{ digest: string }>`SELECT digest FROM refresh_tokens WHERE digest = ${oldDigest} AND used_at IS NULL AND expires_at > ${Date.now()}`
      if (rows.length === 0) return yield* new NotFound({ resource: "RefreshToken", id: oldDigest })
      yield* query`UPDATE refresh_tokens SET used_at = ${Date.now()} WHERE digest = ${oldDigest}`
      yield* query`INSERT INTO refresh_tokens (digest, family, user_id, expires_at) VALUES (${next.digest}, ${next.family}, ${next.userId}, ${next.expiresAt})`
      return undefined
    }),
    createPost,
    updatePost,
    getPostById,
    getPublishedPostBySlug: Effect.fn("BlogDatabase.getPublishedPostBySlug")(function*(slug: string) {
      const rows = yield* query<PostRow>`SELECT p.*, COUNT(DISTINCT v.user_id) AS upvotes, COUNT(DISTINCT c.id) AS comment_count
        FROM posts p LEFT JOIN votes v ON v.post_id=p.id LEFT JOIN comments c ON c.post_id=p.id
        WHERE p.slug=${slug} AND p.status='Published' GROUP BY p.id`
      return yield* firstOrNotFound(rows.map(toPost), "Post", slug)
    }),
    listPublishedPosts: Effect.fn("BlogDatabase.listPublishedPosts")(function*(input) {
      const search = `%${input.search.trim()}%`
      const tag = Option.getOrNull(input.tag)
      const rows = yield* query<PostRow>`SELECT p.*, COUNT(DISTINCT v.user_id) AS upvotes, COUNT(DISTINCT c.id) AS comment_count
        FROM posts p LEFT JOIN votes v ON v.post_id=p.id LEFT JOIN comments c ON c.post_id=p.id
        WHERE p.status='Published' AND (${input.search.trim()}='' OR p.title LIKE ${search} OR p.body LIKE ${search})
        AND (${tag} IS NULL OR p.tags LIKE ${tag === null ? null : `%\"${tag}\"%`})
        GROUP BY p.id ORDER BY p.published_at DESC LIMIT ${Math.min(50, Math.max(1, input.limit))} OFFSET ${Math.max(0, input.offset)}`
      return rows.map(toPost)
    }),
    listPostsByAuthor: Effect.fn("BlogDatabase.listPostsByAuthor")(function*(authorId: string) {
      const rows = yield* query<PostRow>`SELECT p.*, COUNT(DISTINCT v.user_id) AS upvotes, COUNT(DISTINCT c.id) AS comment_count FROM posts p LEFT JOIN votes v ON v.post_id=p.id LEFT JOIN comments c ON c.post_id=p.id WHERE p.author_id=${authorId} GROUP BY p.id ORDER BY p.updated_at DESC`
      return rows.map(toPost)
    }),
    listAllPosts,
    deletePost: Effect.fn("BlogDatabase.deletePost")(function*(id: string) {
      yield* getPostById(id)
      yield* query`DELETE FROM posts WHERE id=${id}`
      return true
    }),
    createComment: Effect.fn("BlogDatabase.createComment")(function*(postId: string, authorId: string, body: string) {
      if (body.trim().length < 2) return yield* new InvalidInput({ field: "comment", message: "Comment is too short" })
      yield* getPostById(postId)
      const id = randomUUID()
      yield* query`INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (${id}, ${postId}, ${authorId}, ${body.trim()}, ${Date.now()})`
      return yield* firstOrNotFound((yield* query<CommentRow>`SELECT * FROM comments WHERE id=${id}`).map(toComment), "Comment", id)
    }),
    listComments,
    listAllComments,
    getComment: Effect.fn("BlogDatabase.getComment")(function*(id: string) {
      return yield* firstOrNotFound((yield* query<CommentRow>`SELECT * FROM comments WHERE id=${id}`).map(toComment), "Comment", id)
    }),
    deleteComment,
    toggleVote: Effect.fn("BlogDatabase.toggleVote")(function*(postId: string, userId: string) {
      yield* getPostById(postId)
      const existing = yield* query`SELECT post_id FROM votes WHERE post_id=${postId} AND user_id=${userId}`
      if (existing.length > 0) {
        yield* query`DELETE FROM votes WHERE post_id=${postId} AND user_id=${userId}`
        return false
      }
      yield* query`INSERT INTO votes (post_id, user_id, created_at) VALUES (${postId}, ${userId}, ${Date.now()})`
      return true
    }),
    hasUpvoted: Effect.fn("BlogDatabase.hasUpvoted")(function*(postId: string, userId: string) {
      const rows = yield* query`SELECT post_id FROM votes WHERE post_id=${postId} AND user_id=${userId}`
      return Option.some(rows.length > 0)
    }),
    adminSummary
  })
}))

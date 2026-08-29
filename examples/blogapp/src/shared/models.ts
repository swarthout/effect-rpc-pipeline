import * as Schema from "effect/Schema"

export const Role = Schema.Literals(["Reader", "Author", "Admin"])
export type Role = typeof Role.Type
export const PostStatus = Schema.Literals(["Draft", "Published"])
export type PostStatus = typeof PostStatus.Type

export class User extends Schema.Class<User>("User")({ id: Schema.String, username: Schema.String, displayName: Schema.String, bio: Schema.String, role: Role, isSuspended: Schema.Boolean, createdAt: Schema.Number }) {}
export class Post extends Schema.Class<Post>("Post")({ id: Schema.String, authorId: Schema.String, slug: Schema.String, title: Schema.String, excerpt: Schema.String, body: Schema.String, tags: Schema.Array(Schema.String), status: PostStatus, upvotes: Schema.Number, commentCount: Schema.Number, createdAt: Schema.Number, updatedAt: Schema.Number, publishedAt: Schema.OptionFromNullOr(Schema.Number) }) {}
export class Comment extends Schema.Class<Comment>("Comment")({ id: Schema.String, postId: Schema.String, authorId: Schema.String, body: Schema.String, createdAt: Schema.Number }) {}
export class PostCard extends Schema.Class<PostCard>("PostCard")({ post: Post, author: User, viewerUpvoted: Schema.OptionFromNullOr(Schema.Boolean) }) {}
export class CommentView extends Schema.Class<CommentView>("CommentView")({ comment: Comment, author: User, canDelete: Schema.Boolean }) {}
export class PostDetails extends Schema.Class<PostDetails>("PostDetails")({ post: Post, author: User, comments: Schema.Array(CommentView), viewerUpvoted: Schema.OptionFromNullOr(Schema.Boolean), canEdit: Schema.Boolean }) {}
export class AuthTokens extends Schema.Class<AuthTokens>("AuthTokens")({ accessToken: Schema.String, refreshToken: Schema.String, expiresAt: Schema.Number, user: User }) {}
export class BrowserSession extends Schema.Class<BrowserSession>("BrowserSession")({ accessToken: Schema.String, expiresAt: Schema.Number, user: User }) {}
export class AdminSummary extends Schema.Class<AdminSummary>("AdminSummary")({ users: Schema.Array(User), posts: Schema.Array(Post), comments: Schema.Array(Comment), publishedPosts: Schema.Number, suspendedUsers: Schema.Number }) {}
export const BlogEventKind = Schema.Literals(["PostChanged", "CommentAdded", "CommentDeleted", "VoteChanged", "Moderated"])
export class BlogEvent extends Schema.Class<BlogEvent>("BlogEvent")({ kind: BlogEventKind, postId: Schema.String, message: Schema.String, occurredAt: Schema.Number }) {}

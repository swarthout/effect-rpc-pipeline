import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Capability from "effect-rpc-pipeline/Capability"
import * as RequestBatching from "effect-rpc-pipeline/RequestBatching"
import { Authenticated } from "./auth.js"
import { AuthorSession, NotificationSink } from "./capabilities.js"
import { Conflict, Forbidden, InvalidInput, NotFound, Suspended, Unauthorized } from "./errors.js"
import { AdminSummary, AuthTokens, BlogEvent, Comment, Post, PostStatus, Role, User } from "./models.js"

export const HealthRpc = Rpc.make("health", { success: Schema.String })
export const RegisterRpc = Rpc.make("register", { payload: { username: Schema.String, displayName: Schema.String, password: Schema.String }, success: AuthTokens, error: Schema.Union([Conflict, InvalidInput]) })
export const LoginRpc = Rpc.make("login", { payload: { username: Schema.String, password: Schema.String }, success: AuthTokens, error: Schema.Union([Unauthorized, Suspended]) })
export const RefreshRpc = Rpc.make("refresh", { payload: { refreshToken: Schema.String }, success: AuthTokens, error: Schema.Union([Unauthorized, Suspended]) })
export const ListPostsRpc = Rpc.make("listPosts", { payload: { search: Schema.String, tag: Schema.OptionFromNullOr(Schema.String), offset: Schema.Number, limit: Schema.Number }, success: Schema.Array(Post) })
export const GetPostRpc = Rpc.make("getPost", { payload: { slug: Schema.String }, success: Post, error: NotFound })
export const GetUserRpc = Rpc.make("getUser", { payload: { id: Schema.String }, success: User, error: NotFound }).middleware(RequestBatching.Middleware)
export const ListCommentsRpc = Rpc.make("listComments", { payload: { postId: Schema.String }, success: Schema.Array(Comment) })
export const WatchPostRpc = Rpc.make("watchPost", { payload: { postId: Schema.String }, success: BlogEvent, stream: true })
export const PublicRpcs = RpcGroup.make(HealthRpc, RegisterRpc, LoginRpc, RefreshRpc, ListPostsRpc, GetPostRpc, GetUserRpc, ListCommentsRpc, WatchPostRpc)

export const ProtectedRpcs = RpcGroup.make(
  Rpc.make("me", { success: User, error: NotFound }),
  Rpc.make("myPosts", { success: Schema.Array(Post) }),
  Rpc.make("createPost", { payload: { title: Schema.String, excerpt: Schema.String, body: Schema.String, tags: Schema.Array(Schema.String), status: PostStatus }, success: Post, error: Schema.Union([Forbidden, InvalidInput, Conflict]) }),
  Rpc.make("updatePost", { payload: { id: Schema.String, title: Schema.String, excerpt: Schema.String, body: Schema.String, tags: Schema.Array(Schema.String), status: PostStatus }, success: Post, error: Schema.Union([Forbidden, NotFound, InvalidInput, Conflict]) }),
  Rpc.make("deletePost", { payload: { id: Schema.String }, success: Schema.Boolean, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("addComment", { payload: { postId: Schema.String, body: Schema.String }, success: Comment, error: Schema.Union([Forbidden, NotFound, InvalidInput]) }),
  Rpc.make("deleteComment", { payload: { id: Schema.String }, success: Schema.Boolean, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("toggleUpvote", { payload: { postId: Schema.String }, success: Schema.Boolean, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("hasUpvoted", { payload: { postId: Schema.String }, success: Schema.OptionFromNullOr(Schema.Boolean) }),
  Rpc.make("canDeleteComment", { payload: { commentId: Schema.String }, success: Schema.Boolean, error: NotFound }),
  Rpc.make("openAuthorSession", { payload: { postId: Schema.String }, success: AuthorSession.schema, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("registerNotificationSink", { payload: { sink: NotificationSink.schema }, success: Schema.Boolean, error: Schema.Union([Capability.CapabilityUnavailable, Capability.CapabilityTransportError]) }),
  Rpc.make("adminSummary", { success: AdminSummary, error: Forbidden }),
  Rpc.make("setUserSuspended", { payload: { userId: Schema.String, suspended: Schema.Boolean }, success: User, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("setUserRole", { payload: { userId: Schema.String, role: Role }, success: User, error: Schema.Union([Forbidden, NotFound]) }),
  Rpc.make("moderatePost", { payload: { postId: Schema.String, status: PostStatus }, success: Post, error: Schema.Union([Forbidden, NotFound, InvalidInput]) }),
  Rpc.make("moderateComment", { payload: { commentId: Schema.String }, success: Schema.Boolean, error: Schema.Union([Forbidden, NotFound]) })
).middleware(Authenticated)

export const AppRpcs = PublicRpcs.merge(ProtectedRpcs)

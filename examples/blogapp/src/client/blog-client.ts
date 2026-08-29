import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Headers from "effect/unstable/http/Headers"
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Stream from "effect/Stream"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs, Authenticated, PostCard, PostDetails, type PostStatus } from "../shared/contracts.js"

export const clientAuthLayer = (accessToken: string) => RpcMiddleware.layerClient(Authenticated, ({ request, next }) =>
  next({ ...request, headers: Headers.set(request.headers, "authorization", `Bearer ${accessToken}`) }))

const clientOptionalAuthLayer = (accessToken?: string) => RpcMiddleware.layerClient(Authenticated, ({ request, next }) =>
  next(accessToken === undefined ? request : { ...request, headers: Headers.set(request.headers, "authorization", `Bearer ${accessToken}`) }))

type MaterializeMethod<A> = A extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result extends Effect.Effect<infer Success, infer Error, any> ? Effect.Effect<Success, Error> : Result
  : A
type Facade = ReturnType<typeof makeFacade>
export type BlogClient = { readonly [Key in keyof Facade]: MaterializeMethod<Facade[Key]> }

type AppClient = Pipeline.ClientApi<RpcGroup.Rpcs<typeof AppRpcs>>

export const makeFacade = (rpc: AppClient) => ({
  health: () => rpc.health(),
  register: (input: { readonly username: string; readonly displayName: string; readonly password: string }) => rpc.register(input),
  login: (input: { readonly username: string; readonly password: string }) => rpc.login(input),
  refresh: (refreshToken: string) => rpc.refresh({ refreshToken }),
  feed: (search = "", tag: Option.Option<string> = Option.none()) => {
    const posts = rpc.listPosts({ search, tag, offset: 0, limit: 30 })
    return Pipeline.map(posts, (post) => ({
      post,
      author: rpc.getUser({ id: post.authorId }),
      viewerUpvoted: Option.none()
    })).pipe(Effect.map((cards) => cards.map((card) => new PostCard(card))))
  },
  post: (slug: string) => {
    const post = rpc.getPost({ slug })
    const author = rpc.getUser({ id: post.authorId })
    const comments = Pipeline.map(rpc.listComments({ postId: post.id }), (comment) => ({
      comment,
      author: rpc.getUser({ id: comment.authorId }),
      canDelete: false
    }))
    return Pipeline.all({ post, author, comments }).pipe(Effect.map((details: any) => new PostDetails({
      ...details,
      viewerUpvoted: Option.none(),
      canEdit: false
    })))
  },
  viewerPost: (slug: string) => {
    const post = rpc.getPost({ slug })
    return Pipeline.all({
      post,
      author: rpc.getUser({ id: post.authorId }),
      comments: Pipeline.map(rpc.listComments({ postId: post.id }), (comment) => ({
        comment, author: rpc.getUser({ id: comment.authorId }), canDelete: rpc.canDeleteComment({ commentId: comment.id })
      })),
      viewerUpvoted: rpc.hasUpvoted({ postId: post.id }),
      viewer: rpc.me()
    }).pipe(Effect.map(({ viewer, ...details }: any) => new PostDetails({
      ...details,
      canEdit: viewer.id === details.post.authorId || viewer.role === "Admin"
    })))
  },
  createPost: (input: { readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) =>
    rpc.createPost(input).pipe(Pipeline.andThen((post) => ({ post, allPosts: rpc.myPosts() }))),
  updatePost: (input: { readonly id: string; readonly title: string; readonly excerpt: string; readonly body: string; readonly tags: ReadonlyArray<string>; readonly status: PostStatus }) =>
    rpc.updatePost(input).pipe(Pipeline.andThen((post: any) => ({ post, drafts: rpc.myPosts() }))),
  deletePost: (id: string) => rpc.deletePost({ id }).pipe(Pipeline.andThen(() => rpc.myPosts())),
  comment: (postId: string, body: string) => rpc.addComment({ postId, body }).pipe(Pipeline.andThen(() => rpc.listComments({ postId }))),
  deleteComment: (id: string, postId: string) => rpc.deleteComment({ id }).pipe(Pipeline.andThen(() => rpc.listComments({ postId }))),
  toggleUpvote: (postId: string) => rpc.toggleUpvote({ postId }).pipe(Pipeline.andThen((upvoted) => ({ upvoted, value: rpc.hasUpvoted({ postId }) }))),
  myPosts: () => rpc.myPosts(),
  me: () => rpc.me(),
  admin: () => rpc.adminSummary(),
  setSuspended: (userId: string, suspended: boolean) => rpc.setUserSuspended({ userId, suspended }).pipe(Pipeline.andThen(() => rpc.adminSummary())),
  setRole: (userId: string, role: "Reader" | "Author" | "Admin") => rpc.setUserRole({ userId, role }).pipe(Pipeline.andThen(() => rpc.adminSummary())),
  moderatePost: (postId: string, status: PostStatus) => rpc.moderatePost({ postId, status }).pipe(Pipeline.andThen(() => rpc.adminSummary())),
  moderateComment: (commentId: string) => rpc.moderateComment({ commentId }).pipe(Pipeline.andThen(() => rpc.adminSummary())),
  openAuthorSession: (postId: string) => rpc.openAuthorSession({ postId }),
  registerNotificationSink: (sink: any) => rpc.registerNotificationSink({ sink }),
  watchPost: (postId: string) => rpc.watchPost({ postId })
})

export const makeHttpClient = (url = "/rpc", accessToken?: string): Effect.Effect<BlogClient> => Effect.sync(() => {
  const makeRpc = PipelineClient.make(AppRpcs, { id: "pipeline-press" }).pipe(
    Effect.provide(clientOptionalAuthLayer(accessToken))
  )
  const run = <A, E, R>(use: (client: BlogClient) => Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
    const rpc = yield* makeRpc
    return yield* use(makeFacade(rpc) as unknown as BlogClient)
  })).pipe(
    Effect.provide(PipelineClient.layerHttp({ url })),
    Effect.provide(RpcSerialization.layerJson)
  ) as Effect.Effect<A, E>

  const client: BlogClient = {
    health: () => run((c) => c.health()), register: (input) => run((c) => c.register(input)),
    login: (input) => run((c) => c.login(input)), refresh: (token) => run((c) => c.refresh(token)),
    feed: (search, tag) => run((c) => c.feed(search, tag)), post: (slug) => run((c) => c.post(slug)),
    viewerPost: (slug) => run((c) => c.viewerPost(slug)), createPost: (input) => run((c) => c.createPost(input)),
    updatePost: (input) => run((c) => c.updatePost(input)), deletePost: (id) => run((c) => c.deletePost(id)),
    comment: (postId, body) => run((c) => c.comment(postId, body)), deleteComment: (id, postId) => run((c) => c.deleteComment(id, postId)),
    toggleUpvote: (postId) => run((c) => c.toggleUpvote(postId)), myPosts: () => run((c) => c.myPosts()),
    me: () => run((c) => c.me()), admin: () => run((c) => c.admin()),
    setSuspended: (id, suspended) => run((c) => c.setSuspended(id, suspended)), setRole: (id, role) => run((c) => c.setRole(id, role)),
    moderatePost: (id, status) => run((c) => c.moderatePost(id, status)), moderateComment: (id) => run((c) => c.moderateComment(id)),
    openAuthorSession: (id) => run((c) => c.openAuthorSession(id)), registerNotificationSink: (sink) => run((c) => c.registerNotificationSink(sink)),
    watchPost: (postId) => Stream.unwrap(makeRpc.pipe(
      Effect.map((rpc) => makeFacade(rpc).watchPost(postId)),
      Effect.provide(PipelineClient.layerHttp({ url })),
      Effect.provide(RpcSerialization.layerJson)
    ))
  }
  return client
})

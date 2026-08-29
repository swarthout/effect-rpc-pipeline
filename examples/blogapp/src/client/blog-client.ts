import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineAuth from "effect-rpc-pipeline/Auth"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs, Authenticated, BrowserSession, PostCard, PostDetails, type PostStatus } from "../shared/contracts.js"

type MaterializeMethod<A> = A extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result extends Effect.Effect<infer Success, infer Error, any> ? Effect.Effect<Success, Error> : Result
  : A
type Facade = ReturnType<typeof makeFacade>
export type BlogClientApi = { readonly [Key in keyof Facade]: MaterializeMethod<Facade[Key]> }

type AppClient = Pipeline.ClientApi<RpcGroup.Rpcs<typeof AppRpcs>>

export class AppPipelineClient extends Context.Service<AppPipelineClient, AppClient>()("blog/AppPipelineClient") {}

export class CurrentAccessToken extends Context.Reference<Option.Option<Redacted.Redacted<string>>>("blog/CurrentAccessToken", {
  defaultValue: Option.none
}) {}

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
        comment, author: rpc.getUser({ id: comment.authorId }), canDelete: rpc.canDeleteComment({ authorId: comment.authorId })
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

export class BlogClient extends Context.Service<BlogClient, BlogClientApi>()("blog/BlogClient") {}

export const withAccessToken = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  accessToken: string
): Effect.Effect<A, E, R> => Effect.provideService(effect, CurrentAccessToken, Option.some(Redacted.make(accessToken)))

export const AuthenticatedClientLive = PipelineAuth.layerClientBearer(Authenticated, {
  token: Effect.map(CurrentAccessToken, (token) => token)
})

export const layerHttpClient = (url = "/rpc") => {
  const PipelineLive = PipelineClient.layerClientHttp(AppPipelineClient, AppRpcs, {
    url,
    id: "pipeline-press"
  }).pipe(
    Layer.provide(AuthenticatedClientLive),
    Layer.provide(RpcSerialization.layerJson)
  )
  return Layer.effect(BlogClient, Effect.map(AppPipelineClient, (rpc) => makeFacade(rpc) as unknown as BlogClientApi)).pipe(Layer.provideMerge(PipelineLive))
}

export const layerWebSocketClient = (url: string) => {
  const PipelineLive = PipelineClient.layerClientWebSocket(
    AppPipelineClient,
    AppRpcs,
    { url, id: "pipeline-press" }
  ).pipe(
    Layer.provide(AuthenticatedClientLive),
    Layer.provide(RpcSerialization.layerJson)
  )
  return Layer.effect(BlogClient, Effect.map(AppPipelineClient, (rpc) => makeFacade(rpc) as unknown as BlogClientApi)).pipe(Layer.provideMerge(PipelineLive))
}

export const makeHttpClient = (url = "/rpc", accessToken?: string): Effect.Effect<BlogClient["Service"]> =>
  PipelineClient.makeHttp(AppRpcs, { url, id: "pipeline-press" }).pipe(
    Effect.map((rpc) => makeFacade(rpc) as unknown as BlogClientApi),
    Effect.provide(PipelineAuth.layerClientBearer(Authenticated, {
      token: Effect.succeed(Option.fromNullishOr(accessToken))
    })),
    Effect.provide(RpcSerialization.layerJson)
  )

const decodeBrowserSession = Schema.decodeUnknownEffect(BrowserSession)

const sessionRequest = (path: string, body?: unknown): Effect.Effect<BrowserSession, Error> => Effect.tryPromise({
  try: async () => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      ...(body === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    })
    const value = await response.json()
    if (!response.ok) {
      const message = value !== null && typeof value === "object" && "error" in value
        ? String(value.error)
        : `Session request failed with ${response.status}`
      throw new Error(message)
    }
    return value
  },
  catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
}).pipe(Effect.flatMap(decodeBrowserSession), Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))))

export const loginSession = (input: { readonly username: string; readonly password: string }) =>
  sessionRequest("/session/login", input)

export const registerSession = (input: { readonly username: string; readonly displayName: string; readonly password: string }) =>
  sessionRequest("/session/register", input)

export const refreshSession = sessionRequest("/session/refresh")

export const logoutSession = Effect.tryPromise({
  try: async () => {
    const response = await fetch("/session/logout", { method: "POST", credentials: "same-origin" })
    if (!response.ok) throw new Error(`Logout failed with ${response.status}`)
  },
  catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
})

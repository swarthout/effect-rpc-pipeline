import { Option, Schema as S } from "effect"
import { AdminSummary, AuthTokens, PostCard, PostDetails } from "../shared/contracts.js"

export const Page = S.Literals(["Feed", "Post", "Login", "Register", "Editor", "Admin"])
export type Page = typeof Page.Type

export const Model = S.Struct({
  page: Page,
  loadState: S.Literals(["Idle", "Loading", "Ready", "Failed"]),
  feed: S.Array(PostCard),
  maybePost: S.Option(PostDetails),
  maybeSession: S.Option(AuthTokens),
  maybeAdmin: S.Option(AdminSummary),
  editingPostId: S.Option(S.String),
  search: S.String, username: S.String, displayName: S.String, password: S.String,
  title: S.String, excerpt: S.String, body: S.String, tags: S.String,
  postStatus: S.Literals(["Draft", "Published"]),
  commentBody: S.String, error: S.String
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  page: "Feed", loadState: "Loading", feed: [], maybePost: Option.none(), maybeSession: Option.none(),
  maybeAdmin: Option.none(), editingPostId: Option.none(), search: "", username: "", displayName: "",
  password: "", title: "", excerpt: "", body: "", tags: "", postStatus: "Draft", commentBody: "", error: ""
}

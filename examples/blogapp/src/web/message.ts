import { Schema as S } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { AdminSummary, BrowserSession, PostCard, PostDetails } from "../shared/contracts.js"

export const Message = defineMessageUnion({
  ClickedFeed: {}, ClickedLogin: {}, ClickedRegister: {}, ClickedEditor: {}, ClickedAdmin: {}, ClickedLogout: {},
  ClickedPost: { slug: S.String },
  ChangedSearch: { value: S.String }, ChangedUsername: { value: S.String }, ChangedDisplayName: { value: S.String },
  ChangedPassword: { value: S.String }, ChangedTitle: { value: S.String }, ChangedExcerpt: { value: S.String },
  ChangedBody: { value: S.String }, ChangedTags: { value: S.String }, ChangedComment: { value: S.String },
  SelectedPostStatus: { value: S.Literals(["Draft", "Published"]) },
  SubmittedSearch: {}, SubmittedLogin: {}, SubmittedRegister: {}, SubmittedPost: {}, SubmittedComment: {},
  ClickedUpvote: {}, ClickedDeleteComment: { id: S.String },
  ClickedSuspendUser: { id: S.String, suspended: S.Boolean },
  ClickedSetRole: { id: S.String, role: S.Literals(["Reader", "Author", "Admin"]) },
  ClickedModeratePost: { id: S.String, status: S.Literals(["Draft", "Published"]) },
  ClickedModerateComment: { id: S.String },
  SucceededLoadFeed: { posts: S.Array(PostCard) }, SucceededLoadPost: { post: PostDetails },
  SucceededLogin: { session: BrowserSession }, CompletedRestoreSession: { maybeSession: S.Option(BrowserSession) }, CompletedLogout: {}, SucceededSavePost: {}, SucceededAddComment: {},
  SucceededToggleUpvote: {}, SucceededDeleteComment: {},
  SucceededLoadAdmin: { summary: AdminSummary }, SucceededUpdateAdmin: { summary: AdminSummary },
  FailedRequest: { error: S.String }
})
export type Message = typeof Message.Type

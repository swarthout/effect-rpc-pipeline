import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Capability from "effect-rpc-pipeline/Capability"
import { Forbidden, InvalidInput, NotFound } from "./errors.js"
import { BlogEvent, Post } from "./models.js"

export const AuthorSessionRpcs = RpcGroup.make(
  Rpc.make("save", { payload: { title: Schema.String, excerpt: Schema.String, body: Schema.String, tags: Schema.Array(Schema.String) }, success: Post, error: Schema.Union([Forbidden, NotFound, InvalidInput]) }),
  Rpc.make("publish", { success: Post, error: Schema.Union([Forbidden, NotFound, InvalidInput]) }),
  Rpc.make("remove", { success: Schema.Boolean, error: Schema.Union([Forbidden, NotFound]) })
)
export const AuthorSession = Capability.make("blog/AuthorSession", AuthorSessionRpcs)
export const NotificationSinkRpcs = RpcGroup.make(Rpc.make("notify", { payload: { event: BlogEvent }, success: Schema.Boolean }))
export const NotificationSink = Capability.make("blog/NotificationSink", NotificationSinkRpcs)

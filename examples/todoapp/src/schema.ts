import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Capability from "effect-rpc-pipeline/Capability"
import { Authenticated } from "./todo.js"

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  lastSeen: Schema.Number
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

export const AuthedRpcs = RpcGroup.make(
  Rpc.make("getUserId", { success: Schema.String }),
  Rpc.make("getFriendIds", { success: Schema.Array(Schema.String) })
)

export const AuthedCapability = Capability.make("AuthedUser", AuthedRpcs)

export const AppRpcs = RpcGroup.make(
  Rpc.make("openSession", { success: AuthedCapability.schema }),
  Rpc.make("getUserProfile", {
    payload: { id: Schema.String },
    success: User
  }),
  Rpc.make("updateLastSeen", {
    payload: { id: Schema.String, timestamp: Schema.Number },
    success: User,
    error: Forbidden
  })
).middleware(Authenticated)

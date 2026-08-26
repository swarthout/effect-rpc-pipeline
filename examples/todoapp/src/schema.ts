import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Capability from "effect-rpc-pipeline/Capability"

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  lastSeen: Schema.Number
}) {}

export const AuthedRpcs = RpcGroup.make(
  Rpc.make("getUserId", { success: Schema.String }),
  Rpc.make("getFriendIds", { success: Schema.Array(Schema.String) })
)

export const AuthedCapability = Capability.make("AuthedUser", AuthedRpcs)

export const AppRpcs = RpcGroup.make(
  Rpc.make("authenticate", {
    payload: { token: Schema.String },
    success: AuthedCapability.schema
  }),
  Rpc.make("getUserProfile", {
    payload: { id: Schema.String },
    success: User
  }),
  Rpc.make("updateLastSeen", {
    payload: { id: Schema.String, timestamp: Schema.Number },
    success: User
  })
)

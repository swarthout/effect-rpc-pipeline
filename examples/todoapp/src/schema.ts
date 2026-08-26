import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Capability from "effect-rpc-pipeline/Capability"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"

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
  Rpc.make("auth.authenticate", {
    payload: { token: Schema.String },
    success: AuthedCapability.schema
  }),
  Rpc.make("users.getProfile", {
    payload: { id: Schema.String },
    success: User
  }),
  Rpc.make("users.updateLastSeen", {
    payload: { id: Schema.String, timestamp: Schema.Number },
    success: User
  })
)

export const AppPipeline = Pipeline.make({
  id: "example-app",
  root: AppRpcs,
  capabilities: [AuthedCapability]
})

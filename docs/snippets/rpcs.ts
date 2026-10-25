import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"

export const AppRpcs = RpcGroup.make(
  Rpc.make("findUser", {
    payload: { email: Schema.String },
    success: Schema.Struct({ id: Schema.String, name: Schema.String })
  }),
  Rpc.make("getProfile", {
    payload: { userId: Schema.String },
    success: Schema.Struct({ bio: Schema.String })
  })
)

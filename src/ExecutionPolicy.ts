import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

export type PeerCallPolicy =
  | { readonly _tag: "Allowed" }
  | { readonly _tag: "Denied"; readonly reason: string }

/** Internal policy used by atomic execution regions to reject reverse peer calls. */
export class PeerCalls extends Context.Reference<PeerCallPolicy>("effect-rpc-pipeline/PeerCalls", {
  defaultValue: () => ({ _tag: "Allowed" })
}) {}

export const denyPeerCalls = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  reason: string
): Effect.Effect<A, E, R> => Effect.provideService(effect, PeerCalls, { _tag: "Denied", reason })

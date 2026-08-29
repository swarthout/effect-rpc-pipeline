import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import { BlogEvent } from "../shared/contracts.js"

export const makeEvents = (changes: PubSub.PubSub<BlogEvent>) => {
  const make = (kind: BlogEvent["kind"], postId: string, message: string) => new BlogEvent({ kind, postId, message, occurredAt: Date.now() })
  const publish = (kind: BlogEvent["kind"], postId: string, message: string) => PubSub.publish(changes, make(kind, postId, message)).pipe(Effect.asVoid)
  return { make, publish }
}

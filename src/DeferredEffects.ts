import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

type DeferredEffect = Effect.Effect<unknown, unknown, never>

export type Region = {
  readonly effects: Array<DeferredEffect>
}

const Disabled = { _tag: "Disabled" } as const
type State = typeof Disabled | { readonly _tag: "Active"; readonly region: Region }

export class CurrentRegion extends Context.Reference<State>("effect-rpc-pipeline/DeferredEffects", {
  defaultValue: () => Disabled
}) {}

export const makeRegion = (): Region => ({ effects: [] })

export const provideRegion = <A, E, R>(effect: Effect.Effect<A, E, R>, region: Region): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, CurrentRegion, { _tag: "Active", region })

export const add = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> => Effect.gen(function*() {
  const state = yield* CurrentRegion
  if (state._tag === "Disabled") {
    return yield* Effect.die(new Error("Deferred effect registered outside an active execution region"))
  }
  // Run with the outer execution context after the transaction has released its
  // connection. Capturing the context here would also capture Effect SQL's
  // transaction-local connection service and make it unsafe to use after commit.
  state.region.effects.push(effect as DeferredEffect)
})

export const drain = (
  region: Region,
  onFailure: (cause: unknown) => Effect.Effect<void>
): Effect.Effect<void> => Effect.forEach(region.effects, (effect) =>
  effect.pipe(
    Effect.catchCause((cause) => onFailure(cause)),
    Effect.asVoid
  ), { concurrency: 1, discard: true })

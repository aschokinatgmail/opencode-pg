import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { WakeReceiverService, receiverNode } from "../../database/wake"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const receiver = yield* WakeReceiverService

    // Forward-declared wake ref: the drain callback needs to call
    // coordinator.wake(sessionID) on NOTIFY/backstop, but the
    // coordinator is constructed by SessionRunCoordinator.make which
    // receives the drain callback. The ref is set after make returns.
    let wakeRef: ((sessionID: SessionSchema.ID) => Effect.Effect<void>) | null = null

    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        // Memo #14 Condition 5: wrap the drain with the wake receive
        // side — subscribe to the session's NOTIFY channel, run the
        // staggered backstop, and wake the coordinator on NOTIFY /
        // backstop tick. Unsubscribe on drain exit (scope close).
        return yield* receiver.withDrain(
          sessionID,
          () => (wakeRef ? wakeRef(sessionID) : Effect.void),
          SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
            Effect.provide(locations.get(session.location)),
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
            ),
          ),
        )
      }),
    })
    wakeRef = coordinator.wake

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, receiverNode],
})

export * as SessionExecutionLocal from "./local"

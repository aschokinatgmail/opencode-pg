export * as Wake from "./wake"

import { sql } from "drizzle-orm"
import { Context, Effect, Layer, PubSub, Schedule } from "effect"
import { Database } from "./database"
import { databaseUrl, isPg } from "./database"
import { makeGlobalNode } from "../effect/app-node"

type DatabaseService = Database.Interface["db"]

// Memo #1 (PART 1, .opencode/db-decision-memos.md): NOTIFY wake bus.
//
// Per-session truncated channels `oc_s_<trunc(session_id)>` (63-byte
// NAMEDATALEN-1 limit). Tiny payloads (process tag only — never
// payload-bearing; 8000-byte NOTIFY limit). Self-drop by process tag.
// Reconnect order: LISTEN → catch-up scan → resume. Staggered poll
// backstop always-on. Correctness NEVER depends on NOTIFY (Memo #1
// invariant — the poll backstop is the safety net).
//
// Under SQLite (isPg false): the module no-ops — the current in-process
// wake path (SessionRunCoordinator.wake) remains byte-identical.

// Channel name max length: PG NAMEDATALEN-1 = 63 bytes.
const CHANNEL_MAX = 63
const CHANNEL_PREFIX = "oc_s_"

// Truncate the session ID to fit the 63-byte channel name limit.
// Memo #1 Condition 1: shared helper, single definition, used by emitter
// and listener. Current session IDs ("ses_" + 26-char descending ULID)
// yield "oc_s_ses_…" ≈ 35 bytes — well under the limit. Truncation is
// a guard for future ID shapes and MUST be stable/identical at both
// sides.
export function channelName(sessionID: string): string {
  const budget = CHANNEL_MAX - CHANNEL_PREFIX.length
  const truncated = sessionID.length > budget ? sessionID.slice(0, budget) : sessionID
  return CHANNEL_PREFIX + truncated
}

// Process tag for self-drop. Uses a per-process random UUID so listeners
// can drop their own notifications. Memo #1 UNVERIFIED #1 resolved: the
// process-tag payload makes backend-PID comparison unnecessary.
const PROCESS_TAG =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pid_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`

export function processTag(): string {
  return PROCESS_TAG
}

// --- Emission (inside commitDurableEvent's transaction) ---

// notifyInTransaction emits a NOTIFY inside the current transaction.
// Called from event.ts commitDurableEvent after the event insert, so
// the notify fires exactly when the commit lands (Memo #1: transactional
// wakeup — no notification for rolled-back events, no wakeup before
// visibility). Coalesces to one notify per session per tx (the caller
// dedupes by aggregateID within a tx; this is one notify per call).
//
// The payload is the process tag only (tiny — Memo #1: NEVER
// payload-bearing events). The listener self-drops when payload === its
// own tag.
// Minimal interface for the raw SQL runner used by notifyInTransaction.
// Lock-style erasure: the runtime db object supports `.run(sql.raw(...))`
// under both dialects, but the typed DatabaseShape (SQLite-typed) does not
// expose the raw runner in a dialect-agnostic way. This captures only the
// method we need, avoiding `any` in the DB layer (Memo #15 Cond 4).
interface RawRunner {
  run(query: ReturnType<typeof sql.raw>): { pipe: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> } & Effect.Effect<unknown>
}

export function notifyInTransaction(
  db: DatabaseService,
  sessionID: string,
): Effect.Effect<void> {
  if (!isPg) return Effect.void
  const channel = channelName(sessionID)
  const channelSafe = channel.replace(/'/g, "''")
  const tagSafe = PROCESS_TAG.replace(/'/g, "''")
  return (db as unknown as RawRunner).run(sql.raw(`SELECT pg_notify('${channelSafe}', '${tagSafe}')`)).pipe(
    Effect.orDie,
    Effect.asVoid,
  ) as Effect.Effect<void>
}

// --- Listener service (FM-27 fix: unlisten handle honored) ---
//
// Memo #14 Condition 5 / FM-27: the previous ListenerService discarded
// the `native.listen()` return value (a ListenRequest whose resolved
// ListenMeta carries `.unlisten()`). Without calling unlisten, the
// server-side LISTEN set grew monotonically — Memo #1 bounded
// cardinality violated. This version keeps the unlisten handle per
// channel and calls it when the subscriber count drops to zero.

// Minimal interface for the postgres-js ListenMeta — avoids importing
// the full `postgres` types (which would pull `any` into the service
// surface). Lock-style erasure: the runtime object is the real
// ListenMeta; we only depend on `.unlisten()`.
interface UnlistenHandle {
  readonly unlisten: () => Promise<void>
}

export interface ListenerInterface {
  readonly subscribe: (sessionID: string) => Effect.Effect<PubSub.PubSub<void>>
  readonly unsubscribe: (sessionID: string) => Effect.Effect<void>
}

export class ListenerService extends Context.Service<ListenerService, ListenerInterface>()(
  "@opencode-ai/core/database/WakeListener",
) {}

// SQLite no-op listener layer — subscribe returns a local PubSub, no
// LISTEN/NOTIFY. The in-process wake path (SessionRunCoordinator) is
// the real wake mechanism under SQLite.
const sqliteListenerLayer = Layer.sync(
  ListenerService,
  () => ListenerService.of({
    subscribe: () => PubSub.unbounded<void>(),
    unsubscribe: () => Effect.void,
  }),
)

// PG listener layer: one pinned LISTEN connection via postgres-js
// `.listen()`. postgres-js dedicates one connection for all .listen()
// calls on the same sql instance and reconnects internally. On
// reconnect the onlisten callback fires → catch-up signal (Memo #1
// reconnect order: LISTEN → catch-up → resume). Self-drop by process tag.
//
// FM-27 fix: each channel's ListenMeta is retained; unsubscribe calls
// `.unlisten()` when the refcount hits zero, releasing the server-side
// LISTEN slot (Memo #1 bounded cardinality).
//
// The listener uses its own postgres-js instance (max: 1) — a pinned
// dedicated connection separate from the query pool (Memo #12: "pinned
// LISTEN connection counts against max"). This avoids coupling to
// Pg.Native (which is internal to the Database layer) and ensures the
// listener connection survives independently of pool churn.
const pgListenerLayer = Layer.effect(
  ListenerService,
  Effect.gen(function* () {
    const native = (yield* Effect.tryPromise({
      try: () => import("postgres").then((m) => m.default(databaseUrl!, { max: 1, idle_timeout: 0 })),
      catch: () => null,
    })) as ReturnType<typeof import("postgres")> | null
    if (!native) {
      // Cond 5 (Memo #15): degrade to backstop-only (no-op listener) instead
      // of killing drain start. The backstop poll in WakeReceiver still
      // catches pending sessions; NOTIFY is a latency optimization only
      // (Memo #1 invariant — correctness never depends on NOTIFY).
      return ListenerService.of({ subscribe: () => PubSub.unbounded<void>(), unsubscribe: () => Effect.void })
    }
    yield* Effect.addFinalizer(() => Effect.promise(() => native.end({ timeout: 5 })))
    const subscribers = new Map<string, { pubsub: PubSub.PubSub<void>; count: number; unlisten: UnlistenHandle | null }>()

    const ensureListening = (sessionID: string, pubsub: PubSub.PubSub<void>): Effect.Effect<void> =>
      Effect.tryPromise({
        try: () =>
          native.listen(
            channelName(sessionID),
            (payload: string) => {
              // Memo #1: self-drop — ignore our own notifications.
              if (payload === PROCESS_TAG) return
              Effect.runFork(PubSub.publish(pubsub, void 0))
            },
            // onlisten: fires on initial LISTEN and on reconnect.
            // Memo #1 reconnect order: LISTEN (this callback) →
            // catch-up scan → resume. The catch-up is the consumer's
            // job (it polls the inbox on wake); here we signal a wake
            // so the consumer re-scans after reconnect.
            () => {
              Effect.runFork(PubSub.publish(pubsub, void 0))
            },
          ),
        catch: () => {},
      }).pipe(
        // Retain the unlisten handle (FM-27). The resolved ListenMeta
        // carries .unlisten(); we store it so unsubscribe can release
        // the server-side LISTEN slot.
        // Cond 3 (Memo #15): if the meta resolves AFTER the entry was
        // deleted (fast subscribe/unsubscribe race), call unlisten()
        // immediately instead of dropping the handle (leaked LISTEN slot).
        Effect.map((meta) => {
          const entry = subscribers.get(sessionID)
          if (entry) {
            entry.unlisten = meta as unknown as UnlistenHandle
          } else {
            const handle = meta as unknown as UnlistenHandle | null
            handle?.unlisten().catch(() => void 0)
          }
        }),
        Effect.asVoid,
      ) as Effect.Effect<void>

    return ListenerService.of({
      subscribe: (sessionID: string) =>
        Effect.gen(function* () {
          const existing = subscribers.get(sessionID)
          if (existing) {
            existing.count++
            return existing.pubsub
          }
          const pubsub = yield* PubSub.unbounded<void>()
          subscribers.set(sessionID, { pubsub, count: 1, unlisten: null })
          yield* ensureListening(sessionID, pubsub)
          return pubsub
        }),
      unsubscribe: (sessionID: string) =>
        Effect.gen(function* () {
          const entry = subscribers.get(sessionID)
          if (!entry) return
          entry.count--
          if (entry.count <= 0) {
            subscribers.delete(sessionID)
            yield* PubSub.shutdown(entry.pubsub)
            // FM-27 fix: honor the unlisten handle. Releases the
            // server-side LISTEN slot so the channel set does not
            // grow monotonically (Memo #1 bounded cardinality).
            if (entry.unlisten) {
              yield* Effect.promise(() =>
                entry.unlisten!.unlisten().then(
                  () => void 0,
                  () => void 0,
                ),
              )
            }
          }
        }),
    })
  }),
)

export const ListenerLayer = (isPg ? pgListenerLayer : sqliteListenerLayer) as Layer.Layer<ListenerService, never, never>

// --- Staggered poll backstop (Memo #1) ---
//
// Always-on, staggered per-session polls over the pending partial index
// (session_input WHERE promoted_seq IS NULL). NOTIFY is latency
// optimization only — correctness never depends on it (Memo #1
// invariant). The backstop catches wakes missed during LISTEN
// disconnects, NOTIFY queue overflow, or any other gap.
//
// The poll interval is 1.5s + jitter to avoid thundering herd. The
// caller (SessionExecution) owns the drain logic; this helper just
// provides the schedule and the wake signal.

export const backstopSchedule = Schedule.spaced(1500).pipe(
  Schedule.jittered,
  Schedule.both(Schedule.recurs(Infinity)),
)

// --- WakeReceiver: the receive-side orchestrator (Memo #14 Condition 5) ---
//
// WakeReceiver wires together the ListenerService (NOTIFY subscription)
// and the staggered poll backstop. It is process-global and session-ID
// based (AGENTS.md V2 invariant): no layer takes a Session ID; the
// drain callback passes the session ID to `withDrain`.
//
// Lifecycle (per drain):
//   1. subscribe(sessionID) → LISTEN on oc_s_<id>, get a PubSub.
//   2. Fork a backstop fiber: repeat(onWake, backstopSchedule).
//   3. Fork a NOTIFY consumer fiber: Stream.fromPubSub(pubsub) → onWake.
//   4. Run the drain Effect.
//   5. On drain exit (scope close): interrupt both fibers, unsubscribe
//      (honors the unlisten handle — FM-27).
//
// Reconnect catch-up (Memo #1): postgres-js re-fires onlisten on
// reconnect. The onlisten callback publishes to the PubSub, which the
// NOTIFY consumer forwards as onWake → the drain re-scans the inbox.
// The backstop also catches any events published during the outage
// window. No missed-wake gap between LISTEN drop and re-LISTEN because
// the backstop runs continuously and the onlisten signal triggers an
// immediate catch-up scan.

export interface WakeReceiverInterface {
  /**
   * Wraps a drain Effect with NOTIFY subscription + backstop for the
   * given session. Subscribe on enter, unsubscribe on scope close.
   * `onWake` is called on NOTIFY payload (self-dropped) and backstop
   * tick. Returns the drain's result.
   */
  readonly withDrain: <A, E, R>(
    sessionID: string,
    onWake: () => Effect.Effect<void>,
    drain: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class WakeReceiverService extends Context.Service<WakeReceiverService, WakeReceiverInterface>()(
  "@opencode-ai/core/database/WakeReceiver",
) {}

// SQLite no-op: withDrain just runs the drain unchanged. The
// in-process SessionRunCoordinator.wake is the real wake mechanism.
const sqliteReceiverLayer = Layer.succeed(
  WakeReceiverService,
  WakeReceiverService.of({
    withDrain: (_sessionID, _onWake, drain) => drain,
  }),
)

// PG receiver: subscribe + backstop + NOTIFY consumer around the drain.
const pgReceiverLayer = Layer.effect(
  WakeReceiverService,
  Effect.gen(function* () {
    const listener = yield* ListenerService

    const withDrain = <A, E, R>(
      sessionID: string,
      onWake: () => Effect.Effect<void>,
      drain: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.scoped(
        Effect.gen(function* () {
          const pubsub = yield* listener.subscribe(sessionID)
          const subscription = yield* PubSub.subscribe(pubsub)

          // Backstop fiber: staggered poll → onWake. Cheap when idle
          // (indexed partial predicate). Catches missed NOTIFYs.
          yield* Effect.forkScoped(Effect.repeat(onWake(), backstopSchedule))

          // NOTIFY consumer fiber: drain the PubSub → onWake. Each
          // NOTIFY (self-dropped by listener) and each onlisten
          // reconnect signal triggers a wake.
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.gen(function* () {
                yield* PubSub.take(subscription)
                yield* onWake()
              }),
              Schedule.forever,
            ),
          )

          // Unsubscribe on scope close (FM-27: unlisten handle honored).
          yield* Effect.addFinalizer(() => listener.unsubscribe(sessionID))

          return yield* drain
        }),
      )

    return WakeReceiverService.of({ withDrain })
  }),
)

export const WakeReceiverLayer = (
  isPg
    ? pgReceiverLayer.pipe(Layer.provide(pgListenerLayer))
    : sqliteReceiverLayer
) as Layer.Layer<WakeReceiverService, never, never>

export const receiverNode = makeGlobalNode({ service: WakeReceiverService, layer: WakeReceiverLayer, deps: [] })
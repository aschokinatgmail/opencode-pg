export * as Flush from "./flush"

import { and, asc, eq, gt, sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { Database } from "./database"
import { isPg } from "./database"
import { Lock } from "./lock"
import type { SchemaTables } from "./schema.pg"
import type { EventV2 } from "../event"
import { SessionSchema } from "../session/schema"
import type { Definition, Payload } from "@opencode-ai/schema/event"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"

type DatabaseService = Database.Interface["db"]

// Memo #2 T3 two-tier commit: the deferred flush tier.
//
// ASYNC tier membership (Memo #2, amended Memo #16): projection
// materialization of high-frequency events — SessionEvent.Tool.Progress.
// Text.Delta is live-only by design (never durable, never projected).
// Tool.Progress is deferred from the sync event-commit tx to a bounded-
// concurrency flush pool. The flush reads unprojected events from the log,
// runs the registered async-tier projectors, and advances
// session_projection_checkpoint in the SAME transaction (HARD rule —
// checkpoint never ahead of projection).
//
// Under SQLite (isPg false): the two-tier collapses to synchronous single-tier.
// All projectors run in-tx; the checkpoint is written synchronously. The
// flush function is still callable (for flush-on-read) but is a no-op when
// the checkpoint is already at the latest seq (idempotent).
//
// Flush pool sizing (Memo #2 Cond 5, Memo #10 Cond 6): bounded separately
// from the session pool. 4 concurrent flushes is sufficient for staging/beta
// with a handful of concurrent sessions; each flush is a short tx.

const FLUSH_POOL_SIZE = 4
const flushSemaphore = Semaphore.makeUnsafe(FLUSH_POOL_SIZE)

// Event types whose projectors are deferred to the async flush tier (Memo #2).
// Tool.Progress is the high-frequency projection event (Memo #16: Text.Delta
// is live-only, never registered). All other event types run their
// projectors in the sync event-commit tx.
const ASYNC_TIER_TYPES = new Set<string>()

export function registerAsyncTierType(type: string): void {
  ASYNC_TIER_TYPES.add(type)
}

export function isAsyncTier(type: string): boolean {
  return ASYNC_TIER_TYPES.has(type)
}

// Read the current checkpoint for a session. Returns -1 if no checkpoint
// exists (no events projected yet).
export function readCheckpoint(db: DatabaseService, schema: SchemaTables, sessionID: string) {
  return Effect.gen(function* () {
    const row = yield* db
      .select({ applied_seq: schema.SessionProjectionCheckpointTable.applied_seq })
      .from(schema.SessionProjectionCheckpointTable)
      .where(eq(schema.SessionProjectionCheckpointTable.session_id, SessionSchema.ID.make(sessionID)))
      .get()
      .pipe(Effect.orDie)
    return row?.applied_seq ?? -1
  })
}

// Advance the checkpoint for a session. Idempotent: only advances forward.
// Writes the projected rows AND the checkpoint advance in the SAME tx
// (Memo #2 HARD rule — checkpoint never ahead of durable projection rows).
function advanceCheckpoint(
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: string,
  appliedSeq: number,
) {
  const CheckpointTable = schema.SessionProjectionCheckpointTable
  return db
    .insert(CheckpointTable)
    .values({ session_id: SessionSchema.ID.make(sessionID), applied_seq: appliedSeq, time_updated: Date.now() })
    .onConflictDoUpdate({
      target: CheckpointTable.session_id,
      set: {
        applied_seq: sql`CASE WHEN ${CheckpointTable.applied_seq} > ${appliedSeq} THEN ${CheckpointTable.applied_seq} ELSE ${appliedSeq} END`,
        time_updated: Date.now(),
      },
    })
    .run()
    .pipe(Effect.orDie)
}

// Projection-lag gauge (Memo #2 / PART 2 observability):
// event_sequence.seq - COALESCE(checkpoint.applied_seq, -1) per session.
// Flush-on-read advances applied_seq, so a broken flush surfaces as lag.
export function lagGauge(db: DatabaseService, schema: SchemaTables, sessionID: string) {
  if (!sessionID.startsWith("ses_")) return Effect.succeed(0)
  return Effect.gen(function* () {
    const [seqRow, checkpointRow] = yield* Effect.all(
      [
        db
          .select({ seq: schema.EventSequenceTable.seq })
          .from(schema.EventSequenceTable)
          .where(eq(schema.EventSequenceTable.aggregate_id, sessionID))
          .get()
          .pipe(Effect.orDie),
        db
          .select({ applied_seq: schema.SessionProjectionCheckpointTable.applied_seq })
          .from(schema.SessionProjectionCheckpointTable)
          .where(eq(schema.SessionProjectionCheckpointTable.session_id, SessionSchema.ID.make(sessionID)))
          .get()
          .pipe(Effect.orDie),
      ],
      { concurrency: "unbounded" },
    )
    const committed = seqRow?.seq ?? -1
    const applied = checkpointRow?.applied_seq ?? -1
    return committed - applied
  })
}

// Ensure a checkpoint row exists for the session before claiming it FOR
// UPDATE. Under PG, FOR UPDATE on a non-existent row does not serialize
// concurrent flushes (both see "no row", both proceed). We insert-if-absent
// inside the flush tx BEFORE claiming, so the subsequent FOR UPDATE has a
// row to lock. The insert is idempotent (onConflictDoNothing) and the
// applied_seq starts at -1 (no events projected). The claim FOR UPDATE then
// serializes concurrent same-session flushes on this row (FM-33).
//
// Design choice (Memo #15 Cond 1(iv)): insert-if-absent inside the tx before
// claiming, rather than claim-via-upsert. The upsert form would race two
// concurrent flushes through the INSERT ... ON CONFLICT path; the
// insert-then-claim form makes the FOR UPDATE the single serialization
// point. Both run inside the same db.transaction so the insert and the
// claim share one connection (no self-deadlock). Under SQLite the Lock
// helper is identity (single-writer, no FOR UPDATE) so this is a no-op
// insert-if-absent followed by a plain read.
function ensureCheckpointRow(
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: string,
) {
  const CheckpointTable = schema.SessionProjectionCheckpointTable
  return db
    .insert(CheckpointTable)
    .values({ session_id: SessionSchema.ID.make(sessionID), applied_seq: -1, time_updated: Date.now() })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
}

// Claim the checkpoint row FOR UPDATE at flush start (per-session
// serialization, FM-33). Returns the current applied_seq. Under SQLite the
// Lock helper is identity (single-writer, no row lock needed).
function claimCheckpoint(
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: string,
) {
  return Effect.gen(function* () {
    yield* ensureCheckpointRow(db, schema, sessionID)
    const row = yield* db
      .select({ applied_seq: schema.SessionProjectionCheckpointTable.applied_seq })
      .from(schema.SessionProjectionCheckpointTable)
      .where(eq(schema.SessionProjectionCheckpointTable.session_id, SessionSchema.ID.make(sessionID)))
      .pipe(Lock.forUpdate)
      .get()
      .pipe(Effect.orDie)
    return row?.applied_seq ?? -1
  })
}

// Flush unprojected events for a session: claim the checkpoint row FOR
// UPDATE, read events with seq > checkpoint, run their async-tier projectors,
// advance checkpoint — all in ONE db.transaction (Memo #2 Cond 3 restored,
// Memo #15 Cond 1(iii)+(iv)). Idempotent — a double flush advances nothing
// because the checkpoint is already at the latest seq.
//
// Lock order (Memo #15 Cond 1(iv), no deadlock cycle): checkpoint row
// (FOR UPDATE here) → project batch (no locks) → checkpoint advance. The
// flush NEVER takes session_input or event_sequence locks, so it cannot
// cycle with the drain path (which takes session_input → event_sequence).
//
// The projectors are looked up from the EventV2 service's projector registry
// via runProjectors (which applies the FM-30 key fix + FM-31 async-tier
// filter). This function is called:
// (a) After each event commit under PG (scheduled on the flush pool, not
//     the caller's fiber).
// (b) By flush-on-read in history.ts when lag exceeds threshold.
// (c) Synchronously under SQLite (collapse to single-tier — but in practice
//     the checkpoint is already at the latest seq so this is a no-op).
export function flush(
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  sessionID: string,
): Effect.Effect<void> {
  // Only session aggregates have checkpoints (FK references session.id).
  if (!sessionID.startsWith("ses_")) return Effect.void
  return flushSemaphore.withPermit(
    db
      .transaction(() =>
        Effect.gen(function* () {
          const appliedSeq = yield* claimCheckpoint(db, schema, sessionID)
          const eventRows = yield* db
            .select()
            .from(schema.EventTable)
            .where(and(eq(schema.EventTable.aggregate_id, sessionID), gt(schema.EventTable.seq, appliedSeq)))
            .orderBy(asc(schema.EventTable.seq))
            .all()
            .pipe(Effect.orDie)
          if (eventRows.length === 0) return
          const latestSeq = eventRows[eventRows.length - 1]!.seq
          yield* events.runProjectors(sessionID, eventRows)
          yield* advanceCheckpoint(db, schema, sessionID, latestSeq)
        }),
      )
      .pipe(Effect.orDie),
  )
}

// Schedule a flush on the flush pool (forked, not the caller's fiber).
// Used by commitDurableEvent after the sync tier commits under PG.
//
// FM-32 fix (Memo #15 Cond 1(v)): the fork is supervised — defects are
// logged with the sessionID and the fiber stops (log-and-stop, no retry
// loop). An unsupervised fork would swallow projector defects silently;
// the lag gauge surfaces a broken flush as lag, but the defect itself
// must be observable for diagnosis.
export function scheduleFlush(
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  sessionID: string,
): void {
  if (!isPg) return
  Effect.runFork(
    flush(db, schema, events, sessionID).pipe(
      Effect.catchDefect((defect) =>
        Effect.logError("Flush defect", defect).pipe(Effect.annotateLogs({ sessionID }), Effect.asVoid),
      ),
    ),
  )
}
export * as SessionContextEpoch from "./context-epoch"

import { and, eq, lte } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import type { Database } from "../database/database"
import type { SchemaTables } from "../database/schema.pg"
import { EventV2 } from "../event"
import { SystemContext } from "../system-context/index"
import { ContextSnapshotDecodeError } from "./error"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

type DatabaseService = Database.Interface["db"]

interface Prepared {
  readonly baseline: string
  readonly baselineSeq: number
}

export function initialize(
  db: DatabaseService,
  schema: SchemaTables,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
): Effect.Effect<Prepared | undefined, SystemContext.InitializationBlocked> {
  return initializeOnce(db, schema, context, sessionID).pipe(Effect.withSpan("SessionContextEpoch.initialize"))
}

export function prepare(
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
): Effect.Effect<Prepared, SystemContext.InitializationBlocked | ContextSnapshotDecodeError> {
  return prepareOnce(db, schema, events, context, sessionID).pipe(Effect.withSpan("SessionContextEpoch.prepare"))
}

const prepareOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
) {
  const [value, stored, compaction] = yield* Effect.all(
    [context, find(db, schema, sessionID), SessionHistory.latestCompaction(db, schema, sessionID)],
    { concurrency: "unbounded" },
  )
  if (!stored) {
    const generation = yield* SystemContext.initialize(value)
    const baselineSeq = yield* insert(db, schema, sessionID, generation)
    return { baseline: generation.baseline, baselineSeq }
  }

  const snapshot = yield* Schema.decodeUnknownEffect(SystemContext.Snapshot)(stored.snapshot).pipe(
    Effect.mapError((error) => new ContextSnapshotDecodeError({ sessionID, details: String(error) })),
  )
  const replacementSeq = compaction !== undefined && compaction.seq > stored.baseline_seq ? compaction.seq : undefined
  const result = replacementSeq
    ? yield* SystemContext.replace(value, snapshot)
    : yield* SystemContext.reconcile(value, snapshot)
  if (result._tag === "Unchanged" || result._tag === "ReplacementBlocked") {
    return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
  }
  if (result._tag === "ReplacementReady") {
    const baselineSeq = replacementSeq ?? (yield* EventV2.latestSequence(db, schema, sessionID))
    return yield* replace(db, schema, sessionID, baselineSeq, result.generation)
  }

  yield* events.publish(
    SessionEvent.ContextUpdated,
    { sessionID, messageID: SessionMessage.ID.create(), timestamp: yield* DateTime.now, text: result.text },
    { commit: () => advance(db, schema, sessionID, result.snapshot).pipe(Effect.orDie) },
  )
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

const initializeOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
) {
  if (yield* exists(db, schema, sessionID)) return
  const generation = yield* context.pipe(Effect.flatMap(SystemContext.initialize))
  const baselineSeq = yield* insert(db, schema, sessionID, generation)
  return { baseline: generation.baseline, baselineSeq }
})

const exists = Effect.fn("SessionContextEpoch.exists")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  return (
    (yield* db
      .select({ sessionID: SessionContextEpochTable.session_id })
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

const find = Effect.fn("SessionContextEpoch.find")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  return yield* db
    .select()
    .from(SessionContextEpochTable)
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

export const reset = Effect.fn("SessionContextEpoch.reset")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  yield* db
    .delete(SessionContextEpochTable)
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const insert = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  generation: SystemContext.Generation,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  const baselineSeq = yield* EventV2.latestSequence(db, schema, sessionID)
  // B4.1: INSERT ... ON CONFLICT (session_id) DO NOTHING + read-back via find().
  // The RETURNED baseline_seq must come from the read-back row, never the
  // local computation. Handles the two-processes-resuming-one-session race
  // (PG multi-process reachable; today impossible under Semaphore(1)).
  yield* db
    .insert(SessionContextEpochTable)
    .values({
      session_id: sessionID,
      baseline: generation.baseline,
      snapshot: generation.snapshot,
      baseline_seq: baselineSeq,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const stored = yield* find(db, schema, sessionID)
  if (!stored) return yield* Effect.die("Context Epoch not found after insert")
  return stored.baseline_seq
})

export const replace = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
  generation: SystemContext.Generation,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  // B4.2: monotonic guarded UPDATE — SET baseline=…, snapshot=…,
  // baseline_seq=:new WHERE session_id=:id AND baseline_seq <= :new + .returning().
  // 0 rows ⇒ a newer epoch won — not an error: re-read via find() and
  // continue with the stored row.
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({
      baseline: generation.baseline,
      snapshot: generation.snapshot,
      baseline_seq: baselineSeq,
    })
    .where(and(eq(SessionContextEpochTable.session_id, sessionID), lte(SessionContextEpochTable.baseline_seq, baselineSeq)))
    .returning({ baseline: SessionContextEpochTable.baseline, baselineSeq: SessionContextEpochTable.baseline_seq })
    .get()
    .pipe(Effect.orDie)
  if (updated) return updated
  const stored = yield* find(db, schema, sessionID)
  if (!stored) return yield* Effect.die("Context Epoch not found")
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

const advance = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  snapshot: SystemContext.Snapshot,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({ snapshot })
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .returning({ sessionID: SessionContextEpochTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die("Context Epoch not found")
})

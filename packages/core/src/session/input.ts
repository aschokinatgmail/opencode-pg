export * as SessionInput from "./input"

import { and, asc, eq, isNull, lte } from "drizzle-orm"
import { Cause, DateTime, Effect, Exit, Result, Schema } from "effect"
import { Admitted, Delivery } from "@opencode-ai/schema/session-input"
import type { Database } from "../database/database"
import type { SchemaTables } from "../database/schema.pg"
import { Lock } from "../database/lock"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: SchemaTables["SessionInputTable"]["$inferSelect"]): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  id: SessionMessage.ID,
) {
  const SessionInputTable = schema.SessionInputTable
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  const existing = yield* find(db, schema, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, schema, input.id).pipe(
          Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect))),
        ),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const SessionMessageTable = schema.SessionMessageTable
  const SessionInputTable = schema.SessionInputTable
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const SessionMessageTable = schema.SessionMessageTable
  const SessionInputTable = schema.SessionInputTable
  // Check for an existing session_message row (consistent with
  // projectAdmitted). If the promotion was already projected (e.g. a
  // previous partial attempt, or a replay), die with LifecycleConflict
  // so the savepoint rolls back and the batch continues.
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, schema, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const SessionInputTable = schema.SessionInputTable
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<SchemaTables["SessionInputTable"]["$inferSelect"]>,
) {
  let promoted = 0
  for (const row of rows) {
    const id = SessionMessage.ID.make(row.id)
    // Memo #14 Condition 3 (FM-29): each per-event promotion runs under a
    // nested savepoint (commitDurableEvent's db.transaction). A
    // LifecycleConflict on one input rolls back to its savepoint (undoing
    // that event's writes) and the batch CONTINUES with the remaining
    // inputs — no whole-batch abort on a single input's conflict.
    const exit = yield* Effect.exit(
      events.publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: decodePrompt(row.prompt),
        delivery: row.delivery,
      }),
    )
    if (Exit.isSuccess(exit)) {
      promoted++
      continue
    }
    // Memo #14 Condition 3: skip LifecycleConflict defects (the savepoint
    // already rolled back that event's writes). Re-throw all other failures.
    const defect = Cause.findDefect(exit.cause)
    if (Result.isSuccess(defect) && defect.success instanceof LifecycleConflict) continue
    yield* Effect.failCause(exit.cause)
  }
  return promoted
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const SessionInputTable = schema.SessionInputTable
  // Memo #14 Condition 3 (FM-29): claim-then-promote in ONE transaction.
  // The pending-SELECT FOR UPDATE SKIP LOCKED (Lock.forUpdateSkipLocked)
  // claims the candidate rows inside the wrapping db.transaction so the
  // row locks survive past autocommit statement-end and hold until commit.
  // Each per-event promotion runs via events.publish → commitDurableEvent
  // → nested db.transaction (savepoint in both bridges — effect_pg_${id}
  // / effect_sql_${id}). A LifecycleConflict on one input rolls back to its
  // savepoint and the batch CONTINUES with the remaining inputs (the
  // publish helper's catchDefect already handles per-event conflicts).
  // The batch commits atomically at the end.
  //
  // Lock ordering rule (deadlock prevention, Oracle FINAL ruling):
  // session_input rows (FOR UPDATE SKIP LOCKED here) are claimed BEFORE
  // event_sequence rows (FOR UPDATE in commitDurableEvent's T2). Non-drain
  // publishers take only event_sequence → no cycle. This ordering is
  // inherent: the SELECT claims session_input rows first, then each
  // events.publish takes event_sequence inside the same tx.
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, sessionID),
              isNull(SessionInputTable.promoted_seq),
              eq(SessionInputTable.delivery, "steer"),
              lte(SessionInputTable.admitted_seq, cutoff),
            ),
          )
          .orderBy(asc(SessionInputTable.admitted_seq))
          // Locked decision #5: FOR UPDATE SKIP LOCKED over the pending
          // partial index. Drain arbitration — concurrent drain calls for
          // different sessions don't block each other; same-session calls
          // skip each other's locked rows. The promoted_seq IS NULL predicate
          // stays load-bearing (do not weaken it). Under SQLite: identity
          // passthrough (Lock.forUpdateSkipLocked, database/lock.ts).
          .pipe(Lock.forUpdateSkipLocked)
          .all()
          .pipe(Effect.orDie)
        return yield* publish(db, schema, events, sessionID, rows)
      }),
    )
    .pipe(Effect.orDie)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const SessionInputTable = schema.SessionInputTable
  // Memo #14 Condition 3 (FM-29): claim-then-promote in ONE transaction
  // (see promoteSteers for the full ruling). promoteNextQueued claims
  // limit(1) row via FOR UPDATE SKIP LOCKED inside the wrapping tx. Lock
  // ordering: session_input row BEFORE event_sequence (same as promoteSteers).
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, sessionID),
              isNull(SessionInputTable.promoted_seq),
              eq(SessionInputTable.delivery, "queue"),
            ),
          )
          .orderBy(asc(SessionInputTable.admitted_seq))
          .limit(1)
          // Locked decision #5: FOR UPDATE SKIP LOCKED (see promoteSteers).
          .pipe(Lock.forUpdateSkipLocked)
          .get()
          .pipe(Effect.orDie)
        return row === undefined ? false : yield* publish(db, schema, events, sessionID, [row]).pipe(Effect.as(true))
      }),
    )
    .pipe(Effect.orDie)
})
import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database"
import type { SchemaTables } from "../database/schema.pg"
import { Flush } from "../database/flush"
import { EventV2 } from "../event"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

export const latestCompaction = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
) {
  const SessionMessageTable = schema.SessionMessageTable
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const SessionMessageTable = schema.SessionMessageTable
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: SchemaTables["SessionMessageTable"]["$inferSelect"]) =>
  decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )

// T3 (Memo #2) flush-on-read: when a reader detects projection lag beyond
// the threshold, trigger the flush path (bounded, idempotent via checkpoint).
// Under SQLite the checkpoint is always at the latest seq (single-tier
// collapse), so lag is 0 and this is a no-op.
const FLUSH_ON_READ_THRESHOLD = 0

export const load = Effect.fn("SessionHistory.load")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
) {
  const SessionContextEpochTable = schema.SessionContextEpochTable
  // T3 (Memo #2): flush-on-read — check projection lag before reading
  // messages. If lag > threshold, trigger the flush to apply deferred
  // async-tier projections so the reader sees up-to-date session_message
  // rows. Idempotent: a double flush advances nothing.
  //
  // FM-31 read-path blast radius elimination (Memo #15 Cond 1(vi)): if the
  // flush throws a projector defect, the read DEGRADES instead of dying —
  // we log the defect and serve the read with the lag still visible in the
  // gauge. A broken flush must not make PG history unreadable for any real
  // session; the lag gauge is the observable signal that the flush is
  // broken, and the next flush attempt retries.
  const lag = yield* Flush.lagGauge(db, schema, sessionID)
  if (lag > FLUSH_ON_READ_THRESHOLD) {
    const events = yield* EventV2.Service
    yield* Flush.flush(db, schema, events, sessionID).pipe(
      Effect.catchDefect((defect) =>
        Effect.logError("Flush-on-read defect; serving read with lag", defect).pipe(
          Effect.annotateLogs({ sessionID }),
          Effect.asVoid,
        ),
      ),
    )
  }
  const [epoch, compaction] = yield* Effect.all(
    [
      db
        .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
      latestCompaction(db, schema, sessionID),
    ],
    { concurrency: "unbounded" },
  )
  return yield* Effect.forEach(yield* messageRows(db, schema, sessionID, compaction, epoch?.baselineSeq), decodeMessageRow)
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, schema, sessionID, baselineSeq)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  schema: SchemaTables,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, schema, sessionID, yield* latestCompaction(db, schema, sessionID), baselineSeq)
  return yield* Effect.forEach(rows, (row) =>
    decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
  )
})

export * as SessionHistory from "./history"
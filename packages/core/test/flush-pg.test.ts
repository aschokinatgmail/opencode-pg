// Step 5b-2 integration tests: T3 two-tier commit (Memo #2).
// Memo #15 Condition 2: projection-OUTCOME asserts (not just checkpoint arithmetic).
//
// Gated on TEST_DATABASE_URL (ephemeral postgres:17-alpine). The tests
// are no-ops without it so the default SQLite suite is unaffected.
//
// Test matrix (Memo #15 Cond 2 — FM-18/28 discipline: non-vacuity row-count
// asserts BEFORE behavior asserts; isPg sanity assert stays):
// (a) isPg activation sanity.
// (b) Publish Tool.Progress (durable async-tier) through the real EventV2
//     pipe with SessionProjector mounted → assert session_message row
//     MATERIALIZED by the flush (row-count AND content — the progress
//     structured/content appears in the assistant message data). Lag
//     drains to 0 after flush.
// (c) Double-flush idempotent — AND produces IDENTICAL session_message.data
//     content (delta idempotency proof, Memo #15 UNVERIFIED 1).
// (d) Concurrent same-session flushes non-duplicating (FM-33 serialization).
// (e) One sync-tier-heavy session (PromptAdmitted x2) flushes WITHOUT
//     projector death (FM-31 guard — fails if the async-tier filter is missing).
// (f) flush no-ops for non-session aggregates.
//
// FM-30 fail-before/pass-after: before the fix, runProjectors looked up
// projectors by the versioned row.type (e.g. "session.next.tool.progress.1")
// against a map keyed by the unversioned definition.type — every lookup
// missed, so the async tier NEVER projected under PG. The checkpoint
// advanced anyway (checkpoint-ahead-of-projection). These tests assert
// projected ROWS and CONTENT, so they FAIL on the pre-fix code (the
// session_message row would not have the progress content) and PASS after.
//
// Note on Text.Delta: Text.Delta is a live-only stream fragment (not
// durable — schema/session-event.ts omits the durable option). It flows
// through the in-process pubsub but is never persisted to the event log,
// so the flush cannot project it under PG. Tool.Progress IS durable +
// async-tier, so it is the projection-outcome test target. Text.Delta
// projection is exercised under SQLite (single-tier collapse) by the
// session-projector suite.

import { describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Layer } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseUrl = testDatabaseUrl

let isPg = false
let Database: typeof import("@opencode-ai/core/database/database")
let DatabaseSchema: typeof import("@opencode-ai/core/database/schema.pg")
let DatabaseMigrationPg: typeof import("@opencode-ai/core/database/migration.pg")
let SchemaPgNamespace: typeof import("@opencode-ai/core/schema-pg-namespace")
let EventV2: typeof import("@opencode-ai/core/event")
let SessionEvent: typeof import("@opencode-ai/core/session/event")
let Flush: typeof import("@opencode-ai/core/database/flush")
let AppNodeBuilder: typeof import("@opencode-ai/core/effect/app-node-builder")
let LayerNode: typeof import("@opencode-ai/core/effect/layer-node")
let Location: typeof import("@opencode-ai/core/location")
let Project: typeof import("@opencode-ai/core/project")
let WorkspaceV2: typeof import("@opencode-ai/core/workspace")
let SessionProjector: typeof import("@opencode-ai/core/session/projector")
let SessionStore: typeof import("@opencode-ai/core/session/store")
let PgProjectTable: typeof import("@opencode-ai/core/project/sql.pg").ProjectTable
let PgSessionTable: typeof import("@opencode-ai/core/session/sql.pg").SessionTable
let PgEventSequenceTable: typeof import("@opencode-ai/core/event/sql.pg").EventSequenceTable
let PgSessionProjectionCheckpointTable: typeof import("@opencode-ai/core/session/sql.pg").SessionProjectionCheckpointTable
let PgSessionMessageTable: typeof import("@opencode-ai/core/session/sql.pg").SessionMessageTable
let ProjectSchema: typeof import("@opencode-ai/core/project/schema")
let SessionSchema: typeof import("@opencode-ai/core/session/schema")
let SessionMessage: typeof import("@opencode-ai/core/session/message")
let ModelV2: typeof import("@opencode-ai/core/model")
let ProviderV2: typeof import("@opencode-ai/core/provider")
let AbsolutePath: typeof import("@opencode-ai/core/schema").AbsolutePath

type DbShape = import("@opencode-ai/core/database/database").Database.Interface["db"]

const modulesLoaded = testDatabaseUrl
  ? (async () => {
      process.env.DATABASE_URL = testDatabaseUrl
      const database = await import("@opencode-ai/core/database/database")
      const dbSchema = await import("@opencode-ai/core/database/schema.pg")
      const migrationPg = await import("@opencode-ai/core/database/migration.pg")
      const schemaPgNs = await import("@opencode-ai/core/schema-pg-namespace")
      const eventV2 = await import("@opencode-ai/core/event")
      const sessionEvent = await import("@opencode-ai/core/session/event")
      const flush = await import("@opencode-ai/core/database/flush")
      const sessionProjector = await import("@opencode-ai/core/session/projector")
      const sessionStore = await import("@opencode-ai/core/session/store")
      const appNodeBuilder = await import("@opencode-ai/core/effect/app-node-builder")
      const layerNode = await import("@opencode-ai/core/effect/layer-node")
      const location = await import("@opencode-ai/core/location")
      const project = await import("@opencode-ai/core/project")
      const workspaceV2 = await import("@opencode-ai/core/workspace")
      const projectSqlPg = await import("@opencode-ai/core/project/sql.pg")
      const sessionSqlPg = await import("@opencode-ai/core/session/sql.pg")
      const eventSqlPg = await import("@opencode-ai/core/event/sql.pg")
      const projectSchema = await import("@opencode-ai/core/project/schema")
      const sessionSchema = await import("@opencode-ai/core/session/schema")
      const sessionMessage = await import("@opencode-ai/core/session/message")
      const modelV2 = await import("@opencode-ai/core/model")
      const providerV2 = await import("@opencode-ai/core/provider")
      const schema = await import("@opencode-ai/core/schema")
      Database = database
      DatabaseSchema = dbSchema
      DatabaseMigrationPg = migrationPg
      SchemaPgNamespace = schemaPgNs
      EventV2 = eventV2
      SessionEvent = sessionEvent
      Flush = flush
      SessionProjector = sessionProjector
      SessionStore = sessionStore
      AppNodeBuilder = appNodeBuilder
      LayerNode = layerNode
      Location = location
      Project = project
      WorkspaceV2 = workspaceV2
      PgProjectTable = projectSqlPg.ProjectTable
      PgSessionTable = sessionSqlPg.SessionTable
      PgEventSequenceTable = eventSqlPg.EventSequenceTable
      PgSessionProjectionCheckpointTable = sessionSqlPg.SessionProjectionCheckpointTable
      PgSessionMessageTable = sessionSqlPg.SessionMessageTable
      ProjectSchema = projectSchema
      SessionSchema = sessionSchema
      SessionMessage = sessionMessage
      ModelV2 = modelV2
      ProviderV2 = providerV2
      AbsolutePath = schema.AbsolutePath
      isPg = database.isPg
    })()
  : Promise.resolve()

const TEST_TIMEOUT = 30_000

const makeDb = EffectDrizzlePg.makeWithDefaults()
type PgDb = Awaited<Effect.Success<typeof makeDb>>

const run = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(pgLayer({ url: databaseUrl! }))) as Effect.Effect<A, E, never>,
  )

const boot = Effect.gen(function* () {
  const client = yield* Client.SqlClient
  yield* client.unsafe("DROP SCHEMA public CASCADE").withoutTransform
  yield* client.unsafe("CREATE SCHEMA public").withoutTransform
  yield* DatabaseMigrationPg.apply(client)
  const db = yield* makeDb
  return { db, schema: SchemaPgNamespace.namespace }
})

const CREATED_MS = 1737360000000

const setupProject = (db: PgDb, projectID: string) =>
  db
    .insert(PgProjectTable)
    .values({
      id: ProjectSchema.ID.make(projectID),
      worktree: AbsolutePath.make(`/tmp/${projectID}`),
      sandboxes: [],
    })
    .run()
    .pipe(Effect.orDie)

const setupSession = (db: PgDb, sessionID: string, projectID: string = `pro_${sessionID}`) =>
  Effect.gen(function* () {
    yield* setupProject(db, projectID)
    yield* db
      .insert(PgSessionTable)
      .values({
        id: SessionSchema.ID.make(sessionID),
        project_id: ProjectSchema.ID.make(projectID),
        slug: sessionID,
        directory: `/tmp/${sessionID}`,
        title: sessionID,
        version: "1.0.0",
        time_created: CREATED_MS,
        time_updated: CREATED_MS,
      })
      .run()
      .pipe(Effect.orDie)
  })

const preCreateEventSequence = (db: PgDb, sessionID: string) =>
  db
    .insert(PgEventSequenceTable)
    .values({ aggregate_id: sessionID, seq: -1 })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

const locationLayer = () =>
  Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make("/tmp/flush-pg"),
      workspaceID: WorkspaceV2.ID.make("wrk_flush"),
      project: { id: Project.ID.global, directory: AbsolutePath.make("/tmp/flush-pg") },
    }),
  )
const eventLayer = () =>
  Layer.merge(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
      [[Location.node, locationLayer()]],
    ),
    Layer.succeed(DatabaseSchema.Schema, SchemaPgNamespace.namespace),
  )

const model = () => ({ id: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test-provider") })

const readAssistantMessage = (db: PgDb, sessionID: string, assistantMessageID: string) =>
  db
    .select()
    .from(PgSessionMessageTable)
    .where(
      and(
        eq(PgSessionMessageTable.session_id, SessionSchema.ID.make(sessionID)),
        eq(PgSessionMessageTable.id, SessionMessage.ID.make(assistantMessageID)),
      ),
    )
    .get()
    .pipe(Effect.orDie)

const countSessionMessages = (db: PgDb, sessionID: string) =>
  db
    .select()
    .from(PgSessionMessageTable)
    .where(eq(PgSessionMessageTable.session_id, SessionSchema.ID.make(sessionID)))
    .all()
    .pipe(Effect.orDie, Effect.map((rows) => rows.length))

const readCheckpoint = (db: PgDb, sessionID: string) =>
  db
    .select()
    .from(PgSessionProjectionCheckpointTable)
    .where(eq(PgSessionProjectionCheckpointTable.session_id, SessionSchema.ID.make(sessionID)))
    .get()
    .pipe(Effect.orDie)

const readSeq = (db: PgDb, sessionID: string) =>
  db
    .select()
    .from(PgEventSequenceTable)
    .where(eq(PgEventSequenceTable.aggregate_id, sessionID))
    .get()
    .pipe(Effect.orDie)

// Publish the sync-tier scaffolding (Step.Started + Tool.Input.Started +
// Tool.Called) so the assistant message + tool slot exist, then publish
// Tool.Progress (async-tier). Returns the assistantMessageID.
type EventV2Interface = import("@opencode-ai/core/event").EventV2.Interface

const publishToolProgressSetup = (
  events: EventV2Interface,
  sessionID: import("@opencode-ai/core/session/schema").ID,
  assistantMessageID: string,
) =>
  Effect.gen(function* () {
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID: SessionMessage.ID.make(assistantMessageID),
      agent: "build",
      model: model(),
      timestamp: DateTime.makeUnsafe(CREATED_MS),
    })
    yield* events.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID: SessionMessage.ID.make(assistantMessageID),
      callID: "call_1",
      name: "bash",
      timestamp: DateTime.makeUnsafe(CREATED_MS + 1),
    })
    yield* events.publish(SessionEvent.Tool.Called, {
      sessionID,
      assistantMessageID: SessionMessage.ID.make(assistantMessageID),
      callID: "call_1",
      tool: "bash",
      input: { command: "echo hi" },
      provider: { executed: false },
      timestamp: DateTime.makeUnsafe(CREATED_MS + 2),
    })
  })

describe("T3 two-tier commit — isPg activation (FM-28b)", () => {
  test("isPg is true when TEST_DATABASE_URL is set", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
  }, TEST_TIMEOUT)
})

// (b) Tool.Progress projection outcome: publish through the real EventV2
// pipe, flush, assert the session_message row has the progress content
// MATERIALIZED. Tool.Progress is the durable async-tier event.
describe("T3 two-tier commit — Tool.Progress projection MATERIALIZED by flush (FM-30)", () => {
  test("publish Tool.Progress → flush → session_message row has progress content", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_tool_progress_proj")
        const assistantMessageID = "msg_asst_tool_progress"

        yield* setupSession(db, sessionID)
        yield* preCreateEventSequence(db, sessionID)

        // Non-vacuity: session row exists
        const sessionRow = yield* db
          .select()
          .from(PgSessionTable)
          .where(eq(PgSessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(sessionRow).toBeDefined()

        const events = yield* EventV2.Service
        yield* publishToolProgressSetup(events, sessionID, assistantMessageID)
        // Async tier: Tool.Progress — deferred to the flush under PG.
        yield* events.publish(SessionEvent.Tool.Progress, {
          sessionID,
          assistantMessageID: SessionMessage.ID.make(assistantMessageID),
          callID: "call_1",
          structured: { progress: "50%" },
          content: [{ type: "text", text: "running..." }],
          timestamp: DateTime.makeUnsafe(CREATED_MS + 3),
        })

        // Non-vacuity: events committed to the log (4 events: step, input.started, called, progress)
        const seqRow = yield* readSeq(db, sessionID)
        expect(seqRow?.seq).toBe(3)

        // Before flush: the assistant message row exists (from Step.Started,
        // sync-tier) but the tool progress content is NOT yet materialized
        // (Tool.Progress is async-tier, deferred to flush).
        const beforeMsg = yield* readAssistantMessage(db, sessionID, assistantMessageID)
        expect(beforeMsg).toBeDefined()
        const beforeData = beforeMsg!.data as {
          content?: Array<{
            type: string
            state?: { status: string; structured?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }
          }>
        }
        const beforeTool = beforeData.content?.find((c) => c.type === "tool")
        expect(beforeTool?.state?.structured).toEqual({})

        // Flush explicitly (don't rely on the scheduled async flush timing).
        yield* Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID)

        // After flush: the progress content is MATERIALIZED in the session_message row.
        const afterMsg = yield* readAssistantMessage(db, sessionID, assistantMessageID)
        const afterData = afterMsg!.data as {
          content?: Array<{
            type: string
            state?: { status: string; structured?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }
          }>
        }
        const afterTool = afterData.content?.find((c) => c.type === "tool")
        expect(afterTool?.state?.status).toBe("running")
        expect(afterTool?.state?.structured).toEqual({ progress: "50%" })
        expect(afterTool?.state?.content?.[0]?.text).toBe("running...")

        // Lag drains to 0 after flush.
        const lag = yield* Flush.lagGauge(db as unknown as DbShape, SchemaPgNamespace.namespace, sessionID)
        expect(lag).toBe(0)

        // Checkpoint at latest seq.
        const checkpoint = yield* readCheckpoint(db, sessionID)
        expect(checkpoint?.applied_seq).toBe(3)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// (c) Double-flush idempotent AND produces IDENTICAL session_message.data
// content (delta idempotency proof, Memo #15 UNVERIFIED 1).
describe("T3 two-tier commit — double-flush idempotent + identical content (Memo #15 UNVERIFIED 1)", () => {
  test("double-flush produces identical session_message.data content", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_double_flush_idem")
        const assistantMessageID = "msg_asst_double_flush"

        yield* setupSession(db, sessionID)
        yield* preCreateEventSequence(db, sessionID)

        const events = yield* EventV2.Service
        yield* publishToolProgressSetup(events, sessionID, assistantMessageID)
        yield* events.publish(SessionEvent.Tool.Progress, {
          sessionID,
          assistantMessageID: SessionMessage.ID.make(assistantMessageID),
          callID: "call_1",
          structured: { progress: "100%" },
          content: [{ type: "text", text: "done" }],
          timestamp: DateTime.makeUnsafe(CREATED_MS + 3),
        })

        // Non-vacuity: events committed
        const seqRow = yield* readSeq(db, sessionID)
        expect(seqRow?.seq).toBe(3)

        // First flush.
        yield* Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID)
        const msgAfterFirst = yield* readAssistantMessage(db, sessionID, assistantMessageID)
        const dataAfterFirst = JSON.stringify(msgAfterFirst!.data)

        // Checkpoint at seq 3.
        const checkpointAfterFirst = yield* readCheckpoint(db, sessionID)
        expect(checkpointAfterFirst?.applied_seq).toBe(3)

        // Second flush — should advance nothing (idempotent).
        yield* Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID)
        const checkpointAfterSecond = yield* readCheckpoint(db, sessionID)
        expect(checkpointAfterSecond?.applied_seq).toBe(3)

        // IDENTICAL session_message.data content (idempotency proof).
        const msgAfterSecond = yield* readAssistantMessage(db, sessionID, assistantMessageID)
        const dataAfterSecond = JSON.stringify(msgAfterSecond!.data)
        expect(dataAfterSecond).toBe(dataAfterFirst)

        // Non-vacuity: the content was actually materialized (not empty).
        const afterData = msgAfterSecond!.data as {
          content?: Array<{
            type: string
            state?: { status: string; structured?: Record<string, unknown> }
          }>
        }
        const afterTool = afterData.content?.find((c) => c.type === "tool")
        expect(afterTool?.state?.structured).toEqual({ progress: "100%" })
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// (d) Concurrent same-session flushes non-duplicating (FM-33 serialization).
describe("T3 two-tier commit — concurrent same-session flushes non-duplicating (FM-33)", () => {
  test("two concurrent flushes for same session → no duplicate projection", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_concurrent_flush")
        const assistantMessageID = "msg_asst_concurrent"

        yield* setupSession(db, sessionID)
        yield* preCreateEventSequence(db, sessionID)

        const events = yield* EventV2.Service
        yield* publishToolProgressSetup(events, sessionID, assistantMessageID)
        yield* events.publish(SessionEvent.Tool.Progress, {
          sessionID,
          assistantMessageID: SessionMessage.ID.make(assistantMessageID),
          callID: "call_1",
          structured: { progress: "50%" },
          content: [{ type: "text", text: "concurrent" }],
          timestamp: DateTime.makeUnsafe(CREATED_MS + 3),
        })

        // Non-vacuity: events committed
        const seqRow = yield* readSeq(db, sessionID)
        expect(seqRow?.seq).toBe(3)

        // Two concurrent flushes for the same session. The FOR UPDATE claim
        // serializes them — the second waits for the first to commit, then
        // sees the checkpoint already at the latest seq and projects nothing.
        yield* Effect.all(
          [
            Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID),
            Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID),
          ],
          { concurrency: "unbounded" },
        )

        // Checkpoint at seq 3 (not advanced past — no double-projection).
        const checkpoint = yield* readCheckpoint(db, sessionID)
        expect(checkpoint?.applied_seq).toBe(3)

        // The progress content appears exactly once (not duplicated).
        const msg = yield* readAssistantMessage(db, sessionID, assistantMessageID)
        const data = msg!.data as {
          content?: Array<{
            type: string
            state?: { status: string; structured?: Record<string, unknown> }
          }>
        }
        const tool = data.content?.find((c) => c.type === "tool")
        expect(tool?.state?.structured).toEqual({ progress: "50%" })

        // Non-vacuity: exactly one session_message row for this assistant.
        const messageCount = yield* countSessionMessages(db, sessionID)
        expect(messageCount).toBe(1)

        // Lag drains to 0.
        const lag = yield* Flush.lagGauge(db as unknown as DbShape, SchemaPgNamespace.namespace, sessionID)
        expect(lag).toBe(0)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// (e) Sync-tier-heavy session flushes WITHOUT projector death (FM-31 guard).
// PromptAdmitted is sync-tier; without the async-tier filter the flush would
// re-run its projector and die (SessionAlreadyProjected / LifecycleConflict).
// This test FAILS if the filter is missing.
describe("T3 two-tier commit — sync-tier-heavy session flushes without death (FM-31 guard)", () => {
  test("PromptAdmitted x2 session flushes without projector death", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_sync_heavy")

        // Pre-create the session row + event_sequence so the checkpoint FK
        // references a valid session and FOR UPDATE has a row. The Created
        // projector does onConflictDoNothing + dies if the row already
        // existed, so we scaffold the session row directly (test setup,
        // not a projection) and publish only PromptAdmitted events.
        yield* setupSession(db, sessionID)
        yield* preCreateEventSequence(db, sessionID)

        const events = yield* EventV2.Service
        // Publish two PromptAdmitted events (sync-tier). These project
        // session_input rows in the sync event-commit tx.
        yield* events.publish(SessionEvent.PromptAdmitted, {
          messageID: SessionMessage.ID.make("msg_prompt_sync_heavy_1"),
          sessionID,
          timestamp: DateTime.makeUnsafe(CREATED_MS),
          prompt: { text: "sync-heavy prompt 1" },
          delivery: "steer",
        })
        yield* events.publish(SessionEvent.PromptAdmitted, {
          messageID: SessionMessage.ID.make("msg_prompt_sync_heavy_2"),
          sessionID,
          timestamp: DateTime.makeUnsafe(CREATED_MS + 1),
          prompt: { text: "sync-heavy prompt 2" },
          delivery: "steer",
        })

        // Non-vacuity: events committed
        const seqRow = yield* readSeq(db, sessionID)
        expect(seqRow?.seq).toBe(1)

        // Flush — must NOT die. Without the FM-31 async-tier filter, this
        // would re-run the PromptAdmitted projector (sync-tier) and trip
        // SessionAlreadyProjected / LifecycleConflict.
        yield* Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, sessionID)

        // Checkpoint advanced over the sync-tier events (no re-projection).
        const checkpoint = yield* readCheckpoint(db, sessionID)
        expect(checkpoint?.applied_seq).toBe(1)

        // Lag drains to 0.
        const lag = yield* Flush.lagGauge(db as unknown as DbShape, SchemaPgNamespace.namespace, sessionID)
        expect(lag).toBe(0)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// (f) flush no-ops for non-session aggregates.
describe("T3 two-tier commit — SQLite no-op / non-session", () => {
  test("isPg is false when DATABASE_URL is unset", async () => {
    await modulesLoaded
    if (databaseUrl) {
      expect(isPg).toBe(true)
    } else {
      expect(isPg).toBe(false)
    }
  })

  test("flush no-ops for non-session aggregates", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const events = yield* EventV2.Service
        const result = yield* Flush.flush(db as unknown as DbShape, SchemaPgNamespace.namespace, events, "not_a_session")
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})
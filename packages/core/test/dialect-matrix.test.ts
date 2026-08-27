// Step 7 DIALECT test matrix: dual-dialect parity proof.
//
// Per the plan's Step 7 spec: "DIALECT=sqlite|pg CI matrix. Core suites
// green on both dialects." This file runs the SAME fixture under BOTH
// dialects and asserts equivalent observable outcomes.
//
// FM-18/28 discipline: non-vacuity row-count asserts BEFORE behavior;
// isPg sanity assert in the PG leg; env-before-dynamic-import for the PG leg.
//
// FM-28b fix (Memo #14 Cond 1): ZERO static runtime imports of any module
// that transitively imports database/database.ts. database.ts reads
// DATABASE_URL at module scope to set isPg; ES static imports are hoisted
// above any env assignment, so a static import would freeze isPg=false
// before the PG leg sets DATABASE_URL. Both legs use `import type` for
// types + `let X: typeof import("...")` declarations + assignment inside
// the modulesLoaded dynamic-import block AFTER setting process.env.
//
// Parity-matrix DOC (Athena Cond 7 lines):
// B1: checkpoint FK — present PG (0000_init.sql:206), absent SQLite
//     (event-path tests with ses_-shaped aggregates and no session row
//     don't fail the in-tx checkpoint write). Asymmetry accepted (Memo #15).
// B3: startsWith("ses_") guard — durable aggregates are sessions only.
//     Checkpoint writes/flush/lagGauge are guarded; any future non-session
//     durable aggregate must not expect checkpointing (Memo #15).
//     The guard must not be silently widened.
// Memo #16: Text.Delta/*.delta live-only rule — never durable, never
//     projected, never flushed. The async tier is Tool.Progress only.
//
// Surfaces tested (per plan Step 7):
// 1. Event commit (T2) — contiguous seqs under sequential publishes
// 2. Session round-trip — session + message rows persist
// 3. Flush tier (T3) — Tool.Progress projection materializes
// 4. Checkpoint FK asymmetry (B1) — PG has FK, SQLite doesn't
// 5. ses_ guard (B3) — non-session aggregates skip checkpoint
//
// ATHENA-VERIFIED column: checked 2026-08-20 (Memo #17 / memos PART 3).

import { describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"

// FM-28b: ONLY `import type` static imports — no runtime imports of core
// modules that transitively import database/database.ts. Types are erased
// at runtime, so they don't evaluate module scope.
import type * as DatabaseSchema from "@opencode-ai/core/database/schema.pg"
import type * as SchemaSqliteNamespace from "@opencode-ai/core/schema-sqlite-namespace"
import type { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import type { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { SessionProjector } from "@opencode-ai/core/session/projector"
import type { SessionV2 } from "@opencode-ai/core/session"
import type { SessionMessage } from "@opencode-ai/core/session/message"
import type { SessionEvent } from "@opencode-ai/core/session/event"
import type { Flush } from "@opencode-ai/core/database/flush"
import type { Project } from "@opencode-ai/core/project"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"
import type { Location } from "@opencode-ai/core/location"
import type { AbsolutePath } from "@opencode-ai/core/schema"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ProjectTable } from "@opencode-ai/core/project/sql"
import type { SessionTable, SessionMessageTable, SessionProjectionCheckpointTable } from "@opencode-ai/core/session/sql"
import type { EventTable } from "@opencode-ai/core/event/sql"
import type { SessionSchema as SessionV2Schema } from "@opencode-ai/core/session/schema"
import type { ProjectSchema } from "@opencode-ai/core/project/schema"

// ─── PG leg (gated on TEST_DATABASE_URL) ────────────────────────────

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseUrl = testDatabaseUrl

let isPg = false
// SQLite-leg module bindings (assigned in modulesLoaded for BOTH legs so
// the SQLite tests can use the dynamically-imported modules without any
// static runtime import that would pre-evaluate database.ts).
let SqlDatabase: typeof Database
let SqlDatabaseSchema: typeof DatabaseSchema
let SqlSchemaSqliteNamespace: typeof SchemaSqliteNamespace
let SqlEventV2: typeof EventV2
let SqlSessionEvent: typeof SessionEvent
let SqlFlush: typeof Flush
let SqlSessionProjector: typeof SessionProjector
let SqlAppNodeBuilder: typeof AppNodeBuilder
let SqlLayerNode: typeof LayerNode
let SqlLocation: typeof Location
let SqlProject: typeof Project
let SqlWorkspaceV2: typeof WorkspaceV2
let SqlSessionMessage: typeof SessionMessage
let SqlModelV2: typeof ModelV2
let SqlProviderV2: typeof ProviderV2
let SqlAbsolutePath: typeof AbsolutePath
let SqlSessionV2: typeof SessionV2
let SqlProjectTable: typeof ProjectTable
let SqlSessionTable: typeof SessionTable
let SqlSessionMessageTable: typeof SessionMessageTable
let SqlSessionProjectionCheckpointTable: typeof SessionProjectionCheckpointTable
let SqlEventTable: typeof EventTable
// PG-leg module bindings
let PgDatabase: typeof Database
let PgDatabaseSchema: typeof DatabaseSchema
let PgDatabaseMigrationPg: typeof import("@opencode-ai/core/database/migration.pg")
let PgSchemaPgNamespace: typeof import("@opencode-ai/core/schema-pg-namespace")
let PgEventV2: typeof EventV2
let PgSessionEvent: typeof SessionEvent
let PgFlush: typeof Flush
let PgSessionProjector: typeof SessionProjector
let PgAppNodeBuilder: typeof AppNodeBuilder
let PgLayerNode: typeof LayerNode
let PgLocation: typeof Location
let PgProject: typeof Project
let PgWorkspaceV2: typeof WorkspaceV2
let PgProjectSchema: typeof import("@opencode-ai/core/project/schema")
let PgSessionSchema: typeof import("@opencode-ai/core/session/schema")
let PgSessionMessage: typeof SessionMessage
let PgModelV2: typeof ModelV2
let PgProviderV2: typeof ProviderV2
let PgAbsolutePath: typeof AbsolutePath
let PgSessionStore: typeof import("@opencode-ai/core/session/store")
let PgEventSequenceTable: typeof import("@opencode-ai/core/event/sql.pg").EventSequenceTable
let PgEventTable: typeof import("@opencode-ai/core/event/sql.pg").EventTable
let PgSessionTable: typeof import("@opencode-ai/core/session/sql.pg").SessionTable
let PgSessionMessageTable: typeof import("@opencode-ai/core/session/sql.pg").SessionMessageTable
let PgSessionProjectionCheckpointTable: typeof import("@opencode-ai/core/session/sql.pg").SessionProjectionCheckpointTable
let PgProjectTable: typeof import("@opencode-ai/core/project/sql.pg").ProjectTable

// FM-28b: set DATABASE_URL BEFORE the dynamic import of core modules.
// For the PG leg, TEST_DATABASE_URL is set → isPg activates. For the
// SQLite leg, DATABASE_URL stays unset → isPg stays false (correct).
// Both legs dynamically import AFTER the env decision so database.ts
// evaluates with the right env. The SQLite leg's modules are loaded in
// the same block (DATABASE_URL unset) so the SQLite tests can use them
// without any static runtime import.
const modulesLoaded = (async () => {
  if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl
  const database = await import("@opencode-ai/core/database/database")
  const dbSchema = await import("@opencode-ai/core/database/schema.pg")
  const migrationPg = await import("@opencode-ai/core/database/migration.pg")
  const schemaPgNs = await import("@opencode-ai/core/schema-pg-namespace")
  const schemaSqliteNs = await import("@opencode-ai/core/schema-sqlite-namespace")
  const eventV2 = await import("@opencode-ai/core/event")
  const sessionEvent = await import("@opencode-ai/core/session/event")
  const flush = await import("@opencode-ai/core/database/flush")
  const sessionProjector = await import("@opencode-ai/core/session/projector")
  const appNodeBuilder = await import("@opencode-ai/core/effect/app-node-builder")
  const layerNode = await import("@opencode-ai/core/effect/layer-node")
  const location = await import("@opencode-ai/core/location")
  const project = await import("@opencode-ai/core/project")
  const workspaceV2 = await import("@opencode-ai/core/workspace")
  const projectSchema = await import("@opencode-ai/core/project/schema")
  const sessionSchema = await import("@opencode-ai/core/session/schema")
  const sessionMessage = await import("@opencode-ai/core/session/message")
  const modelV2 = await import("@opencode-ai/core/model")
  const providerV2 = await import("@opencode-ai/core/provider")
  const schema = await import("@opencode-ai/core/schema")
  const sessionStore = await import("@opencode-ai/core/session/store")
  const sessionV2 = await import("@opencode-ai/core/session")
  const eventSql = await import("@opencode-ai/core/event/sql")
  const sessionSql = await import("@opencode-ai/core/session/sql")
  const projectSql = await import("@opencode-ai/core/project/sql")
  const eventSqlPg = await import("@opencode-ai/core/event/sql.pg")
  const sessionSqlPg = await import("@opencode-ai/core/session/sql.pg")
  const projectSqlPg = await import("@opencode-ai/core/project/sql.pg")
  // SQLite-leg bindings (always assigned — used by the SQLite tests).
  SqlDatabase = database
  SqlDatabaseSchema = dbSchema
  SqlSchemaSqliteNamespace = schemaSqliteNs
  SqlEventV2 = eventV2
  SqlSessionEvent = sessionEvent
  SqlFlush = flush
  SqlSessionProjector = sessionProjector
  SqlAppNodeBuilder = appNodeBuilder
  SqlLayerNode = layerNode
  SqlLocation = location
  SqlProject = project
  SqlWorkspaceV2 = workspaceV2
  SqlSessionMessage = sessionMessage
  SqlModelV2 = modelV2
  SqlProviderV2 = providerV2
  SqlAbsolutePath = schema.AbsolutePath
  SqlSessionV2 = sessionV2
  SqlProjectTable = projectSql.ProjectTable
  SqlSessionTable = sessionSql.SessionTable
  SqlSessionMessageTable = sessionSql.SessionMessageTable
  SqlSessionProjectionCheckpointTable = sessionSql.SessionProjectionCheckpointTable
  SqlEventTable = eventSql.EventTable
  // PG-leg bindings (assigned regardless; only used when testDatabaseUrl set).
  PgDatabase = database
  PgDatabaseSchema = dbSchema
  PgDatabaseMigrationPg = migrationPg
  PgSchemaPgNamespace = schemaPgNs
  PgEventV2 = eventV2
  PgSessionEvent = sessionEvent
  PgFlush = flush
  PgSessionProjector = sessionProjector
  PgAppNodeBuilder = appNodeBuilder
  PgLayerNode = layerNode
  PgLocation = location
  PgProject = project
  PgWorkspaceV2 = workspaceV2
  PgProjectSchema = projectSchema
  PgSessionSchema = sessionSchema
  PgSessionMessage = sessionMessage
  PgModelV2 = modelV2
  PgProviderV2 = providerV2
  PgAbsolutePath = schema.AbsolutePath
  PgSessionStore = sessionStore
  PgEventSequenceTable = eventSqlPg.EventSequenceTable
  PgEventTable = eventSqlPg.EventTable
  PgSessionTable = sessionSqlPg.SessionTable
  PgSessionMessageTable = sessionSqlPg.SessionMessageTable
  PgSessionProjectionCheckpointTable = sessionSqlPg.SessionProjectionCheckpointTable
  PgProjectTable = projectSqlPg.ProjectTable
  isPg = database.isPg
})()

const TEST_TIMEOUT = 30_000

const makeDb = EffectDrizzlePg.makeWithDefaults()
type PgDb = Awaited<Effect.Success<typeof makeDb>>
type DbShape = Database.Interface["db"]

const pgRun = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(pgLayer({ url: databaseUrl! }))) as Effect.Effect<A, E, never>,
  )

const pgBoot = Effect.gen(function* () {
  const client = yield* Client.SqlClient
  yield* client.unsafe("DROP SCHEMA public CASCADE").withoutTransform
  yield* client.unsafe("CREATE SCHEMA public").withoutTransform
  yield* PgDatabaseMigrationPg.apply(client)
  const db = yield* makeDb
  return { db, schema: PgSchemaPgNamespace.namespace }
})

const pgSetupProject = (db: PgDb) =>
  db
    .insert(PgProjectTable)
    .values({
      id: PgProjectSchema.ID.make("prj_matrix"),
      worktree: PgAbsolutePath.make("/tmp"),
      sandboxes: [],
    })
    .run()
    .pipe(Effect.orDie)

const pgSetupSession = (db: PgDb) =>
  db
    .insert(PgSessionTable)
    .values({
      id: PgSessionSchema.ID.make("ses_matrix_test"),
      project_id: PgProjectSchema.ID.make("prj_matrix"),
      slug: "ses_matrix_test",
      directory: "/tmp",
      title: "test",
      version: "0",
      time_created: CREATED_MS,
      time_updated: CREATED_MS,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

// Compose boot + setup + body in ONE Effect.gen so the db connection from
// boot stays alive for the whole test (pgRun closes the scope on resolve;
// separate pgRun calls would dead-reference the db). The body receives the
// boot db (for direct queries) and must provide pgEventLayer() itself when
// it needs EventV2.Service (the event layer has its own pgLayer connection).
const pgTest = <A, E, R>(
  body: (db: PgDb, schema: typeof PgSchemaPgNamespace.namespace) => Effect.Effect<A, E, R>,
) =>
  pgRun(
    Effect.gen(function* () {
      const { db, schema } = yield* pgBoot
      yield* pgSetupProject(db)
      yield* pgSetupSession(db)
      return yield* body(db, schema)
    }) as Effect.Effect<A, E, Client.SqlClient>,
  )

const pgLocationLayer = () =>
  Layer.succeed(
    PgLocation.Service,
    PgLocation.Service.of({
      directory: PgAbsolutePath.make("/tmp/matrix-pg"),
      workspaceID: PgWorkspaceV2.ID.make("wrk_matrix"),
      project: { id: PgProject.ID.global, directory: PgAbsolutePath.make("/tmp/matrix-pg") },
    }),
  )

const pgEventLayer = () =>
  Layer.merge(
    PgAppNodeBuilder.build(
      PgLayerNode.group([PgDatabase.node, PgEventV2.node, PgSessionProjector.node, PgSessionStore.node]),
      [[PgLocation.node, pgLocationLayer()]],
    ),
    Layer.succeed(PgDatabaseSchema.Schema, PgSchemaPgNamespace.namespace),
  )

const CREATED_MS = 1737360000000

// IDs are branded strings; the brand is nominal but a plain string is
// assignable at the boundary via the schema's make. We compute them once
// modulesLoaded has bound the Sql* modules. The literal value is stable
// across both legs (same aggregate ID for parity).
const sessionID = "ses_matrix_test" as SessionV2Schema.ID
const projectID = "prj_matrix" as ProjectSchema.ID
const model = { id: "model" as ModelV2.ID, providerID: "provider" as ProviderV2.ID }

// SQLite-leg layer + helpers — built lazily inside each test after
// modulesLoaded resolves, so the dynamically-imported modules are bound.
const sqliteLocationLayer = () =>
  Layer.succeed(
    SqlLocation.Service,
    SqlLocation.Service.of({
      directory: SqlAbsolutePath.make("/tmp/matrix"),
      workspaceID: SqlWorkspaceV2.ID.make("wrk_matrix"),
      project: { id: SqlProject.ID.global, directory: SqlAbsolutePath.make("/tmp/matrix") },
    }),
  )

const sqliteLayer = () =>
  Layer.merge(
    SqlAppNodeBuilder.build(
      SqlLayerNode.group([SqlDatabase.node, SqlEventV2.node, SqlSessionProjector.node]),
      [[SqlLocation.node, sqliteLocationLayer()]],
    ),
    Layer.succeed(SqlDatabaseSchema.Schema, SqlSchemaSqliteNamespace.namespace),
  )

const sqliteRun = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqliteLayer())) as Effect.Effect<A, E, never>)

const userMessageRow = (text: string, createdMs: number) => {
  const encoded = Schema.encodeSync(SqlSessionMessage.Message)(
    SqlSessionMessage.User.make({
      id: SqlSessionMessage.ID.make("msg_matrix"),
      type: "user",
      text,
      time: { created: DateTime.makeUnsafe(createdMs) },
    }),
  )
  const { id: _id, type, ...data } = encoded
  return { type, data }
}

// ─── Surface 1: Event commit (T2 contiguous seqs) ────────────────────

describe("DIALECT matrix — Surface 1: event commit (T2 contiguous seqs)", () => {
  test("SQLite: two sequential publishes produce contiguous seqs", async () => {
    if (testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(false)
    await sqliteRun(
      Effect.gen(function* () {
        const events = yield* SqlEventV2.Service
        const db = (yield* SqlDatabase.Service).db
        const schema = SqlSchemaSqliteNamespace.namespace

        yield* db
          .insert(SqlProjectTable)
          .values({ id: projectID, worktree: SqlAbsolutePath.make("/tmp"), sandboxes: [] })
          .onConflictDoNothing()
          .run()
        yield* db
          .insert(SqlSessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "test",
            directory: "/tmp",
            title: "test",
            version: "0",
            time_created: 0,
            time_updated: 0,
          })
          .onConflictDoNothing()
          .run()

        const event1 = yield* events.publish(SqlSessionEvent.Text.Started, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_1"),
          textID: "txt_1",
          timestamp: DateTime.makeUnsafe(0),
        })
        const event2 = yield* events.publish(SqlSessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_1"),
          textID: "txt_1",
          text: "hello",
          timestamp: DateTime.makeUnsafe(1),
        })

        const eventRows = yield* db
          .select({ seq: SqlEventTable.seq })
          .from(SqlEventTable)
          .where(eq(schema.EventTable.aggregate_id, sessionID))
          .orderBy(schema.EventTable.seq)
          .all()

        expect(eventRows.length).toBeGreaterThan(0)
        expect(event1.durable?.seq).toBe(0)
        expect(event2.durable?.seq).toBe(1)
        expect(eventRows.map((r) => r.seq)).toEqual([0, 1])
      }),
    )
  }, TEST_TIMEOUT)

  test("PG: two sequential publishes produce contiguous seqs", async () => {
    if (!testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)

    const result = await pgTest((db, schema) =>
      Effect.gen(function* () {
        const events = yield* PgEventV2.Service
        const event1 = yield* events.publish(PgSessionEvent.Text.Started, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_1"),
          textID: "txt_1",
          timestamp: DateTime.makeUnsafe(0),
        })
        const event2 = yield* events.publish(PgSessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_1"),
          textID: "txt_1",
          text: "hello",
          timestamp: DateTime.makeUnsafe(1),
        })
        const eventRows = yield* db
          .select({ seq: PgEventTable.seq })
          .from(PgEventTable)
          .where(eq(PgEventTable.aggregate_id, sessionID))
          .orderBy(PgEventTable.seq)
          .all()
        return { seq1: event1.durable?.seq, seq2: event2.durable?.seq, seqs: eventRows.map((r) => r.seq) }
      }).pipe(Effect.provide(pgEventLayer())),
    )
    expect(result.seqs.length).toBeGreaterThan(0)
    expect(result.seq1).toBe(0)
    expect(result.seq2).toBe(1)
    // PG returns bigint-typed columns as strings; coerce numerically.
    expect(result.seqs.map(Number)).toEqual([0, 1])
  }, TEST_TIMEOUT)
})

// ─── Surface 2: Session round-trip ──────────────────────────────────

describe("DIALECT matrix — Surface 2: session round-trip", () => {
  test("SQLite: session + message rows persist and read back", async () => {
    if (testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(false)
    await sqliteRun(
      Effect.gen(function* () {
        const db = (yield* SqlDatabase.Service).db
        const schema = SqlSchemaSqliteNamespace.namespace

        yield* db
          .insert(SqlProjectTable)
          .values({ id: projectID, worktree: SqlAbsolutePath.make("/tmp"), sandboxes: [] })
          .onConflictDoNothing()
          .run()
        yield* db
          .insert(SqlSessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "test",
            directory: "/tmp",
            title: "test",
            version: "0",
            time_created: 0,
            time_updated: 0,
          })
          .onConflictDoNothing()
          .run()

        const row = userMessageRow("hello world", 1000)
        yield* db
          .insert(SqlSessionMessageTable)
          .values({
            id: SqlSessionMessage.ID.make("msg_rt"),
            session_id: sessionID,
            type: row.type,
            seq: 1,
            time_created: 1000,
            data: row.data,
          })
          .run()

        const sessionRow = yield* db
          .select({ id: SqlSessionTable.id })
          .from(SqlSessionTable)
          .where(eq(SqlSessionTable.id, sessionID))
          .get()
        const msgRow = yield* db
          .select({ type: SqlSessionMessageTable.type })
          .from(SqlSessionMessageTable)
          .where(eq(SqlSessionMessageTable.session_id, sessionID))
          .get()

        expect(sessionRow).toBeDefined()
        expect(msgRow).toBeDefined()
        expect(msgRow?.type).toBe("user")
      }),
    )
  }, TEST_TIMEOUT)

  test("PG: session + message rows persist and read back", async () => {
    if (!testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)

    const row = userMessageRow("hello world", 1000)
    await pgTest((db, schema) =>
      Effect.gen(function* () {
        yield* db
          .insert(PgSessionMessageTable)
          .values({
            id: PgSessionMessage.ID.make("msg_rt"),
            session_id: PgSessionSchema.ID.make("ses_matrix_test"),
            type: row.type as "user",
            seq: 1,
            time_created: 1000,
            data: row.data,
          })
          .run()

        const sessionRow = yield* db
          .select({ id: PgSessionTable.id })
          .from(PgSessionTable)
          .where(eq(PgSessionTable.id, PgSessionSchema.ID.make("ses_matrix_test")))
          .get()
        const msgRow = yield* db
          .select({ type: PgSessionMessageTable.type })
          .from(PgSessionMessageTable)
          .where(eq(PgSessionMessageTable.session_id, PgSessionSchema.ID.make("ses_matrix_test")))
          .get()

        expect(sessionRow).toBeDefined()
        expect(msgRow).toBeDefined()
        expect(msgRow?.type).toBe("user")
      }),
    )
  }, TEST_TIMEOUT)
})

// ─── Surface 3: Flush tier (T3 Tool.Progress) ────────────────────────

describe("DIALECT matrix — Surface 3: flush tier (Tool.Progress projection)", () => {
  test("SQLite: checkpoint advances after sync-tier commit (single-tier collapse)", async () => {
    if (testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(false)
    await sqliteRun(
      Effect.gen(function* () {
        const events = yield* SqlEventV2.Service
        const db = (yield* SqlDatabase.Service).db
        const schema = SqlSchemaSqliteNamespace.namespace

        yield* db
          .insert(SqlProjectTable)
          .values({ id: projectID, worktree: SqlAbsolutePath.make("/tmp"), sandboxes: [] })
          .onConflictDoNothing()
          .run()
        yield* db
          .insert(SqlSessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "test",
            directory: "/tmp",
            title: "test",
            version: "0",
            time_created: 0,
            time_updated: 0,
          })
          .onConflictDoNothing()
          .run()

        yield* events.publish(SqlSessionEvent.Step.Started, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_flush"),
          agent: "build",
          model,
          timestamp: DateTime.makeUnsafe(0),
        })
        yield* events.publish(SqlSessionEvent.Tool.Input.Started, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          name: "test",
          timestamp: DateTime.makeUnsafe(0),
        })
        yield* events.publish(SqlSessionEvent.Tool.Called, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          tool: "bash",
          input: { command: "echo hi" },
          provider: { executed: false },
          timestamp: DateTime.makeUnsafe(0),
        })
        yield* events.publish(SqlSessionEvent.Tool.Progress, {
          sessionID,
          assistantMessageID: SqlSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          structured: { progress: "50%" },
          content: [{ type: "text", text: "running..." }],
          timestamp: DateTime.makeUnsafe(0),
        })

        const eventRows = yield* db
          .select({ id: schema.EventTable.id })
          .from(schema.EventTable)
          .where(eq(schema.EventTable.aggregate_id, sessionID))
          .all()

        const checkpoint = yield* SqlFlush.readCheckpoint(db, schema, sessionID)
        expect(eventRows.length).toBeGreaterThan(0)
        expect(checkpoint).toBe(3)
      }),
    )
  }, TEST_TIMEOUT)

  test("PG: checkpoint advances after flush (async-tier projection)", async () => {
    if (!testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)

    const result = await pgTest((db, schema) =>
      Effect.gen(function* () {
        const events = yield* PgEventV2.Service
        yield* events.publish(PgSessionEvent.Step.Started, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_flush"),
          agent: "build",
          model,
          timestamp: DateTime.makeUnsafe(CREATED_MS),
        })
        yield* events.publish(PgSessionEvent.Tool.Input.Started, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          name: "test",
          timestamp: DateTime.makeUnsafe(CREATED_MS),
        })
        yield* events.publish(PgSessionEvent.Tool.Called, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          tool: "bash",
          input: { command: "echo hi" },
          provider: { executed: false },
          timestamp: DateTime.makeUnsafe(CREATED_MS),
        })
        yield* events.publish(PgSessionEvent.Tool.Progress, {
          sessionID,
          assistantMessageID: PgSessionMessage.ID.make("msg_flush"),
          callID: "call_1",
          structured: { progress: "50%" },
          content: [{ type: "text", text: "running..." }],
          timestamp: DateTime.makeUnsafe(CREATED_MS),
        })

        yield* PgFlush.flush(db as unknown as DbShape, schema, events, sessionID)

        const eventRows = yield* (db as unknown as DbShape)
          .select({ id: PgEventTable.id })
          .from(PgEventTable)
          .where(eq(PgEventTable.aggregate_id, sessionID))
          .all()
        const checkpoint = yield* PgFlush.readCheckpoint(db as unknown as DbShape, schema, sessionID)
        return { eventCount: eventRows.length, checkpoint }
      }).pipe(Effect.provide(pgEventLayer())),
    )
    expect(result.eventCount).toBeGreaterThan(0)
    // PG returns bigint-typed applied_seq as a string; coerce numerically.
    // 4 events (seqs 0-3) → checkpoint at seq 3 (last committed event).
    expect(Number(result.checkpoint)).toBe(3)
  }, TEST_TIMEOUT)
})

// ─── Surface 4: Checkpoint FK asymmetry (B1) ─────────────────────────

describe("DIALECT matrix — Surface 4: checkpoint FK asymmetry (B1, Memo #15)", () => {
  test("SQLite: checkpoint table has NO FK to session (B1 asymmetry)", async () => {
    if (testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(false)
    await sqliteRun(
      Effect.gen(function* () {
        const db = (yield* SqlDatabase.Service).db
        const schema = SqlSchemaSqliteNamespace.namespace

        yield* db
          .insert(SqlSessionProjectionCheckpointTable)
          .values({ session_id: SqlSessionV2.ID.make("ses_nonexistent_fk_test"), applied_seq: 0, time_updated: 0 })
          .onConflictDoNothing()
          .run()

        const row = yield* db
          .select({ session_id: SqlSessionProjectionCheckpointTable.session_id })
          .from(SqlSessionProjectionCheckpointTable)
          .where(sql`${SqlSessionProjectionCheckpointTable.session_id} = ${"ses_nonexistent_fk_test"}`)
          .get()

        expect(row).toBeDefined()
      }),
    )
  }, TEST_TIMEOUT)

  test("PG: checkpoint table HAS FK to session (B1 asymmetry)", async () => {
    if (!testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)

    // Probe the FK by inserting a checkpoint row referencing a non-existent
    // session. Under PG the FK constraint must reject the insert. Run the
    // insert through Effect.exit so the defect is observable without
    // crashing the test runner. Boot+probe in ONE pgRun so the db
    // connection stays alive.
    const { exit, persisted } = await pgRun(
      Effect.gen(function* () {
        const { db } = yield* pgBoot
        const exit = yield* db
          .insert(PgSessionProjectionCheckpointTable)
          .values({ session_id: PgSessionSchema.ID.make("ses_nonexistent_fk_test"), applied_seq: 0, time_updated: 0 })
          .run()
          .pipe(Effect.exit)
        const persisted = yield* db
          .select({ session_id: PgSessionProjectionCheckpointTable.session_id })
          .from(PgSessionProjectionCheckpointTable)
          .where(eq(PgSessionProjectionCheckpointTable.session_id, PgSessionSchema.ID.make("ses_nonexistent_fk_test")))
          .get()
          .pipe(Effect.orElseSucceed(() => undefined))
        return { exit, persisted }
      }),
    )
    // The insert MUST fail (FK violation). A success means the FK is missing
    // or the insert escaped the constraint — either is a real defect.
    expect(exit._tag).toBe("Failure")
    // Verify no checkpoint row was actually persisted (the tx rolled back).
    expect(persisted).toBeUndefined()
  }, TEST_TIMEOUT)
})

// ─── Surface 5: ses_ guard (B3) ─────────────────────────────────────

describe("DIALECT matrix — Surface 5: ses_ guard invariant (B3, Memo #15)", () => {
  test("SQLite: non-session aggregate (no ses_ prefix) skips checkpoint", async () => {
    if (testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(false)
    await sqliteRun(
      Effect.gen(function* () {
        const db = (yield* SqlDatabase.Service).db
        const schema = SqlSchemaSqliteNamespace.namespace

        // The ses_ guard in flush.ts:197 ensures Flush.flush is a no-op for
        // non-session aggregate IDs. The guard in event.ts:396/432 ensures
        // the in-tx checkpoint write is skipped. Test by calling flush with
        // a non-ses_ ID and verifying no checkpoint row appears.
        const nonSessionAggregate = "evt_non_session_aggregate"

        const events = yield* SqlEventV2.Service
        yield* SqlFlush.flush(db, schema, events, nonSessionAggregate)

        const row = yield* db
          .select({ session_id: SqlSessionProjectionCheckpointTable.session_id })
          .from(SqlSessionProjectionCheckpointTable)
          .where(sql`${SqlSessionProjectionCheckpointTable.session_id} = ${nonSessionAggregate}`)
          .get()

        expect(row).toBeUndefined()
      }),
    )
  }, TEST_TIMEOUT)

  test("PG: non-session aggregate (no ses_ prefix) skips checkpoint", async () => {
    if (!testDatabaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)

    const nonSessionAggregate = "evt_non_session_aggregate"

    const result = await pgTest((db, schema) =>
      Effect.gen(function* () {
        const events = yield* PgEventV2.Service
        yield* PgFlush.flush(db as unknown as DbShape, schema, events, nonSessionAggregate)
        const rows = yield* db
          .select({ session_id: PgSessionProjectionCheckpointTable.session_id })
          .from(PgSessionProjectionCheckpointTable)
          .where(eq(PgSessionProjectionCheckpointTable.session_id, nonSessionAggregate as SessionV2Schema.ID))
          .get()
        return { found: !!rows }
      }).pipe(Effect.provide(pgEventLayer())),
    )
    expect(result.found).toBe(false)
  }, TEST_TIMEOUT)
})
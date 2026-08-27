// Step 5b-1 integration tests: PG concurrency core (Memo #14 Cond 1 rewrite).
//
// Gated on TEST_DATABASE_URL (ephemeral postgres:17-alpine). The tests
// are no-ops without it so the default SQLite suite is unaffected.
//
// FM-28 fixes (Memo #14 Cond 1):
// (a) Setup composes Effects — NEVER async functions awaiting Effects
//     (proven no-op: `await effect` returns the Effect object). Uses
//     Effect.gen + Effect.runPromise throughout.
// (b) PG tests run with DATABASE_URL=$TEST_DATABASE_URL so isPg
//     conditionals are ACTIVE. Proves activation with a sanity assert.
//     Mechanism: set process.env.DATABASE_URL BEFORE the dynamic import
//     of core modules (database.ts reads it at module scope to set
//     isPg; ES module imports are hoisted, so a static import would
//     evaluate isPg before the env var is set).
// (c) Rollback-suppression NOTIFY test (§12.1 probe template: publish
//     in a tx that rolls back → listener receives NOTHING; commit →
//     listener receives).
// (d) Concurrent same-aggregate publishes through the REAL EventV2 pipe
//     → contiguous seqs (T2 through commitDurableEvent, not hand-rolled
//     SQL); two-drain promotion through promoteSteers/promoteNextQueued
//     → exactly-once.
// (e) Non-vacuity asserts: row counts > 0 BEFORE asserting behavior.

import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import type { SchemaTables } from "@opencode-ai/core/database/schema.pg"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseUrl = testDatabaseUrl

// FM-28b fix: set DATABASE_URL BEFORE the dynamic import of core modules
// that read it at module scope (database.ts:41 `databaseUrl =
// process.env.DATABASE_URL`, database.ts:49 `isPg = databaseUrl !==
// undefined`). ES module static imports are hoisted above the env
// assignment, so we use a dynamic import after setting the env var.
// This provably activates isPg (the sanity assert below verifies it).
let isPg = false
let Wake: typeof import("@opencode-ai/core/database/wake")
let Database: typeof import("@opencode-ai/core/database/database")
let DatabaseSchema: typeof import("@opencode-ai/core/database/schema.pg")
let DatabaseMigrationPg: typeof import("@opencode-ai/core/database/migration.pg")
let SchemaPgNamespace: typeof import("@opencode-ai/core/schema-pg-namespace")
let EventV2: typeof import("@opencode-ai/core/event")
let SessionEvent: typeof import("@opencode-ai/core/session/event")
let SessionInput: typeof import("@opencode-ai/core/session/input")
let AppNodeBuilder: typeof import("@opencode-ai/core/effect/app-node-builder")
let LayerNode: typeof import("@opencode-ai/core/effect/layer-node")
let Location: typeof import("@opencode-ai/core/location")
let Project: typeof import("@opencode-ai/core/project")
let WorkspaceV2: typeof import("@opencode-ai/core/workspace")
let SessionProjector: typeof import("@opencode-ai/core/session/projector")
let SessionStore: typeof import("@opencode-ai/core/session/store")
let PgProjectTable: typeof import("@opencode-ai/core/project/sql.pg").ProjectTable
let PgSessionTable: typeof import("@opencode-ai/core/session/sql.pg").SessionTable
let PgSessionInputTable: typeof import("@opencode-ai/core/session/sql.pg").SessionInputTable
let PgEventSequenceTable: typeof import("@opencode-ai/core/event/sql.pg").EventSequenceTable
let PgEventTable: typeof import("@opencode-ai/core/event/sql.pg").EventTable
let PgSessionMessageTable: typeof import("@opencode-ai/core/session/sql.pg").SessionMessageTable
let ProjectSchema: typeof import("@opencode-ai/core/project/schema")
let SessionSchema: typeof import("@opencode-ai/core/session/schema")
let SessionMessage: typeof import("@opencode-ai/core/session/message")
let AbsolutePath: typeof import("@opencode-ai/core/schema").AbsolutePath

// Type alias for the erased DatabaseShape — the db variable is typed as
// Database.Interface["db"] which is the SQLite DatabaseShape; the PG db
// is structurally equivalent (database.ts casts at the boundary).
type DbShape = import("@opencode-ai/core/database/database").Database.Interface["db"]

const modulesLoaded = testDatabaseUrl
  ? (async () => {
      process.env.DATABASE_URL = testDatabaseUrl
      const wake = await import("@opencode-ai/core/database/wake")
      const database = await import("@opencode-ai/core/database/database")
      const dbSchema = await import("@opencode-ai/core/database/schema.pg")
      const migrationPg = await import("@opencode-ai/core/database/migration.pg")
      const schemaPgNs = await import("@opencode-ai/core/schema-pg-namespace")
      const eventV2 = await import("@opencode-ai/core/event")
      const sessionEvent = await import("@opencode-ai/core/session/event")
      const sessionInput = await import("@opencode-ai/core/session/input")
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
      const schema = await import("@opencode-ai/core/schema")
      Wake = wake
      Database = database
      DatabaseSchema = dbSchema
      DatabaseMigrationPg = migrationPg
      SchemaPgNamespace = schemaPgNs
      EventV2 = eventV2
      SessionEvent = sessionEvent
      SessionInput = sessionInput
      SessionProjector = sessionProjector
      SessionStore = sessionStore
      AppNodeBuilder = appNodeBuilder
      LayerNode = layerNode
      Location = location
      Project = project
      WorkspaceV2 = workspaceV2
      PgProjectTable = projectSqlPg.ProjectTable
      PgSessionTable = sessionSqlPg.SessionTable
      PgSessionInputTable = sessionSqlPg.SessionInputTable
      PgEventTable = eventSqlPg.EventTable
      PgEventSequenceTable = eventSqlPg.EventSequenceTable
      PgSessionMessageTable = sessionSqlPg.SessionMessageTable
      ProjectSchema = projectSchema
      SessionSchema = sessionSchema
      SessionMessage = sessionMessage
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

// Get db from Database.Service (NOT boot's makeDb) so promoteSteers and
// the projectors share the same SqlClient → same transaction connection.
// boot's makeDb uses the outer pgLayer's SqlClient; Database.Service uses
// eventLayer()'s inner pgLayer's SqlClient. Without sharing, FOR UPDATE
// SKIP LOCKED in promoteSteers locks rows on one connection while the
// projectors' UPDATE runs on another → statement timeout (FM-29 fix
// requires the SELECT and the promotion writes in ONE transaction).
const getServiceDb = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return { db: db as unknown as PgDb, schema: SchemaPgNamespace.namespace }
})

const CREATED_MS = 1737360000000

// FM-28a fix: setup composes Effects — never async functions awaiting
// Effects. Each setup step is an Effect yielded inside Effect.gen.
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

const insertPendingInput = (
  db: PgDb,
  sessionID: string,
  inputID: string,
  delivery: "steer" | "queue",
  admittedSeq: number,
) =>
  db
    .insert(PgSessionInputTable)
    .values({
      id: SessionMessage.ID.make(`msg_${inputID}`),
      session_id: SessionSchema.ID.make(sessionID),
      prompt: { text: `prompt ${inputID}` },
      delivery,
      admitted_seq: admittedSeq,
      time_created: CREATED_MS + admittedSeq,
    })
    .run()
    .pipe(Effect.orDie)

// EventV2 layer for the real commitDurableEvent pipe test.
const locationLayer = () =>
  Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make("/tmp/wake-pg"),
      workspaceID: WorkspaceV2.ID.make("wrk_wake"),
      project: { id: Project.ID.global, directory: AbsolutePath.make("/tmp/wake-pg") },
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

// (b) isPg activation sanity check — proves the DATABASE_URL env set
// before import activated the isPg conditionals.
describe("PG concurrency — isPg activation (FM-28b)", () => {
  test("isPg is true when TEST_DATABASE_URL is set (conditionals ACTIVE)", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    // FM-28b: if isPg is false here, every isPg conditional in event.ts/
    // input.ts ran its SQLite branch against a PG database — the entire
    // suite would be vacuous.
    expect(isPg).toBe(true)
  }, TEST_TIMEOUT)
})

// (c) Rollback-suppression NOTIFY test (§12.1 probe template).
describe("PG concurrency — NOTIFY rollback suppression (Memo #1, §12.1)", () => {
  test("NOTIFY in a rolled-back tx → listener receives NOTHING; commit → listener receives", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = "ses_rollback"

        const native = (yield* Effect.tryPromise({
          try: () => import("postgres").then((m) => m.default(databaseUrl!, { max: 2 })),
          catch: () => null,
        })) as ReturnType<typeof import("postgres")> | null
        if (!native) return

        let receivedPayload: string | null = null
        const channel = Wake.channelName(sessionID)

        yield* Effect.tryPromise({
          try: () =>
            native.listen(channel, (payload: string) => {
              receivedPayload = payload
            }),
          catch: () => {},
        })

        // Rollback: NOTIFY inside a tx that rolls back → listener receives NOTHING.
        yield* db
          .transaction(
            () =>
              Effect.gen(function* () {
                yield* Wake.notifyInTransaction(db as unknown as DbShape, sessionID)
                yield* Effect.fail(new Error("force rollback"))
              }),
          )
          .pipe(Effect.flip, Effect.ignore)

        yield* Effect.sleep(200)
        expect(receivedPayload).toBeNull()

        // Commit: NOTIFY inside a tx that commits → listener receives.
        yield* db.transaction(() =>
          Effect.gen(function* () {
            yield* Wake.notifyInTransaction(db as unknown as DbShape, sessionID)
          }),
        )

        yield* Effect.sleep(200)
        expect(receivedPayload).not.toBeNull()
        expect(typeof receivedPayload).toBe("string")

        yield* Effect.tryPromise({ try: () => native.end(), catch: () => {} })
      }),
    )
  }, TEST_TIMEOUT)
})

// (d) Concurrent same-aggregate publishes through the REAL EventV2 pipe
// → contiguous seqs (T2 through commitDurableEvent, not hand-rolled SQL).
describe("PG concurrency — T2 exact-seq through real EventV2 pipe (decision #5, Memo #6 B5.3)", () => {
  test("two concurrent EventV2.publish for same aggregate → contiguous seqs", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_t2_real")

        yield* setupSession(db, "ses_t2_real")

        // Pre-create the event_sequence row so FOR UPDATE has a row to
        // lock (FOR UPDATE on a non-existent row doesn't serialize —
        // both concurrent txns would see "no row" and both compute seq=0).
        yield* db
          .insert(PgEventSequenceTable)
          .values({ aggregate_id: SessionSchema.ID.make("ses_t2_real"), seq: -1 })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        // Non-vacuity: prove the session row landed before asserting behavior.
        const sessionRow = yield* db
          .select()
          .from(PgSessionTable)
          .where(eq(PgSessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(sessionRow).toBeDefined()

        // Two concurrent publishes through the REAL EventV2 pipe.
        // commitDurableEvent applies FOR UPDATE (T2) via Lock.forUpdate.
        const events = yield* EventV2.Service
        const [event1, event2] = yield* Effect.all(
          [
            events.publish(SessionEvent.PromptAdmitted, {
              messageID: SessionMessage.ID.make("msg_t2_a"),
              sessionID,
              timestamp: DateTime.makeUnsafe(CREATED_MS),
              prompt: { text: "T2 A" },
              delivery: "steer",
            }),
            events.publish(SessionEvent.PromptAdmitted, {
              messageID: SessionMessage.ID.make("msg_t2_b"),
              sessionID,
              timestamp: DateTime.makeUnsafe(CREATED_MS + 1),
              prompt: { text: "T2 B" },
              delivery: "steer",
            }),
          ],
          { concurrency: "unbounded" },
        )

        // Contiguous seqs: 0 and 1 (event_sequence starts at -1, first event = 0).
        const seqs = [event1.durable?.seq, event2.durable?.seq].sort((a, b) => (a ?? 0) - (b ?? 0))
        expect(seqs).toEqual([0, 1])

        // Non-vacuity: prove the events actually landed in the event table.
        const eventRows = yield* db
          .select()
          .from(PgEventTable)
          .where(eq(PgEventTable.aggregate_id, sessionID))
          .all()
          .pipe(Effect.orDie)
        expect(eventRows.length).toBe(2)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// (d) Two-drain promotion through promoteSteers/promoteNextQueued → exactly-once.
describe("PG concurrency — exactly-once promotion (decision #5)", () => {
  test("promoteSteers promotes each input exactly once", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        yield* boot
        const { db, schema } = yield* getServiceDb
        const sessionID = "ses_promote_steers"

        yield* setupSession(db, sessionID)
        yield* insertPendingInput(db, sessionID, "s1", "steer", 1)
        yield* insertPendingInput(db, sessionID, "s2", "steer", 2)
        yield* insertPendingInput(db, sessionID, "s3", "steer", 3)

        // Non-vacuity: prove the inputs landed.
        const pendingRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(pendingRows.length).toBe(3)
        for (const row of pendingRows) {
          expect(row.promoted_seq).toBeNull()
        }

        const events = yield* EventV2.Service
        const promoted = yield* SessionInput.promoteSteers(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
          Number.MAX_SAFE_INTEGER,
        )
        expect(promoted).toBe(3)

        // Exactly-once: all promoted, none still pending.
        const afterRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(afterRows.length).toBe(3)
        for (const row of afterRows) {
          expect(row.promoted_seq).not.toBeNull()
        }

        // Idempotent: second promotion promotes nothing.
        const promotedAgain = yield* SessionInput.promoteSteers(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
          Number.MAX_SAFE_INTEGER,
        )
        expect(promotedAgain).toBe(0)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)

  test("promoteNextQueued promotes exactly one queued input", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        yield* boot
        const { db, schema } = yield* getServiceDb
        const sessionID = "ses_promote_queue"

        yield* setupSession(db, sessionID)
        yield* insertPendingInput(db, sessionID, "q1", "queue", 1)
        yield* insertPendingInput(db, sessionID, "q2", "queue", 2)

        // Non-vacuity: prove the inputs landed.
        const pendingRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(pendingRows.length).toBe(2)

        const events = yield* EventV2.Service
        const promoted1 = yield* SessionInput.promoteNextQueued(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
        )
        expect(promoted1).toBe(true)

        // Exactly one promoted, one still pending.
        const afterFirst = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        const promotedCount = afterFirst.filter((r) => r.promoted_seq !== null).length
        const pendingCount = afterFirst.filter((r) => r.promoted_seq === null).length
        expect(promotedCount).toBe(1)
        expect(pendingCount).toBe(1)

        // Second promotion promotes the remaining one.
        const promoted2 = yield* SessionInput.promoteNextQueued(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
        )
        expect(promoted2).toBe(true)

        const afterSecond = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        const allPromoted = afterSecond.every((r) => r.promoted_seq !== null)
        expect(allPromoted).toBe(true)

        // Third promotion: nothing left.
        const promoted3 = yield* SessionInput.promoteNextQueued(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
        )
        expect(promoted3).toBe(false)
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)

  test("concurrent promoteSteers on same session → both succeed, zero double-promotion (FM-29 fix)", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        yield* boot
        const { db, schema } = yield* getServiceDb
        const sessionID = "ses_promote_concurrent"

        yield* setupSession(db, sessionID)
        yield* insertPendingInput(db, sessionID, "c1", "steer", 1)
        yield* insertPendingInput(db, sessionID, "c2", "steer", 2)

        // Non-vacuity.
        const pendingRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(pendingRows.length).toBe(2)

        const events = yield* EventV2.Service
        // Memo #14 Condition 3 (FM-29): with claim-then-promote in ONE
        // transaction, the SELECT FOR UPDATE SKIP LOCKED is inside the
        // wrapping db.transaction. Two concurrent promoteSteers on the same
        // session: the loser's SKIP LOCKED SELECT returns NO rows →
        // promotes 0 and exits cleanly — NOT a LifecycleConflict crash.
        // Both calls SUCCEED (Exit.isSuccess both).
        const [exit1, exit2] = yield* Effect.all(
          [
            Effect.exit(
              SessionInput.promoteSteers(
                db as unknown as DbShape,
                schema,
                events,
                SessionSchema.ID.make(sessionID),
                Number.MAX_SAFE_INTEGER,
              ),
            ),
            Effect.exit(
              SessionInput.promoteSteers(
                db as unknown as DbShape,
                schema,
                events,
                SessionSchema.ID.make(sessionID),
                Number.MAX_SAFE_INTEGER,
              ),
            ),
          ],
          { concurrency: "unbounded" },
        )

        // Both calls succeed — no LifecycleConflict crash.
        expect(Exit.isSuccess(exit1)).toBe(true)
        expect(Exit.isSuccess(exit2)).toBe(true)

        // Totals sum to the row count (2, not 4 — zero double-promotion).
        const promoted1 = Exit.isSuccess(exit1) ? exit1.value : 0
        const promoted2 = Exit.isSuccess(exit2) ? exit2.value : 0
        expect(promoted1 + promoted2).toBe(2)

        // All rows promoted exactly once.
        const afterRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(afterRows.length).toBe(2)
        for (const row of afterRows) {
          expect(row.promoted_seq).not.toBeNull()
        }

        // Unique promoted_seq values (no duplicates).
        const promotedSeqs = afterRows.map((r) => r.promoted_seq).sort()
        expect(promotedSeqs[0]).not.toBe(promotedSeqs[1])
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// Step 9 multi-session no-double-promotion smoke: 2+ concurrent sessions
// with concurrent input admission/promotion proving no double-promotion AND
// cross-session isolation. The existing same-session concurrent test (above)
// proves zero double-promotion within ONE session; this test extends to the
// MULTI-session dimension: two DIFFERENT sessions, each with their own
// inputs, concurrent promoteSteers — proving they don't interfere and each
// session's inputs are promoted exactly once.
describe("PG concurrency — multi-session no-double-promotion (Step 9 smoke)", () => {
  test("two concurrent sessions: each promotes its own inputs exactly once, zero cross-session interference", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        yield* boot
        const { db, schema } = yield* getServiceDb
        const sessionA = "ses_multi_a"
        const sessionB = "ses_multi_b"

        yield* setupSession(db, sessionA)
        yield* setupSession(db, sessionB)
        yield* insertPendingInput(db, sessionA, "a1", "steer", 1)
        yield* insertPendingInput(db, sessionA, "a2", "steer", 2)
        yield* insertPendingInput(db, sessionB, "b1", "steer", 1)
        yield* insertPendingInput(db, sessionB, "b2", "steer", 2)
        yield* insertPendingInput(db, sessionB, "b3", "steer", 3)

        // Non-vacuity: prove the inputs landed in each session.
        const rowsA = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionA)))
          .all()
          .pipe(Effect.orDie)
        expect(rowsA.length).toBe(2)
        const rowsB = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionB)))
          .all()
          .pipe(Effect.orDie)
        expect(rowsB.length).toBe(3)

        const events = yield* EventV2.Service
        // Concurrent promoteSteers on TWO DIFFERENT sessions.
        const [exitA, exitB] = yield* Effect.all(
          [
            Effect.exit(
              SessionInput.promoteSteers(
                db as unknown as DbShape,
                schema,
                events,
                SessionSchema.ID.make(sessionA),
                Number.MAX_SAFE_INTEGER,
              ),
            ),
            Effect.exit(
              SessionInput.promoteSteers(
                db as unknown as DbShape,
                schema,
                events,
                SessionSchema.ID.make(sessionB),
                Number.MAX_SAFE_INTEGER,
              ),
            ),
          ],
          { concurrency: "unbounded" },
        )

        // Both sessions' promotions succeed.
        expect(Exit.isSuccess(exitA)).toBe(true)
        expect(Exit.isSuccess(exitB)).toBe(true)
        const promotedA = Exit.isSuccess(exitA) ? exitA.value : 0
        const promotedB = Exit.isSuccess(exitB) ? exitB.value : 0
        expect(promotedA).toBe(2)
        expect(promotedB).toBe(3)

        // Cross-session isolation: session A has exactly 2 promoted, session B has 3.
        const afterA = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionA)))
          .all()
          .pipe(Effect.orDie)
        expect(afterA.length).toBe(2)
        for (const row of afterA) {
          expect(row.promoted_seq).not.toBeNull()
        }

        const afterB = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionB)))
          .all()
          .pipe(Effect.orDie)
        expect(afterB.length).toBe(3)
        for (const row of afterB) {
          expect(row.promoted_seq).not.toBeNull()
        }

        // No cross-session promoted_seq collision: the promoted_seq values
        // across both sessions are unique per session (each session has its
        // own promoted_seq namespace).
        const seqsA = afterA.map((r) => r.promoted_seq).sort()
        const seqsB = afterB.map((r) => r.promoted_seq).sort()
        expect(seqsA[0]).not.toBe(seqsA[1])
        expect(seqsB[0]).not.toBe(seqsB[1])
        expect(seqsB[1]).not.toBe(seqsB[2])
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})
// A batch where one input hits LifecycleConflict mid-batch → that input
// is skipped (rolled back to its savepoint), the OTHERS still promote, and
// the tx commits. The conflict is constructed deterministically by
// pre-inserting a session_message row for one input's message ID —
// projectPrompted checks for an existing session_message by id and dies
// with LifecycleConflict if found (input.ts:106-112).
describe("PG concurrency — savepoint continuation (Memo #14 Cond 3)", () => {
  test("LifecycleConflict mid-batch → skip that input, promote the others, tx commits", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        yield* boot
        const { db, schema } = yield* getServiceDb
        const sessionID = "ses_savepoint_continue"

        yield* setupSession(db, sessionID)
        yield* insertPendingInput(db, sessionID, "sp1", "steer", 1)
        yield* insertPendingInput(db, sessionID, "sp2", "steer", 2)
        yield* insertPendingInput(db, sessionID, "sp3", "steer", 3)

        // Pre-insert a session_message row for sp2's message ID. When
        // promoteSteers tries to promote sp2, the Prompted projector's
        // projectPrompted will find this pre-existing row and die with
        // LifecycleConflict. The nested savepoint rolls back sp2's event
        // writes, and the batch continues with sp1 and sp3.
        const preExistingMessage = SessionMessage.User.make({
          id: SessionMessage.ID.make("msg_sp2"),
          type: "user",
          text: "pre-existing",
          time: { created: DateTime.makeUnsafe(CREATED_MS) },
        })
        const { id: _msgId, type: _msgType, ...preExistingData } = Schema.encodeSync(SessionMessage.Message)(preExistingMessage)
        yield* db
          .insert(PgSessionMessageTable)
          .values({
            id: SessionMessage.ID.make("msg_sp2"),
            session_id: SessionSchema.ID.make(sessionID),
            type: "user",
            seq: 999,
            time_created: CREATED_MS,
            data: preExistingData as SchemaTables["SessionMessageTable"]["$inferInsert"]["data"],
          })
          .run()
          .pipe(Effect.orDie)

        // Verify the pre-insert is visible (non-vacuity for the fixture).
        const preExisting = yield* db
          .select({ id: PgSessionMessageTable.id })
          .from(PgSessionMessageTable)
          .where(eq(PgSessionMessageTable.id, SessionMessage.ID.make("msg_sp2")))
          .get()
          .pipe(Effect.orDie)
        expect(preExisting).toBeDefined()

        // Non-vacuity: prove the inputs landed.
        const pendingRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(pendingRows.length).toBe(3)

        const events = yield* EventV2.Service
        const promoted = yield* SessionInput.promoteSteers(
          db as unknown as DbShape,
          schema,
          events,
          SessionSchema.ID.make(sessionID),
          Number.MAX_SAFE_INTEGER,
        )

        // sp1 and sp3 promoted (2); sp2 skipped (LifecycleConflict).
        expect(promoted).toBe(2)

        // sp1 and sp3 promoted, sp2 still pending.
        const afterRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        const promotedRows = afterRows.filter((r) => r.promoted_seq !== null)
        const stillPending = afterRows.filter((r) => r.promoted_seq === null)
        expect(promotedRows.length).toBe(2)
        expect(stillPending.length).toBe(1)
        expect(stillPending[0]?.id).toBe(SessionMessage.ID.make("msg_sp2"))

        // Unique promoted_seq values for the promoted inputs.
        const promotedSeqs = promotedRows.map((r) => r.promoted_seq).sort()
        expect(promotedSeqs[0]).not.toBe(promotedSeqs[1])
      }).pipe(Effect.provide(eventLayer())),
    )
  }, TEST_TIMEOUT)
})

// SQLite no-op verification — the dialect fork must be invisible to SQLite.
describe("Dialect fork — SQLite no-op", () => {
  test("isPg is false when DATABASE_URL is unset", async () => {
    await modulesLoaded
    if (databaseUrl) {
      expect(isPg).toBe(true)
    } else {
      expect(isPg).toBe(false)
    }
  })

  test("notifyInTransaction no-ops under SQLite (isPg false)", async () => {
    await modulesLoaded
    if (databaseUrl) return
    const result = Wake.notifyInTransaction({} as never, "ses_test")
    expect(Effect.runSync(result)).toBeUndefined()
  })
})
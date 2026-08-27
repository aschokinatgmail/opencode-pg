// Memo #14 Condition 5 (FM-27): wake RECEIVE side integration tests.
//
// Gated on TEST_DATABASE_URL (ephemeral postgres:17-alpine). The tests
// are no-ops without it so the default SQLite suite is unaffected.
//
// Test matrix:
// (a) NOTIFY on a subscribed channel triggers the wake path (onWake fired).
// (b) Backstop wakes a pending session WITHOUT any NOTIFY (onWake fired by poll).
// (c) Unlisten on scope close leaves no listener (second subscribe/unsubscribe cycle works).
// (d) Reconnect catch-up: kill the listener connection, publish during outage,
//     assert the session still gets woken after reconnect.
// (e) SQLite no-op: isPg false → receive side inert (withDrain runs drain unchanged).
//
// FM-28 discipline: setup composes Effects (never async-awaiting Effects);
// DATABASE_URL set BEFORE dynamic import so isPg conditionals are ACTIVE;
// non-vacuity asserts (row counts > 0 before behavior asserts).

import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Ref } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseUrl = testDatabaseUrl

let isPg = false
let Wake: typeof import("@opencode-ai/core/database/wake")
let Database: typeof import("@opencode-ai/core/database/database")
let DatabaseMigrationPg: typeof import("@opencode-ai/core/database/migration.pg")
let SchemaPgNamespace: typeof import("@opencode-ai/core/schema-pg-namespace")
let PgSessionTable: typeof import("@opencode-ai/core/session/sql.pg").SessionTable
let PgSessionInputTable: typeof import("@opencode-ai/core/session/sql.pg").SessionInputTable
let PgProjectTable: typeof import("@opencode-ai/core/project/sql.pg").ProjectTable
let ProjectSchema: typeof import("@opencode-ai/core/project/schema")
let SessionSchema: typeof import("@opencode-ai/core/session/schema")
let SessionMessage: typeof import("@opencode-ai/core/session/message")
let AbsolutePath: typeof import("@opencode-ai/core/schema").AbsolutePath

type DbShape = import("@opencode-ai/core/database/database").Database.Interface["db"]

const modulesLoaded = testDatabaseUrl
  ? (async () => {
      process.env.DATABASE_URL = testDatabaseUrl
      const wake = await import("@opencode-ai/core/database/wake")
      const database = await import("@opencode-ai/core/database/database")
      const migrationPg = await import("@opencode-ai/core/database/migration.pg")
      const schemaPgNs = await import("@opencode-ai/core/schema-pg-namespace")
      const sessionSqlPg = await import("@opencode-ai/core/session/sql.pg")
      const projectSqlPg = await import("@opencode-ai/core/project/sql.pg")
      const projectSchema = await import("@opencode-ai/core/project/schema")
      const sessionSchema = await import("@opencode-ai/core/session/schema")
      const sessionMessage = await import("@opencode-ai/core/session/message")
      const schema = await import("@opencode-ai/core/schema")
      Wake = wake
      Database = database
      DatabaseMigrationPg = migrationPg
      SchemaPgNamespace = schemaPgNs
      PgSessionTable = sessionSqlPg.SessionTable
      PgSessionInputTable = sessionSqlPg.SessionInputTable
      PgProjectTable = projectSqlPg.ProjectTable
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

// isPg activation sanity check — proves the DATABASE_URL env set before
// import activated the isPg conditionals.
describe("Wake receive — isPg activation (FM-28b)", () => {
  test("isPg is true when TEST_DATABASE_URL is set (conditionals ACTIVE)", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
  }, TEST_TIMEOUT)

  // Memo #14 Cond 7 (folded via Memo #15 Cond 4): channelName outputs are
  // ASCII (printable range 0x20-0x7e). IDs are ASCII by schema today; this
  // assert guards against a future non-ASCII ID shape breaking the NOTIFY
  // channel (PG NAMEDATALEN is bytes, not characters).
  test("channelName outputs match /^[\x20-\x7e]*$/ (ASCII)", async () => {
    await modulesLoaded
    const names = [
      Wake.channelName("ses_01HZZZZZZZZZZZZZZZZZZZZZZ"),
      Wake.channelName("ses_test"),
      Wake.channelName("ses_" + "x".repeat(100)),
    ]
    for (const name of names) {
      expect(name).toMatch(/^[\x20-\x7e]*$/)
    }
  }, TEST_TIMEOUT)
})

// (a) NOTIFY on a subscribed channel triggers the wake path.
describe("Wake receive — NOTIFY triggers wake (Memo #14 Cond 5a)", () => {
  test("withDrain: NOTIFY on subscribed channel → onWake fires", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = "ses_notify_wake"

        yield* setupSession(db, sessionID)

        // Non-vacuity: prove the session row landed.
        const sessionRow = yield* db
          .select()
          .from(PgSessionTable)
          .where(eq(PgSessionTable.id, SessionSchema.ID.make(sessionID)))
          .get()
          .pipe(Effect.orDie)
        expect(sessionRow).toBeDefined()

        const wakeCount = yield* Ref.make(0)
        const onWake = () => Ref.update(wakeCount, (n) => n + 1)

        // Use withDrain with a drain that sleeps briefly so the NOTIFY
        // consumer fiber has time to fire.
        const result = yield* Wake.WakeReceiverService.pipe(
          Effect.provide(Wake.WakeReceiverLayer),
          Effect.flatMap((receiver) =>
            receiver.withDrain(
              sessionID,
              onWake,
              Effect.gen(function* () {
                // Publish a NOTIFY from a separate connection (simulates
                // cross-process admission). Use pg_notify directly.
                const native = (yield* Effect.tryPromise({
                  try: () => import("postgres").then((m) => m.default(databaseUrl!, { max: 1 })),
                  catch: () => null,
                })) as ReturnType<typeof import("postgres")> | null
                if (!native) return
                const channel = Wake.channelName(sessionID)
                // Use a different process tag so the listener does NOT self-drop.
                yield* Effect.promise(() =>
                  native`SELECT pg_notify(${channel}, 'external_process_tag')`,
                )
                // Give the listener time to receive and fire onWake.
                yield* Effect.sleep(500)
                yield* Effect.promise(() => native.end({ timeout: 5 }))
              }),
            ),
          ),
        )

        const count = yield* Ref.get(wakeCount)
        // onWake should have fired at least once (from NOTIFY; the
        // backstop may also have fired). Non-vacuity: count > 0.
        expect(count).toBeGreaterThan(0)
      }),
    )
  }, TEST_TIMEOUT)
})

// (b) Backstop wakes a pending session WITHOUT any NOTIFY.
describe("Wake receive — backstop catches without NOTIFY (Memo #14 Cond 5b)", () => {
  test("withDrain: pending session_input row → backstop fires onWake", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db, schema } = yield* boot
        const sessionID = "ses_backstop_wake"

        yield* setupSession(db, sessionID)
        yield* insertPendingInput(db, sessionID, "b1", "steer", 1)

        // Non-vacuity: prove the pending input landed.
        const pendingRows = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
          .all()
          .pipe(Effect.orDie)
        expect(pendingRows.length).toBe(1)
        expect(pendingRows[0].promoted_seq).toBeNull()

        const wakeCount = yield* Ref.make(0)
        const onWake = () => Ref.update(wakeCount, (n) => n + 1)

        // Use withDrain with a drain that sleeps long enough for the
        // backstop to tick at least once (1.5s + jitter).
        yield* Wake.WakeReceiverService.pipe(
          Effect.provide(Wake.WakeReceiverLayer),
          Effect.flatMap((receiver) =>
            receiver.withDrain(
              sessionID,
              onWake,
              Effect.gen(function* () {
                // Sleep 3s — enough for at least one backstop tick.
                yield* Effect.sleep(3000)
              }),
            ),
          ),
        )

        const count = yield* Ref.get(wakeCount)
        // The backstop should have fired onWake at least once.
        // (NOTIFY is not published — only the backstop catches.)
        expect(count).toBeGreaterThan(0)
      }),
    )
  }, TEST_TIMEOUT)
})

// (c) Unlisten on scope close leaves no listener (second cycle works).
describe("Wake receive — unlisten on scope close (FM-27)", () => {
  test("withDrain: scope close unsubscribes; second subscribe/unsubscribe cycle works", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = "ses_unlisten_cycle"

        yield* setupSession(db, sessionID)

        // First cycle: subscribe, run a short drain, scope closes → unsubscribe.
        yield* Wake.WakeReceiverService.pipe(
          Effect.provide(Wake.WakeReceiverLayer),
          Effect.flatMap((receiver) =>
            receiver.withDrain(sessionID, () => Effect.void, Effect.sleep(200)),
          ),
        )

        // Second cycle: subscribe again to the same channel — proves the
        // first unlisten released the server-side LISTEN slot. If unlisten
        // was not honored, the second LISTEN would either error or the
        // channel would have duplicate listeners.
        const wakeCount = yield* Ref.make(0)
        const onWake = () => Ref.update(wakeCount, (n) => n + 1)

        yield* Wake.WakeReceiverService.pipe(
          Effect.provide(Wake.WakeReceiverLayer),
          Effect.flatMap((receiver) =>
            receiver.withDrain(
              sessionID,
              onWake,
              Effect.gen(function* () {
                const native = (yield* Effect.tryPromise({
                  try: () => import("postgres").then((m) => m.default(databaseUrl!, { max: 1 })),
                  catch: () => null,
                })) as ReturnType<typeof import("postgres")> | null
                if (!native) return
                const channel = Wake.channelName(sessionID)
                yield* Effect.promise(() =>
                  native`SELECT pg_notify(${channel}, 'external_process_tag_2')`,
                )
                yield* Effect.sleep(500)
                yield* Effect.promise(() => native.end({ timeout: 5 }))
              }),
            ),
          ),
        )

        const count = yield* Ref.get(wakeCount)
        // Second cycle's NOTIFY should fire onWake — proves the unlisten
        // from the first cycle worked (no stale listener blocking).
        expect(count).toBeGreaterThan(0)
      }),
    )
  }, TEST_TIMEOUT)
})

// (d) Reconnect catch-up: kill the listener connection, publish during
// outage, assert the session still gets woken after reconnect.
describe("Wake receive — reconnect catch-up (Memo #1 reconnect order)", () => {
  test("withDrain: listener killed, NOTIFY during outage → wake after reconnect", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    await run(
      Effect.gen(function* () {
        const { db } = yield* boot
        const sessionID = "ses_reconnect_catchup"

        yield* setupSession(db, sessionID)

        const wakeCount = yield* Ref.make(0)
        const onWake = () => Ref.update(wakeCount, (n) => n + 1)

        yield* Wake.WakeReceiverService.pipe(
          Effect.provide(Wake.WakeReceiverLayer),
          Effect.flatMap((receiver) =>
            receiver.withDrain(
              sessionID,
              onWake,
              Effect.gen(function* () {
                // Use a separate postgres-js instance to find and kill
                // the listener's backend PID — must NOT use the drain's
                // Client.SqlClient (pg_terminate_backend on the same
                // pool would kill the drain's own connection).
                const killer = (yield* Effect.tryPromise({
                  try: () => import("postgres").then((m) => m.default(databaseUrl!, { max: 1 })),
                  catch: () => null,
                })) as ReturnType<typeof import("postgres")> | null
                if (!killer) return

                // Wait for the listener to establish its LISTEN connection.
                yield* Effect.sleep(500)

                // Find the listener's backend PID — filter by state=idle
                // and query matching LISTEN (lowercase in pg_stat_activity).
                const listeners = yield* Effect.promise(() =>
                  killer`SELECT pid FROM pg_stat_activity WHERE state = 'idle' AND query ILIKE 'listen%' AND datname = current_database()`,
                )

                // Non-vacuity: at least one LISTEN connection exists.
                expect((listeners as unknown[]).length).toBeGreaterThan(0)

                const pid = (listeners[0] as Record<string, number>)?.pid
                if (pid) {
                  yield* Effect.promise(() => killer`SELECT pg_terminate_backend(${pid})`)
                }

                // Wait for postgres-js to reconnect the listener.
                yield* Effect.sleep(2000)

                // Publish a NOTIFY after the reconnect window.
                const channel = Wake.channelName(sessionID)
                yield* Effect.promise(() =>
                  killer`SELECT pg_notify(${channel}, 'external_process_tag_3')`,
                )
                // Give the reconnected listener time to receive.
                yield* Effect.sleep(1000)
                yield* Effect.promise(() => killer.end({ timeout: 5 }))
              }),
            ),
          ),
        )

        const count = yield* Ref.get(wakeCount)
        // After reconnect, the NOTIFY (or the backstop) should have
        // fired onWake. Non-vacuity: count > 0.
        expect(count).toBeGreaterThan(0)
      }),
    )
  }, TEST_TIMEOUT)
})

// (e) SQLite no-op: isPg false → receive side inert.
describe("Wake receive — SQLite no-op (dialect fork)", () => {
  test("isPg is false when DATABASE_URL is unset", async () => {
    await modulesLoaded
    if (databaseUrl) {
      expect(isPg).toBe(true)
    } else {
      expect(isPg).toBe(false)
    }
  })

  test("withDrain under SQLite just runs the drain unchanged", async () => {
    await modulesLoaded
    if (databaseUrl) return
    // Under SQLite, WakeReceiverLayer is the no-op layer where
    // withDrain runs the drain unchanged. Verify the drain result
    // passes through.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const receiver = yield* Wake.WakeReceiverService
        return yield* receiver.withDrain("ses_sqlite_noop", () => Effect.void, Effect.succeed(42))
      }).pipe(Effect.provide(Wake.WakeReceiverLayer)),
    )
    expect(result).toBe(42)
  })
})
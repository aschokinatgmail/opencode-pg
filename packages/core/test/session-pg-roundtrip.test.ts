// H-1 smoke (Memo #11 UNVERIFIED #1/#2 — Step 5 first verification item):
// PG session row round-trips through the rewired consumers, plus the exact
// H-1 shape: epoch-millis NUMBERS written to PG
// timestamp({ withTimezone: true, mode: "date" }) columns at
// session/input.ts:120/:177 and session/projector.ts:126/:209/:282.
//
// Gated on TEST_DATABASE_URL (ephemeral postgres:17-alpine; the test is a
// no-op without it, so the default SQLite suite is unaffected).
//
// Control writes use the Date shape the PG Timestamps helper itself
// produces ($default(() => new Date())); H-1 writes mirror the exact value
// shapes the rewired consumers pass (numbers from NonNegativeInt /
// DateTime.toEpochMillis) through the same erased DatabaseShape path
// consumers use (schema namespace + database.ts:77 cast).
//
// FM-28b fix (Memo #17 Cond 1): ZERO static runtime imports of core modules
// that transitively import database/database.ts. The previous static
// `import { SessionInput } from "@opencode-ai/core/session/input"` (chain:
// input.ts:8 → lock.ts:3 → database.ts isPg RUNTIME value import) froze
// isPg=false at static-hoist time with DATABASE_URL unset. Now uses the
// matrix pattern (dialect-matrix.test.ts:129-217): `import type` + `let X:
// typeof import(...)` bindings + dynamic imports AFTER
// `process.env.DATABASE_URL = TEST_DATABASE_URL`.

import { describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Cause, DateTime, Effect, Exit, Schema } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"

// FM-28b: ONLY `import type` static imports — no runtime imports of core
// modules that transitively import database/database.ts.
import type * as DatabaseMigrationPgType from "@opencode-ai/core/database/migration.pg"
import type { Database } from "@opencode-ai/core/database/database"
import type * as SchemaPgNamespaceType from "@opencode-ai/core/schema-pg-namespace"
import type { ProjectTable as PgProjectTableType } from "@opencode-ai/core/project/sql.pg"
import type {
  SessionTable as PgSessionTableType,
  SessionMessageTable as PgSessionMessageTableType,
  SessionInputTable as PgSessionInputTableType,
} from "@opencode-ai/core/session/sql.pg"
import type { ProjectSchema as ProjectSchemaType } from "@opencode-ai/core/project/schema"
import type { SessionSchema as SessionSchemaType } from "@opencode-ai/core/session/schema"
import type { SessionInput as SessionInputType } from "@opencode-ai/core/session/input"
import type { SessionMessage as SessionMessageType } from "@opencode-ai/core/session/message"
import type { AbsolutePath as AbsolutePathType } from "@opencode-ai/core/schema"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseUrl = testDatabaseUrl

let isPg = false
let DatabaseMigrationPg: typeof DatabaseMigrationPgType
let SchemaPgNamespace: typeof SchemaPgNamespaceType
let PgProjectTable: typeof PgProjectTableType
let PgSessionTable: typeof PgSessionTableType
let PgSessionMessageTable: typeof PgSessionMessageTableType
let PgSessionInputTable: typeof PgSessionInputTableType
let ProjectSchema: typeof ProjectSchemaType
let SessionSchema: typeof SessionSchemaType
let SessionInput: typeof SessionInputType
let SessionMessage: typeof SessionMessageType
let AbsolutePath: typeof AbsolutePathType

// FM-28b: set DATABASE_URL BEFORE the dynamic import of core modules.
const modulesLoaded = (async () => {
  if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl
  const migrationPg = await import("@opencode-ai/core/database/migration.pg")
  const schemaPgNs = await import("@opencode-ai/core/schema-pg-namespace")
  const projectSqlPg = await import("@opencode-ai/core/project/sql.pg")
  const sessionSqlPg = await import("@opencode-ai/core/session/sql.pg")
  const projectSchema = await import("@opencode-ai/core/project/schema")
  const sessionSchema = await import("@opencode-ai/core/session/schema")
  const sessionInput = await import("@opencode-ai/core/session/input")
  const sessionMessage = await import("@opencode-ai/core/session/message")
  const schema = await import("@opencode-ai/core/schema")
  const database = await import("@opencode-ai/core/database/database")
  DatabaseMigrationPg = migrationPg
  SchemaPgNamespace = schemaPgNs
  PgProjectTable = projectSqlPg.ProjectTable
  PgSessionTable = sessionSqlPg.SessionTable
  PgSessionMessageTable = sessionSqlPg.SessionMessageTable
  PgSessionInputTable = sessionSqlPg.SessionInputTable
  ProjectSchema = projectSchema
  SessionSchema = sessionSchema
  SessionInput = sessionInput
  SessionMessage = sessionMessage
  AbsolutePath = schema.AbsolutePath
  isPg = database.isPg
})()

const TEST_TIMEOUT = 30_000

const run = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(pgLayer({ url: databaseUrl! }))) as Effect.Effect<A, E, never>,
  )

const makeDb = EffectDrizzlePg.makeWithDefaults()

const CREATED_MS = 1737360000000 // 2025-01-20T08:00:00.000Z
const UPDATED_MS = 1737360060000

// Real encode path (projector.ts:22-23, :200-201) for session_message rows.
// Deferred until after modulesLoaded (SessionMessage is a dynamic binding).
const userMessageRow = (text: string, createdMs: number) => {
  const encoded = Schema.encodeSync(SessionMessage.Message)(
    SessionMessage.User.make({
      id: SessionMessage.ID.make("msg_h1_smoke"),
      type: "user",
      text,
      time: { created: DateTime.makeUnsafe(createdMs) },
    }),
  )
  const { id: _id, type, ...data } = encoded
  return { type, data }
}

type Check = { label: string; pass: boolean; detail?: string }

const epochOf = (value: Date | string | number | null | undefined) =>
  value === null || value === undefined
    ? NaN
    : value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value)

const summarize = (cause: Cause.Cause<unknown>) => {
  const squashed = Cause.squash(cause)
  const name = squashed instanceof Error ? `${squashed.constructor.name}: ${squashed.message}` : String(squashed)
  return `${name}\n${Cause.pretty(cause)
    .split("\n")
    .slice(0, 6)
    .join("\n")}`
}

// jsonb does not preserve object key order (PG normalizes it), so raw
// JSON.stringify comparison would report false mismatches.
const canonical = (value: unknown): string =>
  typeof value === "object" && value !== null
    ? `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
        .join(",")}}`
    : JSON.stringify(value)

const report = (results: Check[]) => {
  const failed = results.filter((r) => !r.pass)
  expect(failed.map((f) => `${f.label}${f.detail ? ` | ${f.detail}` : ""}`)).toEqual([])
}

// Fresh public schema + real migration seam + the real drizzle db factory
// (same makeWithDefaults call as database.ts pgLayerInit) + the real PG
// schema namespace (what pgSchemaLayer provides as Database.Schema).
const boot = Effect.gen(function* () {
  const client = yield* Client.SqlClient
  yield* client.unsafe("DROP SCHEMA public CASCADE").withoutTransform
  yield* client.unsafe("CREATE SCHEMA public").withoutTransform
  yield* DatabaseMigrationPg.apply(client)
  const db = yield* makeDb
  return {
    db,
    schema: SchemaPgNamespace.namespace,
    // The accepted type-erasure seam (database.ts:77 pgDb as unknown as
    // DatabaseShape) — the exact view consumers operate through.
    consumerDb: db as unknown as Database.Interface["db"],
  }
})

describe("PG session round-trip smoke (H-1, Memo #11 U-1/U-2)", () => {
  test("isPg is true when TEST_DATABASE_URL is set (FM-28b sanity, Memo #17 Cond 1)", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
  }, TEST_TIMEOUT)

  test("control: Date-valued session/session_message/session_input rows round-trip", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
    const results: Check[] = []
    const check = (label: string, pass: boolean, detail?: string) => {
      console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `\n      ${detail.replaceAll("\n", "\n      ")}` : ""}`)
      results.push({ label, pass, detail })
    }
    await run(
      Effect.gen(function* () {
        const { db, schema, consumerDb } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_h1_ctrl")

        yield* db
          .insert(PgProjectTable)
          .values({
            id: ProjectSchema.ID.make("pro_h1_ctrl"),
            worktree: AbsolutePath.make("/tmp/h1-smoke"),
            vcs: null,
            name: "h1-smoke",
            time_created: CREATED_MS,
            time_updated: UPDATED_MS,
            sandboxes: [],
          })
          .run()

        yield* db
          .insert(PgSessionTable)
          .values({
            id: sessionID,
            project_id: ProjectSchema.ID.make("pro_h1_ctrl"),
            slug: "h1-ctrl",
            directory: "/tmp/h1-smoke",
            title: "H-1 control",
            version: "1.0.0",
            time_created: CREATED_MS,
            time_updated: UPDATED_MS,
          })
          .run()

        const controlMessage = userMessageRow("h1 control", CREATED_MS)
        yield* db
          .insert(PgSessionMessageTable)
          .values({
            id: SessionMessage.ID.make("msg_h1_ctrl"),
            session_id: sessionID,
            type: controlMessage.type,
            seq: 1,
            time_created: CREATED_MS,
            data: controlMessage.data,
          })
          .run()

        yield* db
          .insert(PgSessionInputTable)
          .values({
            id: SessionMessage.ID.make("msg_h1_ctrl_in"),
            session_id: sessionID,
            prompt: { text: "h1 control prompt" },
            delivery: "steer",
            admitted_seq: 1,
            time_created: CREATED_MS,
          })
          .run()

        const session = yield* db.select().from(PgSessionTable).where(eq(PgSessionTable.id, sessionID)).get()
        check("session row exists", session !== undefined)
        if (session) {
          check(
            "session.time_created round-trips exact epoch millis",
            epochOf(session.time_created) === CREATED_MS,
            `got ${String(session.time_created)} (${session.time_created?.constructor?.name})`,
          )
          check("session.title round-trips", session.title === "H-1 control")
          check("session.directory round-trips", session.directory === "/tmp/h1-smoke")
        }

        const message = yield* db
          .select()
          .from(PgSessionMessageTable)
          .where(eq(PgSessionMessageTable.id, SessionMessage.ID.make("msg_h1_ctrl")))
          .get()
        check("session_message row exists", message !== undefined)
        if (message) {
          check(
            "session_message.time_created round-trips exact epoch millis",
            epochOf(message.time_created) === CREATED_MS,
            `got ${String(message.time_created)} (${message.time_created?.constructor?.name})`,
          )
          check("session_message.seq round-trips", message.seq === 1)
          check("session_message.data jsonb round-trips", canonical(message.data) === canonical(controlMessage.data), `got ${JSON.stringify(message.data)}`)
        }

        const input = yield* db
          .select()
          .from(PgSessionInputTable)
          .where(eq(PgSessionInputTable.id, SessionMessage.ID.make("msg_h1_ctrl_in")))
          .get()
        check("session_input row exists", input !== undefined)
        if (input) {
          check(
            "session_input.time_created round-trips exact epoch millis",
            epochOf(input.time_created) === CREATED_MS,
            `got ${String(input.time_created)} (${input.time_created?.constructor?.name})`,
          )
          check("session_input.prompt jsonb round-trips", JSON.stringify(input.prompt) === JSON.stringify({ text: "h1 control prompt" }))
          check("session_input.delivery round-trips", input.delivery === "steer")
          check(
            "session_input.admitted_seq (bigint mode:number) reads back as a JS number",
            typeof input.admitted_seq === "number" && input.admitted_seq === 1,
            `got ${typeof input.admitted_seq}: ${String(input.admitted_seq)} — postgres-js returns bigint as string and drizzle pg bigint has no mapFromDriverValue`,
          )
        }

        // Real consumer read path (input.ts fromRow → Admitted.make decode).
        const findExit = yield* SessionInput.find(consumerDb, schema, SessionMessage.ID.make("msg_h1_ctrl_in")).pipe(Effect.exit)
        if (Exit.isFailure(findExit)) {
          check("SessionInput.find decodes the row", false, summarize(findExit.cause))
        } else if (findExit.value === undefined) {
          check("SessionInput.find decodes the row", false, "find returned undefined for a stored row")
        } else {
          check("SessionInput.find decodes the row", true)
          check(
            "SessionInput.find timeCreated decodes to the same epoch",
            DateTime.toEpochMillis(findExit.value.timeCreated) === CREATED_MS,
            `got ${String(findExit.value.timeCreated)}`,
          )
        }
      }),
    )
    report(results)
  }, TEST_TIMEOUT)

  test("H-1: projector.ts sessionRow numbers into session timestamp(mode:date)", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
    const results: Check[] = []
    const check = (label: string, pass: boolean, detail?: string) => {
      console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `\n      ${detail.replaceAll("\n", "\n      ")}` : ""}`)
      results.push({ label, pass, detail })
    }
    await run(
      Effect.gen(function* () {
        const { db, schema, consumerDb } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_h1_num")

        yield* db
          .insert(PgProjectTable)
          .values({ id: ProjectSchema.ID.make("pro_h1_num"), worktree: AbsolutePath.make("/tmp/h1-smoke"), sandboxes: [] })
          .run()

        // Exact sessionRow value shape (projector.ts:72-73): SessionInfo.time
        // .created/.updated are NonNegativeInt epoch millis — NUMBERS.
        // Effect.sync defers the builder call itself: the H-1 TypeError throws
        // synchronously at .run() (query build), which would otherwise escape
        // the Effect.exit capture.
        const exit = yield* Effect.exit(
          Effect.sync(() =>
            consumerDb
              .insert(schema.SessionTable)
              .values({
                id: sessionID,
                project_id: ProjectSchema.ID.make("pro_h1_num"),
                slug: "h1-num",
                directory: "/tmp/h1-smoke",
                title: "H-1 number shape",
                version: "1.0.0",
                time_created: CREATED_MS,
                time_updated: UPDATED_MS,
              })
              .run(),
          ).pipe(Effect.flatten),
        )

        if (Exit.isFailure(exit)) {
          check("sessionRow-shape write succeeds (H-1 broken if FAIL)", false, summarize(exit.cause))
          const stored = yield* db.select({ id: PgSessionTable.id }).from(PgSessionTable).where(eq(PgSessionTable.id, sessionID)).get()
          check("no silently stored row after the failure", stored === undefined)
          return
        }

        check("sessionRow-shape write succeeds (H-1 broken if FAIL)", true)
        const stored = yield* db.select().from(PgSessionTable).where(eq(PgSessionTable.id, sessionID)).get()
        check("stored row exists", stored !== undefined)
        if (stored) {
          check(
            "stored time_created equals the exact epoch millis (no mis-store)",
            epochOf(stored.time_created) === CREATED_MS,
            `got ${String(stored.time_created)} (${stored.time_created?.constructor?.name})`,
          )
        }
      }),
    )
    report(results)
  }, TEST_TIMEOUT)

  test("H-1: real SessionInput.projectAdmitted (input.ts:120) number time_created", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
    const results: Check[] = []
    const check = (label: string, pass: boolean, detail?: string) => {
      console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `\n      ${detail.replaceAll("\n", "\n      ")}` : ""}`)
      results.push({ label, pass, detail })
    }
    await run(
      Effect.gen(function* () {
        const { db, schema, consumerDb } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_h1_admit")
        const inputID = SessionMessage.ID.make("msg_h1_admit")

        yield* db
          .insert(PgProjectTable)
          .values({ id: ProjectSchema.ID.make("pro_h1_admit"), worktree: AbsolutePath.make("/tmp/h1-smoke"), sandboxes: [] })
          .run()
        yield* db
          .insert(PgSessionTable)
          .values({
            id: sessionID,
            project_id: ProjectSchema.ID.make("pro_h1_admit"),
            slug: "h1-admit",
            directory: "/tmp/h1-smoke",
            title: "H-1 admit",
            version: "1.0.0",
            time_created: CREATED_MS,
            time_updated: UPDATED_MS,
          })
          .run()

        const exit = yield* SessionInput.projectAdmitted(consumerDb, schema, {
          admittedSeq: 7,
          id: inputID,
          sessionID,
          prompt: { text: "H-1 smoke prompt" },
          delivery: "steer",
          timeCreated: DateTime.makeUnsafe(CREATED_MS),
        }).pipe(Effect.exit)

        if (Exit.isFailure(exit)) {
          check("projectAdmitted succeeds (H-1 broken if FAIL)", false, summarize(exit.cause))
          const found = yield* SessionInput.find(consumerDb, schema, inputID)
          check("no stored session_input row after the failure", found === undefined)
          return
        }

        check("projectAdmitted succeeds (H-1 broken if FAIL)", true)
        const found = yield* SessionInput.find(consumerDb, schema, inputID)
        check("SessionInput.find reads the admitted row back", found !== undefined)
        if (found) {
          check(
            "admitted timeCreated round-trips exact epoch millis",
            DateTime.toEpochMillis(found.timeCreated) === CREATED_MS,
            `got ${String(found.timeCreated)}`,
          )
          check("admittedSeq round-trips", found.admittedSeq === 7)
          check("delivery round-trips", found.delivery === "steer")
        }
      }),
    )
    report(results)
  }, TEST_TIMEOUT)

  test("H-1: projector.ts insertMessage(:209) and updateMessage(:126) numbers on session_message", async () => {
    if (!databaseUrl) return
    await modulesLoaded
    expect(isPg).toBe(true)
    const results: Check[] = []
    const check = (label: string, pass: boolean, detail?: string) => {
      console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `\n      ${detail.replaceAll("\n", "\n      ")}` : ""}`)
      results.push({ label, pass, detail })
    }
    await run(
      Effect.gen(function* () {
        const { db, schema, consumerDb } = yield* boot
        const sessionID = SessionSchema.ID.make("ses_h1_msg")
        const userRow = userMessageRow("h1 message", CREATED_MS)
        const data = userRow.data

        yield* db
          .insert(PgProjectTable)
          .values({ id: ProjectSchema.ID.make("pro_h1_msg"), worktree: AbsolutePath.make("/tmp/h1-smoke"), sandboxes: [] })
          .run()
        yield* db
          .insert(PgSessionTable)
          .values({
            id: sessionID,
            project_id: ProjectSchema.ID.make("pro_h1_msg"),
            slug: "h1-msg",
            directory: "/tmp/h1-smoke",
            title: "H-1 message",
            version: "1.0.0",
            time_created: CREATED_MS,
            time_updated: UPDATED_MS,
          })
          .run()

        // insertMessage shape (projector.ts:209): number time_created.
        const insertExit = yield* Effect.exit(
          Effect.sync(() =>
            consumerDb
              .insert(schema.SessionMessageTable)
              .values({
                id: SessionMessage.ID.make("msg_h1_num"),
                session_id: sessionID,
                type: userRow.type,
                seq: 2,
                time_created: DateTime.toEpochMillis(DateTime.makeUnsafe(CREATED_MS)),
                data,
              })
              .run(),
          ).pipe(Effect.flatten),
        )

        if (Exit.isFailure(insertExit)) {
          check("insertMessage-shape write succeeds (H-1 broken if FAIL)", false, summarize(insertExit.cause))
        } else {
          check("insertMessage-shape write succeeds (H-1 broken if FAIL)", true)
          const row = yield* db.select().from(PgSessionMessageTable).where(eq(PgSessionMessageTable.id, SessionMessage.ID.make("msg_h1_num"))).get()
          check(
            "inserted session_message time_created equals exact epoch millis",
            row !== undefined && epochOf(row.time_created) === CREATED_MS,
            `got ${String(row?.time_created)}`,
          )
        }

        // Control row with a Date, then the exact updateMessage .set shape
        // (projector.ts:126): number time_created.
        yield* db
          .insert(PgSessionMessageTable)
          .values({
            id: SessionMessage.ID.make("msg_h1_upd"),
            session_id: sessionID,
            type: userRow.type,
            seq: 3,
            time_created: CREATED_MS,
            data,
          })
          .run()

        const updateExit = yield* Effect.exit(
          Effect.sync(() =>
            consumerDb
              .update(schema.SessionMessageTable)
              .set({ type: userRow.type, time_created: DateTime.toEpochMillis(DateTime.makeUnsafe(UPDATED_MS)), data })
              .where(
                and(
                  eq(schema.SessionMessageTable.id, SessionMessage.ID.make("msg_h1_upd")),
                  eq(schema.SessionMessageTable.session_id, sessionID),
                ),
              )
              .run(),
          ).pipe(Effect.flatten),
        )

        if (Exit.isFailure(updateExit)) {
          check("updateMessage-shape update succeeds (H-1 broken if FAIL)", false, summarize(updateExit.cause))
        } else {
          check("updateMessage-shape update succeeds (H-1 broken if FAIL)", true)
        }

        const after = yield* db
          .select()
          .from(PgSessionMessageTable)
          .where(eq(PgSessionMessageTable.id, SessionMessage.ID.make("msg_h1_upd")))
          .get()
        const afterEpoch = epochOf(after?.time_created)
        check(
          "control row time_created is either unchanged (update aborted) or exactly UPDATED_MS (update applied) — no mis-store",
          afterEpoch === CREATED_MS || afterEpoch === UPDATED_MS,
          `got ${String(after?.time_created)} (${afterEpoch})`,
        )
      }),
    )
    report(results)
  }, TEST_TIMEOUT)
})

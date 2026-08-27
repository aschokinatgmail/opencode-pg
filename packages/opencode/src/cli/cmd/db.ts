// `opencode db` CLI — Step 6 of the PG backend staging plan (decision #11).
//
// Command surface: `opencode db {status, migrate, query, dump, restore}` plus
// `db status --sessions`. `shell` and `reset` are CUT (decision #11).
//
// Dual-dialect (decision #8): DATABASE_URL set → PG; unset → SQLite. The
// dialect fork is single-sourced via `Database.isPg` (database.ts:49) — never
// re-read env. PG-only panel dimensions degrade gracefully on SQLite
// (documented inline).
//
// Reuse contract: commands call `Database.Service` (the drizzle handle) and
// `DatabaseMigration` / `DatabaseMigrationPg` from core. Zero SQL is
// duplicated beyond the observability queries transcribed verbatim from
// Athena's PART 2 memos (with the dialect-split noted per AR4 / Oracle Gate 2).
//
// `instance: false` on every subcommand — db tools never read project state.
//
// Redaction: every DATABASE_URL surfaced in stdout/stderr is run through
// `redactUrl` so the password never leaks. Errors carry the redacted URL too.
//
// Exit codes: 0 success, non-zero on failure with actionable stderr (via
// `fail(...)` from effect-cmd, which surfaces a printed message + exit 1).

import type { Argv } from "yargs"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import * as DatabaseMigrationPg from "@opencode-ai/core/database/migration.pg"
import { effectCmd, fail } from "../effect-cmd"
import { Process } from "@/util/process"

// --- redaction ---------------------------------------------------------------

// Redact the password component of a URL for safe display. Leaves the scheme,
// host, port, path, and query intact so the operator can still identify the
// target. `postgresql://user:secret@host:5432/db` → `postgresql://user:***@host:5432/db`.
// Returns the input unchanged if it is not a parseable URL with userinfo.
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.password) {
      url.password = "***"
      return url.toString()
    }
    return url.toString()
  } catch {
    return raw
  }
}

// --- dialect helpers --------------------------------------------------------

// The dialect-split blob-size expression (AR4 / Oracle Gate 2 note).
// PG: `length(CAST(data AS text))` — jsonb is not text; CAST surfaces the
// stored byte length without decoding. SQLite: `length(data)` — the column
// is text, length() is direct. NEVER let the PG expression leak into SQLite
// mode (the CAST is invalid SQLite syntax against a text column).
export function blobSizeExpr(): string {
  return Database.isPg ? "length(CAST(data AS text))" : "length(data)"
}

// The drizzle PG db handle exposes the raw `SqlClient` via `$client`
// (effect-pg/driver.ts:64-66). The SQLite handle does not. The Database.Service
// erases the type to `DatabaseShape` (database.ts:32), so we cast through
// `unknown` — not `any` — to recover the PG client for raw SQL execution
// (observability panel, read-only query enforcement, migration runner).
function pgClient(db: Database.Interface["db"]): SqlClient {
  return (db as unknown as { $client: SqlClient }).$client
}

// --- status -----------------------------------------------------------------

const StatusCommand = effectCmd({
  command: "status",
  describe: "show database connection target, migration journal, and table summary",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("sessions", {
      type: "boolean",
      default: false,
      describe: "include the per-session observability panel (drain owner, projection lag, pending inputs, AR4 dimensions)",
    }),
  handler: Effect.fn("Cli.db.status")(function* (args: { sessions?: boolean }) {
    const sessions = args.sessions === true
    if (Database.isPg) {
      yield* pgStatus(sessions).pipe(Effect.orDie)
    } else {
      yield* sqliteStatus(sessions).pipe(Effect.orDie)
    }
  }),
})

// SQLite status: path + table counts. PG-only panel dimensions degrade
// gracefully (documented): session_projection_checkpoint and event_sequence
// owner_id do not exist in the SQLite schema, so the --sessions panel skips
// the projection-lag gauge and drain owner on SQLite and reports only the
// dimensions that have a SQLite representation (pending inputs, subagent flag,
// zero-message anomaly, blob-size telemetry).
function sqliteStatus(sessions: boolean) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    console.log("backend: sqlite")
    console.log(`path: ${Database.path()}`)

    const tables = yield* db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    console.log(`tables: ${tables.length}`)
    if (tables.length > 0) {
      for (const row of tables) {
        const count = yield* db.all<{ c: number }>(sql`SELECT count(*) AS c FROM ${sql.identifier(row.name)}`)
        console.log(`  ${row.name}: ${count[0]?.c ?? 0}`)
      }
    }

    const journal = yield* db.all<{ id: string; time_completed: number }>(
      sql`SELECT id, time_completed FROM ${sql.identifier("migration")} ORDER BY id`,
    )
    console.log(`migrations applied: ${journal.length}`)
    for (const row of journal) console.log(`  ${row.id}`)

    if (sessions) yield* sqliteSessionsPanel()
  })
}

function pgStatus(sessions: boolean) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const client = pgClient(db)
    console.log("backend: postgres")
    console.log(`url: ${redactUrl(Database.databaseUrl!)}`)

    const journal = yield* client.unsafe(
      `SELECT id, time_completed FROM "migration" ORDER BY id`,
    ).withoutTransform
    console.log(`migrations applied: ${journal.length}`)
    for (const row of journal as Array<{ id: string }>) console.log(`  ${row.id}`)

    const tables = yield* client.unsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ).withoutTransform
    console.log(`tables: ${tables.length}`)
    for (const row of tables as Array<{ table_name: string }>) console.log(`  ${row.table_name}`)

    if (sessions) yield* pgSessionsPanel(client)
  })
}

// --- status --sessions panel ------------------------------------------------

// Per-session observability panel (AR4 + Athena PART 2 observability queries).
// The base panel (drain owner, projection lag, pending inputs) is transcribed
// from Athena's PART 2 memos verbatim. AR4 dimensions fold in: subagent flag
// (parent_id IS NOT NULL), zero-message anomaly (sessions with no message AND
// no session_message rows), blob-size telemetry.
//
// DIALECT-SPLIT at the CLI layer (Oracle Gate-2 note): the blob-size
// expression differs per dialect — see `blobSizeExpr()`. The PG panel uses
// `length(CAST(data AS text))`; the SQLite panel uses `length(data)`. The PG
// expression is NEVER used in SQLite mode.

export type SessionPanelRow = {
  session_id: string
  drain_owner: string | null
  projection_lag: number | null
  pending_queued: number | null
  pending_steer: number | null
  is_subagent: number
  zero_message: number
  blob_size_message: number | null
  blob_size_part: number | null
  blob_size_session_message: number | null
}

// PG panel — full dimensions (event_sequence.owner_id + session_projection_checkpoint
// exist in the PG schema). Transcribed from Athena PART 2 with AR4 dimensions
// folded in; the blob-size expression is the PG dialect per `blobSizeExpr()`.
export const PG_SESSIONS_PANEL_QUERY = `
  SELECT
    s.id AS session_id,
    es.owner_id AS drain_owner,
    es.seq - COALESCE(spc.applied_seq, -1) AS projection_lag,
    COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'queue') AS pending_queued,
    COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'steer') AS pending_steer,
    CASE WHEN s.parent_id IS NOT NULL THEN 1 ELSE 0 END AS is_subagent,
    CASE WHEN NOT EXISTS (SELECT 1 FROM message m WHERE m.session_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM session_message sm WHERE sm.session_id = s.id)
         THEN 1 ELSE 0 END AS zero_message,
    COALESCE((SELECT SUM(length(CAST(data AS text))) FROM message m WHERE m.session_id = s.id), 0) AS blob_size_message,
    COALESCE((SELECT SUM(length(CAST(data AS text))) FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = s.id), 0) AS blob_size_part,
    COALESCE((SELECT SUM(length(CAST(data AS text))) FROM session_message sm WHERE sm.session_id = s.id), 0) AS blob_size_session_message
  FROM session s
  LEFT JOIN event_sequence es ON es.aggregate_id = s.id
  LEFT JOIN session_projection_checkpoint spc ON spc.session_id = s.id
  LEFT JOIN session_input si ON si.session_id = s.id
  GROUP BY s.id, es.owner_id, es.seq, spc.applied_seq
  ORDER BY projection_lag DESC NULLS LAST
`

function pgSessionsPanel(client: SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* client.unsafe(PG_SESSIONS_PANEL_QUERY).withoutTransform
    printSessionsPanel(rows as SessionPanelRow[], { full: true })
  })
}

// SQLite panel — degraded. PG-only dimensions (drain owner via
// event_sequence.owner_id, projection lag via session_projection_checkpoint)
// are absent on SQLite because those tables/columns do not exist in the
// SQLite schema. The panel reports the dimensions that have SQLite
// representation: pending inputs, subagent flag, zero-message anomaly,
// blob-size telemetry (SQLite dialect: `length(data)`).
export const SQLITE_SESSIONS_PANEL_QUERY = `
  SELECT
    s.id AS session_id,
    NULL AS drain_owner,
    NULL AS projection_lag,
    COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'queue') AS pending_queued,
    COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'steer') AS pending_steer,
    CASE WHEN s.parent_id IS NOT NULL THEN 1 ELSE 0 END AS is_subagent,
    CASE WHEN NOT EXISTS (SELECT 1 FROM message m WHERE m.session_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM session_message sm WHERE sm.session_id = s.id)
         THEN 1 ELSE 0 END AS zero_message,
    COALESCE((SELECT SUM(length(data)) FROM message m WHERE m.session_id = s.id), 0) AS blob_size_message,
    COALESCE((SELECT SUM(length(data)) FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = s.id), 0) AS blob_size_part,
    COALESCE((SELECT SUM(length(data)) FROM session_message sm WHERE sm.session_id = s.id), 0) AS blob_size_session_message
  FROM session s
  LEFT JOIN session_input si ON si.session_id = s.id
  GROUP BY s.id
  ORDER BY s.id
`

function sqliteSessionsPanel() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db.all<SessionPanelRow>(sql.raw(SQLITE_SESSIONS_PANEL_QUERY))
    printSessionsPanel(rows, { full: false })
  })
}

export function printSessionsPanel(rows: SessionPanelRow[], opts: { full: boolean }) {
  if (rows.length === 0) {
    console.log("sessions: (none)")
    return
  }
  console.log(`sessions: ${rows.length}`)
  for (const row of rows) {
    console.log(`  ${row.session_id}`)
    if (opts.full) {
      console.log(`    drain_owner: ${row.drain_owner ?? "—"}`)
      console.log(`    projection_lag: ${row.projection_lag ?? "—"}`)
    } else {
      console.log(`    drain_owner: (sqlite: n/a)`)
      console.log(`    projection_lag: (sqlite: n/a)`)
    }
    console.log(`    pending_queued: ${row.pending_queued ?? 0}`)
    console.log(`    pending_steer: ${row.pending_steer ?? 0}`)
    console.log(`    is_subagent: ${row.is_subagent === 1 ? "yes" : "no"}`)
    console.log(`    zero_message: ${row.zero_message === 1 ? "ANOMALY" : "no"}`)
    console.log(`    blob_size: message=${row.blob_size_message ?? 0} part=${row.blob_size_part ?? 0} session_message=${row.blob_size_session_message ?? 0}`)
  }
}

// --- migrate ----------------------------------------------------------------

const MigrateCommand = effectCmd({
  command: "migrate",
  describe: "apply pending database migrations (SQLite runner or PG advisory-lock runner)",
  instance: false,
  handler: Effect.fn("Cli.db.migrate")(function* () {
    if (Database.isPg) {
      const { db } = yield* Database.Service
      const client = pgClient(db)
      yield* DatabaseMigrationPg.apply(client).pipe(
        Effect.mapError((err) => new Error(`PG migration failed: ${err}`)),
        Effect.orDie,
      )
      console.log("migrations applied (postgres)")
      return
    }
    const { db } = yield* Database.Service
    yield* DatabaseMigration.apply(db).pipe(Effect.orDie)
    console.log("migrations applied (sqlite)")
  }),
})

// --- query ------------------------------------------------------------------

const QueryCommand = effectCmd({
  command: "query <sql>",
  describe: "run a SQL query (read-only by default on PG; --write to escape)",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("sql", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
      .option("write", {
        type: "boolean",
        default: false,
        describe: "Allow write statements (PG: escapes read-only enforcement; SQLite: no-op flag)",
      }),
  handler: Effect.fn("Cli.db.query")(function* (args: { sql?: string; format: string; write: boolean }) {
    const sqlText = args.sql
    if (!sqlText) return yield* fail("query: <sql> is required")
    if (Database.isPg) {
      yield* pgQuery(sqlText, args.format, args.write).pipe(Effect.orDie)
    } else {
      yield* sqliteQuery(sqlText, args.format).pipe(Effect.orDie)
    }
  }),
})

// PG query: read-only by default via `SET default_transaction_read_only`.
// `--write` escapes it explicitly. The SET rides the same connection the
// query runs on (reserved via client.reserve so the GUC is scoped to this
// statement, not the pool).
function pgQuery(sqlText: string, format: string, write: boolean) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const client = pgClient(db)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const conn = yield* client.reserve
        if (!write) {
          yield* conn.executeRaw("SET default_transaction_read_only = on", [])
        } else {
          yield* conn.executeRaw("SET default_transaction_read_only = off", [])
        }
        const rows = yield* conn.executeRaw(sqlText, []).pipe(
          Effect.mapError((err) => new Error(`query failed: ${err}`)),
          Effect.orDie,
        )
        printRows(rows as Array<Record<string, unknown>>, format)
      }),
    )
  })
}

function sqliteQuery(sqlText: string, format: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db.all<Record<string, unknown>>(sql.raw(sqlText)).pipe(
      Effect.mapError((err) => new Error(`query failed: ${err}`)),
      Effect.orDie,
    )
    printRows(rows, format)
  })
}

export function printRows(rows: Array<Record<string, unknown>>, format: string) {
  if (format === "json") {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  if (rows.length === 0) return
  const keys = Object.keys(rows[0])
  console.log(keys.join("\t"))
  for (const row of rows) console.log(keys.map((key) => String(row[key] ?? "")).join("\t"))
}

// --- dump -------------------------------------------------------------------

const DumpCommand = effectCmd({
  command: "dump <file>",
  describe: "dump the database to a file (SQLite: sqlite3 .dump; PG: pg_dump -Fc)",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("file", {
      type: "string",
      describe: "output file path",
    }),
  handler: Effect.fn("Cli.db.dump")(function* (args: { file?: string }) {
    const file = args.file
    if (!file) return yield* fail("dump: <file> is required")
    if (Database.isPg) {
      yield* pgDump(file)
    } else {
      yield* sqliteDump(file)
    }
  }),
})

function pgDump(file: string) {
  return Effect.gen(function* () {
    // pg_dump -Fc — custom format archive (pg_restore-compatible).
    const code = yield* Effect.promise(() =>
      Process.spawn(["pg_dump", "-Fc", "-f", file, Database.databaseUrl!], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exited,
    )
    if (code !== 0) return yield* fail(`pg_dump exited with code ${code}`)
    console.log(`dumped to ${file} (postgres, custom format)`)
  })
}

function sqliteDump(file: string) {
  return Effect.gen(function* () {
    // Process.run always pipes stdout/stderr internally and returns buffers.
    const result = yield* Effect.promise(() =>
      Process.run(["sqlite3", Database.path(), ".dump"]),
    )
    if (result.code !== 0) return yield* fail(`sqlite3 .dump exited with code ${result.code}`)
    const { writeFile } = yield* Effect.promise(() => import("node:fs/promises"))
    yield* Effect.promise(() => writeFile(file, result.stdout))
    console.log(`dumped to ${file} (sqlite, text dump)`)
  })
}

// --- restore ----------------------------------------------------------------

const RestoreCommand = effectCmd({
  command: "restore <file>",
  describe: "restore the database from a file (SQLite: replay SQL; PG: pg_restore --clean --if-exists)",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "input file path (sqlite: SQL text; PG: pg_dump -Fc archive)",
      })
      .option("yes", {
        type: "boolean",
        default: false,
        describe: "skip the confirmation prompt (PG only)",
      }),
  handler: Effect.fn("Cli.db.restore")(function* (args: { file?: string; yes: boolean }) {
    const file = args.file
    if (!file) return yield* fail("restore: <file> is required")
    if (Database.isPg) {
      yield* pgRestore(file, args.yes)
    } else {
      yield* sqliteRestore(file)
    }
  }),
})

function pgRestore(file: string, yes: boolean) {
  return Effect.gen(function* () {
    if (!yes) {
      const confirmed = yield* confirm(
        `Restore will DROP and recreate objects in ${redactUrl(Database.databaseUrl!)}. Continue? [y/N] `,
      )
      if (!confirmed) return yield* fail("restore cancelled")
    }
    // pg_restore --clean --if-exists: drops existing objects before
    // recreating, tolerates missing objects. -d targets the database.
    // Exit code 1 is warnings (e.g. --clean dropping non-existent objects);
    // >1 is failure. Matches common pg_restore --clean ergonomics.
    const code = yield* Effect.promise(() =>
      Process.spawn(["pg_restore", "--clean", "--if-exists", "-d", Database.databaseUrl!, file], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exited,
    )
    if (code === 0) {
      console.log(`restored from ${file} (postgres)`)
    } else if (code === 1) {
      console.log(`restored from ${file} (postgres, with warnings)`)
    } else {
      return yield* fail(`pg_restore exited with code ${code}`)
    }
  })
}

function sqliteRestore(file: string) {
  return Effect.gen(function* () {
    // SQLite restore: replay the SQL text file through sqlite3 via stdin.
    const { createReadStream } = yield* Effect.promise(() => import("node:fs"))
    const child = Process.spawn(["sqlite3", Database.path()], {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    })
    const stream = createReadStream(file)
    stream.pipe(child.stdin!)
    const code = yield* Effect.promise(() => child.exited)
    if (code !== 0) return yield* fail(`sqlite3 restore exited with code ${code}`)
    console.log(`restored from ${file} (sqlite)`)
  })
}

// --- confirm ----------------------------------------------------------------

function confirm(prompt: string): Effect.Effect<boolean> {
  return Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        process.stdout.write(prompt)
        process.stdin.resume()
        process.stdin.setEncoding("utf8")
        process.stdin.once("data", (data) => {
          process.stdin.pause()
          const answer = data.toString().trim().toLowerCase()
          resolve(answer === "y" || answer === "yes")
        })
        process.stdin.once("error", () => {
          process.stdin.pause()
          resolve(false)
        })
      }),
  )
}

// --- root -------------------------------------------------------------------

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools (status, migrate, query, dump, restore)",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .command(StatusCommand)
      .command(MigrateCommand)
      .command(QueryCommand)
      .command(DumpCommand)
      .command(RestoreCommand)
      .demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
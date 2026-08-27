// PG migration runner — formalized Step 3 port of migration.ts.
//
// Shape ported per decision #7: information_schema probes, advisory lock
// instead of cross-process semaphore, ON CONFLICT DO NOTHING journal inserts.
// The SQLite runner (migration.ts) is the shape reference; this is the PG
// dialect equivalent.
//
// Boot behavior:
// 1. Probe information_schema.tables for the 'session' table.
// 2. If 'session' absent → fresh bootstrap: reserve a connection, acquire
//    pg_advisory_lock(727274), execute 0000_init.sql inside one transaction,
//    journal '0000_init', release the lock on scope close.
// 3. If 'session' present → replay pending numbered migrations only
//    (applyOnly-equivalent): create the journal table if missing, read
//    completed ids, apply each pending migration > 0000 in order inside its
//    own transaction under the advisory lock, journal each with
//    ON CONFLICT DO NOTHING.
//
// Journal shape (runner-owned, not in 0000_init — PART 2 line 1120,
// PART 3 line 1344): id text PRIMARY KEY, time_completed timestamptz NOT NULL.
// Matches the SQLite journal columns (migration.ts:30) per the signed DDL.
//
// Migration file loading: reads .opencode/db-migrations/*.sql at runtime via
// node:fs/promises. The 0000_init.sql file is the blessed executable form of Athena's
// signed DDL (.opencode/db-decision-memos.md PART 2, amended by Memo #6 B6)
// and MUST stay byte-identical — it is the single source of truth. Numbered
// migrations follow the pattern NNNN_name.sql (e.g. 0001_test_marker.sql),
// loaded in lexical order. Tradeoff: the deployed Docker image (Step 8) must
// include the .opencode/db-migrations/ directory; runtime-path read keeps
// 0000_init.sql as the unmodified source of truth without a build/embed step.

import { fileURLToPath } from "url"
import { resolve, dirname, join } from "path"
import { readFile, readdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { Effect, Exit } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"

const MIGRATION_LOCK_KEY = 727274
const BOOTSTRAP_ID = "0000_init"

// Resolve the migrations directory relative to the repo root.
// The files live at .opencode/db-migrations/.
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, "../../../../.opencode/db-migrations")
  try {
    const st = statSync(dir)
    if (!st.isDirectory()) throw new Error("not a directory")
  } catch {
    const isRuntimeImage = dir === "/.opencode/db-migrations"
    const remedy = isRuntimeImage
      ? "The image is missing the runtime COPY of /.opencode/db-migrations — rebuild the image (Dockerfile runtime stage)."
      : "Run from the repo root."
    throw new Error(`Migrations directory missing: expected ${dir}. ${remedy}`)
  }
  return dir
}

function migrationPath(id: string): string {
  return join(migrationsDir(), `${id}.sql`)
}

// A numbered PG migration: id matches the filename stem (NNNN_name), sql is
// the file content read at runtime.
type PgMigration = {
  id: string
  sql: string
}

// Read all numbered migration files (> 0000) from the migrations directory,
// sorted lexically by filename. 0000_init.sql is handled separately by the
// bootstrap path; this returns only NNNN_*.sql files where NNNN > 0000.
//
// Cond 7 (Memo #9): uses node:fs/promises readFile instead of Bun.file so
// the #pg node map path works in both runtimes (Bun.file is Bun-only).
async function loadNumberedMigrations(): Promise<PgMigration[]> {
  const dir = migrationsDir()
  const entries = await readdir(dir)
  const numbered = entries
    .filter((name) => /^[0-9]{4}_.*\.sql$/.test(name) && !name.startsWith("0000"))
    .sort()
  const migrations: PgMigration[] = []
  for (const name of numbered) {
    const id = name.replace(/\.sql$/, "")
    const sql = await readFile(join(dir, name), "utf-8")
    migrations.push({ id, sql })
  }
  return migrations
}

// Acquire the advisory lock via a reserved connection, hold until scope close.
// The lock is taken via client.reserve (never pooled checkout) and released
// in a finalizer — Athena's hot-path invariant (Memo #5). SqlError from the
// lock/unlock/reserve is orDie'd into a defect; body errors propagate as-is.
function withAdvisoryLock<A, E, R>(
  client: SqlClient,
  body: (conn: Connection) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* Effect.orDie(client.reserve)
      yield* Effect.orDie(conn.executeRaw(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`, []))
      yield* Effect.addFinalizer(() =>
        Effect.orDie(conn.executeRaw(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`, [])),
      )
      return yield* body(conn)
    }),
  )
}

// Execute a SQL script inside a single transaction on a reserved connection.
// The script must not contain BEGIN/COMMIT (runner contract — 0000_init.sql
// header). On error, ROLLBACK and re-fail with context.
//
// Cond 1 (Memo #10): ROLLBACK must be executed via yield*; Effect.try
// wraps the returned Effect as a value without running it, so the rollback
// never fired and poisoned the pooled connection (FM-22).
function executeScriptTx(
  conn: Connection,
  sqlText: string,
  label: string,
  journalId?: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* conn.executeRaw("BEGIN", [])
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* conn.executeRaw(sqlText, [])
        if (journalId !== undefined) {
          yield* conn.executeRaw(
            `INSERT INTO "migration" (id, time_completed) VALUES ($1, now()) ON CONFLICT DO NOTHING`,
            [journalId],
          )
        }
        yield* conn.executeRaw("COMMIT", [])
      }),
    )
    if (Exit.isSuccess(exit)) return
    yield* Effect.ignore(conn.executeRaw("ROLLBACK", []))
    yield* Effect.fail(new Error(`${label} failed: ${exit.cause}`))
  })
}

// Create the journal table if it does not exist. Idempotent.
function ensureJournalTable(conn: Connection): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* conn.executeRaw(
      `CREATE TABLE IF NOT EXISTS "migration" (id text PRIMARY KEY, time_completed timestamptz NOT NULL)`,
      [],
    )
  })
}

// Read completed migration ids from the journal.
function readJournal(conn: Connection): Effect.Effect<string[], Error> {
  return Effect.gen(function* () {
    const result = yield* conn.executeRaw(`SELECT id FROM "migration"`, [])
    const rows = (result as Array<{ id: string }>) ?? []
    return rows.map((row) => row.id)
  })
}

// Probe information_schema.tables for the 'session' table in current_schema().
function probeSessionTable(client: SqlClient): Effect.Effect<boolean, Error> {
  return Effect.gen(function* () {
    const rows = yield* client.unsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'session'",
    ).withoutTransform
    return rows.length > 0
  })
}

// Fresh bootstrap: apply 0000_init.sql under advisory lock, journal it.
// Single transaction per apply (Memo #5, runner contract).
function bootstrap(client: SqlClient): Effect.Effect<void, Error> {
  return withAdvisoryLock(client, (conn) =>
    Effect.gen(function* () {
      // Cond 7 (Memo #9): node:fs/promises readFile works in both Bun and
      // Node (Bun.file is Bun-only and breaks the #pg node map path).
      const initSql = yield* Effect.tryPromise({
        try: () => readFile(migrationPath(BOOTSTRAP_ID), "utf-8"),
        catch: (cause) => new Error(`Failed to read 0000_init.sql: ${cause}`),
      })
      yield* ensureJournalTable(conn)
      yield* executeScriptTx(conn, initSql, "0000_init.sql", BOOTSTRAP_ID)
    }),
  )
}

// Incremental replay: apply pending numbered migrations under advisory lock.
// Each migration runs in its own transaction; journal insert uses
// ON CONFLICT DO NOTHING (applyOnly-equivalent).
function applyOnly(client: SqlClient, migrations: PgMigration[]): Effect.Effect<void, Error> {
  return withAdvisoryLock(client, (conn) =>
    Effect.gen(function* () {
      yield* ensureJournalTable(conn)
      const completed = new Set(yield* readJournal(conn))
      for (const migration of migrations) {
        if (completed.has(migration.id)) continue
        yield* executeScriptTx(conn, migration.sql, `${migration.id}.sql`, migration.id)
      }
    }),
  )
}

// Main entry: probe → bootstrap or replay. Called by database.ts on PG boot.
export function apply(client: SqlClient): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const sessionExists = yield* probeSessionTable(client)
    if (sessionExists) {
      const migrations = yield* Effect.tryPromise({
        try: () => loadNumberedMigrations(),
        catch: (cause) => new Error(`Failed to load numbered migrations: ${cause}`),
      })
      if (migrations.length > 0) yield* applyOnly(client, migrations)
      return
    }
    yield* bootstrap(client)
  })
}
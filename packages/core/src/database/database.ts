export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import { layer as sqliteLayer } from "#sqlite"
import { layer as pgLayer } from "#pg"
import * as Client from "effect/unstable/sql/SqlClient"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import * as DatabaseMigrationPg from "./migration.pg"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"
import * as Schema from "./schema.pg"
import * as SchemaSqliteNamespace from "../schema-sqlite-namespace"
import * as SchemaPgNamespace from "../schema-pg-namespace"

const makeSqliteDatabase = EffectDrizzleSqlite.makeWithDefaults()
const makePgDatabase = EffectDrizzlePg.makeWithDefaults()

// DatabaseShape is the SQLite Drizzle client type. The PG client is
// structurally equivalent at the query-builder level (select/insert/update/
// delete/run/all/get/transaction) but is a different TypeScript type. The
// PG path casts to DatabaseShape at the boundary so consumers see one
// interface regardless of backend (plan decision #8: "consumers must not
// know which backend is active"). The cast is `as unknown as` — not
// `as any` — and is safe because the query builder API is identical across
// Drizzle dialects; only the column/table base classes differ, and those
// are erased at the SqlClient boundary the bridge consumes.
type DatabaseShape = Effect.Success<typeof makeSqliteDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

// DATABASE_URL set → PG backend (decision #8); unset → SQLite untouched.
// normalize empty-string env to undefined so isPg (!== undefined) and layer dispatch (truthiness) can never disagree
export const databaseUrl = process.env.DATABASE_URL || undefined

// Dialect fork primitive (Memo #11 Cond 1 precedent — single-source the
// dialect decision via `databaseUrl`, never re-read env). Consumers branch
// on `isPg` instead of re-checking `process.env.DATABASE_URL` so the
// dialect decision has exactly one source. Under SQLite (isPg false) the
// PG-only code paths (FOR UPDATE, SKIP LOCKED, NOTIFY wake bus) no-op and
// the SQLite behavior stays byte-identical (AGENTS.md V2 invariant).
export const isPg = databaseUrl !== undefined

const sqliteLayerInit = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeSqliteDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

const pgLayerInit = Layer.effect(
  Service,
  Effect.gen(function* () {
    const pgDb = yield* makePgDatabase

    // Cond 2 (Memo #9 §8.4): statement_timeout / idle_in_transaction_session_timeout
    // are now applied per reserved connection in pg.bun.ts (makeReservedConnection),
    // not as one-shot SETs on the shared pooled client here. The previous one-shot
    // SETs only landed on one arbitrary pooled connection — the rest of the pool
    // ran untimed. Reserved connections (transactions, client.reserve, migration
    // seam) now carry the timeouts; simple pooled statements are short by
    // construction.

    // Migration seam: apply 0000_init.sql under advisory lock if the
    // database is empty. Step 3 formalizes the full migration runner.
    yield* DatabaseMigrationPg.apply(yield* Client.SqlClient)

    return { db: pgDb as unknown as DatabaseShape }
  }).pipe(Effect.orDie),
)

// Cond 3 (Memo #9): Schema namespace — provides dialect-appropriate table
// objects so consumers can yield Database.Schema instead of importing
// static table objects. The PG branch provides the PG namespace
// (schema-pg-namespace.ts, sourced from *.sql.pg.ts siblings); the SQLite
// branch provides the SQLite namespace (unchanged). No consumer adopts
// Database.Schema yet — that is Step 4.
const sqliteSchemaLayer = Layer.succeed(Schema.Schema, SchemaSqliteNamespace.namespace)
const pgSchemaLayer = Layer.succeed(Schema.Schema, SchemaPgNamespace.namespace)

const resolvedLayer = (databaseUrl
  ? pgLayerInit.pipe(
      Layer.provide(pgLayer({ url: databaseUrl })),
      Layer.provide(pgSchemaLayer),
    )
  : sqliteLayerInit.pipe(
      Layer.provide(sqliteLayer({ filename: path() })),
      Layer.provide(sqliteSchemaLayer),
    )) as unknown as Layer.Layer<Service, never, never>

export function layerFromPath(filename: string): Layer.Layer<Service, never, never> {
  if (databaseUrl) return resolvedLayer
  return sqliteLayerInit.pipe(
    Layer.provide(sqliteLayer({ filename })),
    Layer.provide(sqliteSchemaLayer),
  ) as unknown as Layer.Layer<Service, never, never>
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
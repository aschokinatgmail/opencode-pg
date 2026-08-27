/* oxlint-disable */
import * as Effect from "effect/Effect"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { EffectDrizzleError } from "drizzle-orm/effect-core/errors"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import type { MigrationMeta } from "drizzle-orm/migrator"
import { sql } from "drizzle-orm/sql/sql"
import type { PgEffectSession } from "../pg-core/effect/session"
import {
  buildPgMigrationBackfillStatements,
  preparePgMigrationBackfill,
  type PgMigrationTableRow,
  pgTableColumnsProbe,
  pgTableExistsProbe,
} from "./pg"
import { GET_VERSION_FOR, MIGRATIONS_TABLE_VERSIONS, type UpgradeResult } from "./utils"

const migrationUpgradeError = (cause: unknown) =>
  new EffectDrizzleError({
    message:
      typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string"
        ? cause.message
        : String(cause),
    cause,
  })

export const upgradeIfNeeded: <TEffectHKT extends QueryEffectHKTBase>(
  migrationsTable: string,
  session: PgEffectSession<TEffectHKT>,
  localMigrations: MigrationMeta[],
) => Effect.Effect<UpgradeResult, EffectDrizzleError | TEffectHKT["error"] | SqlError, TEffectHKT["context"]> =
  Effect.fn("upgradeIfNeeded")(function* <TEffectHKT extends QueryEffectHKTBase>(
    migrationsTable: string,
    session: PgEffectSession<TEffectHKT>,
    localMigrations: MigrationMeta[],
  ) {
    const tableExists = yield* session.all(pgTableExistsProbe(migrationsTable))

    if (tableExists.length === 0) {
      return { newDb: true }
    }

    const rows = yield* session.all<{ column_name: string }>(pgTableColumnsProbe(migrationsTable))

    const version = GET_VERSION_FOR.pg(rows.map((r) => r.column_name))

    for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.pg; v++) {
      const upgradeFn = upgradeFunctions[v]
      if (!upgradeFn) {
        return yield* new EffectDrizzleError({
          message: `No upgrade path from migration table version ${v} to ${v + 1}`,
          cause: { version: v },
        })
      }
      yield* upgradeFn(migrationsTable, session, localMigrations)
    }

    return { newDb: false }
  })

const upgradeFunctions: Record<
  number,
  <TEffectHKT extends QueryEffectHKTBase>(
    migrationsTable: string,
    session: PgEffectSession<TEffectHKT>,
    localMigrations: MigrationMeta[],
  ) => Effect.Effect<void, EffectDrizzleError | TEffectHKT["error"] | SqlError, TEffectHKT["context"]>
> = {
  0: upgradeFromV0,
}

function upgradeFromV0<TEffectHKT extends QueryEffectHKTBase>(
  migrationsTable: string,
  session: PgEffectSession<TEffectHKT>,
  localMigrations: MigrationMeta[],
): Effect.Effect<void, EffectDrizzleError | TEffectHKT["error"] | SqlError, TEffectHKT["context"]> {
  return Effect.gen(function* () {
    const table = sql`${sql.identifier(migrationsTable)}`

    const dbRows = yield* session.all<PgMigrationTableRow>(
      sql`SELECT id, hash, created_at FROM ${table} ORDER BY id ASC`,
    )
    const statements = yield* Effect.try({
      try: () =>
        buildPgMigrationBackfillStatements(
          migrationsTable,
          preparePgMigrationBackfill(dbRows, localMigrations),
        ),
      catch: migrationUpgradeError,
    })

    yield* session.transaction((tx) =>
      Effect.gen(function* () {
        for (const statement of statements) {
          yield* tx.run(statement)
        }
      }),
    )
  })
}
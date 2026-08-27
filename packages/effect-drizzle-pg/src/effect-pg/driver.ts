/* oxlint-disable */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectCache } from "drizzle-orm/cache/core/cache-effect"
import { EffectLogger } from "drizzle-orm/effect-core"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { PgDialect } from "drizzle-orm/pg-core/dialect"
import { PgEffectDatabase } from "../pg-core/effect/db"
import type { DrizzleConfig } from "drizzle-orm/utils"
import { jitCompatCheck } from "../internal/drizzle-utils"
import { type EffectPgQueryEffectHKT, type EffectPgRunResult, EffectPgSession } from "./session"

export class EffectPgDatabase<TRelations extends AnyRelations = EmptyRelations> extends PgEffectDatabase<
  EffectPgQueryEffectHKT,
  EffectPgRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectPgDatabase"
}

export type EffectDrizzlePgConfig<TRelations extends AnyRelations = EmptyRelations> = Omit<
  DrizzleConfig<Record<string, never>, TRelations>,
  "cache" | "logger" | "schema"
>

export const DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)

/**
 * Creates an EffectPgDatabase instance.
 *
 * Requires a generic Effect `SqlClient`, `EffectLogger`, and `EffectCache` services to be provided.
 * Drizzle only depends on the generic `SqlClient`; install and provide a compatible PostgreSQL provider such as
 * `@effect/sql-pg`, or another package that exposes `SqlClient`.
 *
 * @example
 * ```ts
 * import { PgClient } from '@effect/sql-pg';
 * import * as PgDrizzle from 'drizzle-orm/effect-pg';
 * import * as Effect from 'effect/Effect';
 *
 * const db = yield* PgDrizzle.make({ relations }).pipe(
 *   Effect.provide(PgDrizzle.DefaultServices),
 *   Effect.provide(PgClient.layer({ url: 'postgres://localhost/opencode' })),
 * );
 * ```
 */
export const make = Effect.fn("PgDrizzle.make")(function* <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzlePgConfig<TRelations> = {},
) {
  const client = yield* SqlClient
  const cache = yield* EffectCache
  const logger = yield* EffectLogger

  const dialect = new PgDialect()
  const relations = config.relations ?? ({} as TRelations)
  const session = new EffectPgSession(client, dialect, relations, {
    logger,
    cache,
    useJitMappers: jitCompatCheck(config.jit),
  })
  const db = new EffectPgDatabase(dialect, session, relations) as EffectPgDatabase<TRelations> & {
    $client: SqlClient
  }
  db.$client = client
  db.$cache.invalidate = cache.onMutate

  return db
})

/**
 * Convenience function that creates an EffectPgDatabase with `DefaultServices` already provided.
 */
export const makeWithDefaults = <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzlePgConfig<TRelations> = {},
) => make(config).pipe(Effect.provide(DefaultServices))
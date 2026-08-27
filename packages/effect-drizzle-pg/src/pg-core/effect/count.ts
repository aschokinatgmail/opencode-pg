/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import { SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgTable } from "drizzle-orm/pg-core/table"
import type { PgViewBase } from "drizzle-orm/pg-core/view-base"
import type { PgEffectSession } from "./session"

function buildPgEmbeddedCount(source: PgTable | PgViewBase | SQL | SQLWrapper, filters?: SQL<unknown>) {
  return sql<number>`(select count(*) from ${source}${sql.raw(" where ").if(filters)}${filters})`
}

function buildPgCount(source: PgTable | PgViewBase | SQL | SQLWrapper, filters?: SQL<unknown>) {
  return sql<number>`select count(*) from ${source}${sql.raw(" where ").if(filters)}${filters}`
}

export interface PgEffectCountBuilder<TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends SQL<number>,
    SQLWrapper<number>,
    Effect.Effect<number, TEffectHKT["error"], TEffectHKT["context"]> {}

export class PgEffectCountBuilder<TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase> extends SQL<number> {
  static override readonly [entityKind]: string = "PgEffectCountBuilder"

  private sql: SQL<number>
  private session: PgEffectSession<TEffectHKT, any, any>

  constructor(params: {
    source: PgTable | PgViewBase | SQL | SQLWrapper
    filters?: SQL<unknown>
    session: PgEffectSession<TEffectHKT, any, any>
  }) {
    super(buildPgEmbeddedCount(params.source, params.filters).queryChunks)

    this.session = params.session
    this.sql = buildPgCount(params.source, params.filters)
  }

  execute(placeholderValues?: Record<string, unknown>) {
    return this.session
      .prepareQuery<{
        type: "async"
        execute: number
        run: unknown
        all: unknown
        get: unknown
        values: unknown
      }>(this.session.dialect.sqlToQuery(this.sql), undefined, "all", (rows) => {
        const v = rows[0]?.[0]
        if (typeof v === "number") return v
        return v ? Number(v) : 0
      })
      .execute(placeholderValues)
  }
}

applyEffectWrapper(PgEffectCountBuilder)
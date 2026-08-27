/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import type { PreparedQuery } from "drizzle-orm/session"
import type { Query, SQL, SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"

type PgEffectRawAction = "all" | "get" | "values" | "run"

export interface PgEffectRaw<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    RunnableQuery<TResult, "pg">,
    SQLWrapper {}

export class PgEffectRaw<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  implements RunnableQuery<TResult, "pg">, SQLWrapper, PreparedQuery
{
  static readonly [entityKind]: string = "PgEffectRaw"

  declare readonly _: {
    readonly dialect: "pg"
    readonly result: TResult
  }

  constructor(
    public execute: () => Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    /** @internal */
    public getSQL: () => SQL,
    private action: PgEffectRawAction,
    private dialect: PgDialect,
    private mapBatchResult: (result: unknown) => unknown,
  ) {}

  getQuery(): Query & { method: PgEffectRawAction } {
    return { ...this.dialect.sqlToQuery(this.getSQL()), method: this.action }
  }

  mapResult(result: unknown, isFromBatch?: boolean) {
    return isFromBatch ? this.mapBatchResult(result) : result
  }

  _prepare(): PreparedQuery {
    return this
  }
}

applyEffectWrapper(PgEffectRaw)
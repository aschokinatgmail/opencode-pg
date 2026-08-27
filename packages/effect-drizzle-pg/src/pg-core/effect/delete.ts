/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import { SelectionProxyHandler } from "drizzle-orm/selection-proxy"
import type { Placeholder, Query, SQL, SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import type { PgDeleteConfig } from "drizzle-orm/pg-core/query-builders/delete"
import type { SelectedFieldsFlat } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session"
import { PgTable } from "drizzle-orm/pg-core/table"
import { extractUsedTable } from "drizzle-orm/pg-core/utils"
import type { Subquery } from "drizzle-orm/subquery"
import { type DrizzleTypeError, type ValueOrArray } from "drizzle-orm/utils"
import type { PgColumn } from "drizzle-orm/pg-core/columns/common"
import { getTableColumnsRuntime, orderSelectedFields, pgCodecs } from "../../internal/drizzle-utils"
import type { PgEffectPreparedQuery, PgEffectSession } from "./session"

export type PgEffectDeleteWithout<
  T extends AnyPgEffectDelete,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true
  ? T
  : Omit<
      PgEffectDeleteBase<
        T["_"]["table"],
        T["_"]["runResult"],
        T["_"]["returning"],
        TDynamic,
        T["_"]["excludedMethods"] | K,
        T["_"]["effectHKT"]
      >,
      T["_"]["excludedMethods"] | K
    >

export type PgEffectDeleteReturningAll<
  T extends AnyPgEffectDelete,
  TDynamic extends boolean,
> = PgEffectDeleteWithout<
  PgEffectDeleteBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["table"]["$inferSelect"],
    T["_"]["dynamic"],
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectDeleteReturning<
  T extends AnyPgEffectDelete,
  TDynamic extends boolean,
  TSelectedFields extends SelectedFieldsFlat,
> = PgEffectDeleteWithout<
  PgEffectDeleteBase<
    T["_"]["table"],
    T["_"]["runResult"],
    SelectResultFields<TSelectedFields>,
    T["_"]["dynamic"],
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectDeleteExecute<T extends AnyPgEffectDelete> = T["_"]["returning"] extends undefined
  ? T["_"]["runResult"]
  : T["_"]["returning"][]

export type PgEffectDeletePrepare<
  T extends AnyPgEffectDelete,
  TEffectHKT extends QueryEffectHKTBase = T["_"]["effectHKT"],
> = PgEffectPreparedQuery<
  PreparedQueryConfig & {
    run: T["_"]["runResult"]
    all: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".all() cannot be used without .returning()">
      : T["_"]["returning"][]
    get: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".get() cannot be used without .returning()">
      : T["_"]["returning"] | undefined
    values: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".values() cannot be used without .returning()">
      : any[][]
    execute: PgEffectDeleteExecute<T>
  },
  TEffectHKT
>

export type PgEffectDeleteDynamic<T extends AnyPgEffectDelete> = PgEffectDelete<
  T["_"]["table"],
  T["_"]["runResult"],
  T["_"]["returning"],
  T["_"]["effectHKT"]
>

export type PgEffectDelete<
  TTable extends PgTable = PgTable,
  TRunResult = unknown,
  TReturning extends Record<string, unknown> | undefined = undefined,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = PgEffectDeleteBase<TTable, TRunResult, TReturning, true, never, TEffectHKT>

export type AnyPgEffectDelete = PgEffectDeleteBase<any, any, any, any, any, any>

export interface PgEffectDeleteBase<
  TTable extends PgTable,
  TRunResult,
  TReturning extends Record<string, unknown> | undefined = undefined,
  TDynamic extends boolean = false,
  _TExcludedMethods extends string = never,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> extends RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "pg">,
    SQLWrapper,
    Effect.Effect<
      TReturning extends undefined ? TRunResult : TReturning[],
      TEffectHKT["error"],
      TEffectHKT["context"]
    > {
  readonly _: {
    dialect: "pg"
    readonly table: TTable
    readonly resultType: "async"
    readonly runResult: TRunResult
    readonly returning: TReturning
    readonly dynamic: TDynamic
    readonly excludedMethods: _TExcludedMethods
    readonly result: TReturning extends undefined ? TRunResult : TReturning[]
    readonly effectHKT: TEffectHKT
  }
}

export class PgEffectDeleteBase<
    TTable extends PgTable,
    TRunResult,
    TReturning extends Record<string, unknown> | undefined = undefined,
    TDynamic extends boolean = false,
    _TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  implements RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "pg">, SQLWrapper
{
  static readonly [entityKind]: string = "PgEffectDelete"

  /** @internal */
  config: PgDeleteConfig

  constructor(
    private table: TTable,
    private effectSession: PgEffectSession<TEffectHKT, TRunResult, any>,
    private effectDialect: PgDialect,
    withList?: Subquery[],
  ) {
    this.config = { table, withList }
  }

  where(where: SQL | undefined): PgEffectDeleteWithout<this, TDynamic, "where"> {
    this.config.where = where
    return this as any
  }

  returning(): PgEffectDeleteReturningAll<this, TDynamic>
  returning<TSelectedFields extends SelectedFieldsFlat>(
    fields: TSelectedFields,
  ): PgEffectDeleteReturning<this, TDynamic, TSelectedFields>
  returning(
    fields: SelectedFieldsFlat = getTableColumnsRuntime(this.table) as unknown as SelectedFieldsFlat,
  ): PgEffectDeleteReturning<this, TDynamic, any> | PgEffectDeleteReturningAll<this, TDynamic> {
    this.config.returning = orderSelectedFields<PgColumn>(fields, undefined, pgCodecs)
    return this as any
  }

  /** @internal */
  getSQL(): SQL {
    return this.effectDialect.buildDeleteQuery(this.config)
  }

  toSQL(): Query {
    return this.effectDialect.sqlToQuery(this.getSQL())
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): PgEffectDeletePrepare<this, TEffectHKT> {
    return this.effectSession[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.effectDialect.sqlToQuery(this.getSQL()),
      this.config.returning,
      this.config.returning ? "all" : "run",
      undefined,
      {
        type: "delete",
        tables: extractUsedTable(this.config.table),
      },
    ) as PgEffectDeletePrepare<this, TEffectHKT>
  }

  prepare(): PgEffectDeletePrepare<this, TEffectHKT> {
    return this._prepare(false)
  }

  run: ReturnType<this["prepare"]>["run"] = (placeholderValues) => {
    return this._prepare().run(placeholderValues)
  }

  all: ReturnType<this["prepare"]>["all"] = (placeholderValues) => {
    return this._prepare().all(placeholderValues)
  }

  get: ReturnType<this["prepare"]>["get"] = (placeholderValues) => {
    return this._prepare().get(placeholderValues)
  }

  values: ReturnType<this["prepare"]>["values"] = (placeholderValues) => {
    return this._prepare().values(placeholderValues)
  }

  execute: ReturnType<this["prepare"]>["execute"] = (placeholderValues) => {
    return this._prepare().execute(placeholderValues)
  }

  $dynamic(): PgEffectDeleteDynamic<this> {
    return this as any
  }
}

applyEffectWrapper(PgEffectDeleteBase)
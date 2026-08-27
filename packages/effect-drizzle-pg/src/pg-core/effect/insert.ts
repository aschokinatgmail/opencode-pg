/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind, is } from "drizzle-orm/entity"
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import type { Query, SQLWrapper } from "drizzle-orm/sql/sql"
import { Param, SQL, sql } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import type { IndexColumn } from "drizzle-orm/pg-core/indexes"
import type {
  PgInsertConfig,
  PgInsertSelectQueryBuilder,
  PgInsertValue,
} from "drizzle-orm/pg-core/query-builders/insert"
import type { SelectedFieldsFlat } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session"
import { PgTable } from "drizzle-orm/pg-core/table"
import { extractUsedTable } from "drizzle-orm/pg-core/utils"
import type { Subquery } from "drizzle-orm/subquery"
import { type DrizzleTypeError, haveSameKeys } from "drizzle-orm/utils"
import type { PgColumn } from "drizzle-orm/pg-core/columns/common"
import { QueryBuilder } from "drizzle-orm/pg-core/query-builders/query-builder"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core/query-builders/update"
import { getTableColumnsRuntime, mapUpdateSet, orderSelectedFields, pgCodecs } from "../../internal/drizzle-utils"
import type { PgEffectPreparedQuery, PgEffectSession } from "./session"

export type PgEffectInsertWithout<
  T extends AnyPgEffectInsert,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true
  ? T
  : Omit<
      PgEffectInsertBase<
        T["_"]["table"],
        T["_"]["runResult"],
        T["_"]["returning"],
        TDynamic,
        T["_"]["excludedMethods"] | K,
        T["_"]["effectHKT"]
      >,
      T["_"]["excludedMethods"] | K
    >

export type PgEffectInsertReturning<
  T extends AnyPgEffectInsert,
  TDynamic extends boolean,
  TSelectedFields extends SelectedFieldsFlat,
> = PgEffectInsertWithout<
  PgEffectInsertBase<
    T["_"]["table"],
    T["_"]["runResult"],
    SelectResultFields<TSelectedFields>,
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectInsertReturningAll<
  T extends AnyPgEffectInsert,
  TDynamic extends boolean,
> = PgEffectInsertWithout<
  PgEffectInsertBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["table"]["$inferSelect"],
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectInsertDynamic<T extends AnyPgEffectInsert> = PgEffectInsert<
  T["_"]["table"],
  T["_"]["runResult"],
  T["_"]["returning"],
  T["_"]["effectHKT"]
>

export type PgEffectInsertOnConflictDoUpdateConfig<T extends AnyPgEffectInsert> = {
  target: IndexColumn | IndexColumn[]
  /** @deprecated - use either `targetWhere` or `setWhere` */
  where?: SQL
  targetWhere?: SQL
  setWhere?: SQL
  set: PgUpdateSetSource<T["_"]["table"]>
}

export type PgEffectInsertExecute<T extends AnyPgEffectInsert> = T["_"]["returning"] extends undefined
  ? T["_"]["runResult"]
  : T["_"]["returning"][]

export type PgEffectInsertPrepare<
  T extends AnyPgEffectInsert,
  TEffectHKT extends QueryEffectHKTBase = T["_"]["effectHKT"],
> = PgEffectPreparedQuery<
  PreparedQueryConfig & {
    run: T["_"]["runResult"]
    all: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".all() cannot be used without .returning()">
      : T["_"]["returning"][]
    get: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".get() cannot be used without .returning()">
      : T["_"]["returning"]
    values: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".values() cannot be used without .returning()">
      : any[][]
    execute: PgEffectInsertExecute<T>
  },
  TEffectHKT
>

export type PgEffectInsert<
  TTable extends PgTable = PgTable,
  TRunResult = unknown,
  TReturning = any,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = PgEffectInsertBase<TTable, TRunResult, TReturning, true, never, TEffectHKT>

export type AnyPgEffectInsert = PgEffectInsertBase<any, any, any, any, any, any>

export class PgEffectInsertBuilder<
  TTable extends PgTable,
  TRunResult,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "PgEffectInsertBuilder"

  constructor(
    protected table: TTable,
    protected session: PgEffectSession<TEffectHKT, TRunResult, any>,
    protected dialect: PgDialect,
    private withList?: Subquery[],
  ) {}

  values(
    value: PgInsertValue<TTable>,
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  values(
    values: PgInsertValue<TTable>[],
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  values(
    values: PgInsertValue<TTable> | PgInsertValue<TTable>[],
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    values = Array.isArray(values) ? values : [values]
    if (values.length === 0) {
      throw new Error("values() must be called with at least one value")
    }
    const mappedValues = values.map((entry) => {
      const result: Record<string, Param | SQL> = {}
      const cols = getTableColumnsRuntime(this.table)
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey as keyof typeof entry]
        result[colKey] = is(colValue, SQL) ? colValue : new Param(colValue, cols[colKey])
      }
      return result
    })

    return new PgEffectInsertBase(this.table, mappedValues, this.session, this.dialect, this.withList)
  }

  select(
    selectQuery: (qb: QueryBuilder) => PgInsertSelectQueryBuilder<TTable>,
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery: (qb: QueryBuilder) => SQL,
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(selectQuery: SQL): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery: PgInsertSelectQueryBuilder<TTable>,
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery:
      | SQL
      | PgInsertSelectQueryBuilder<TTable>
      | ((qb: QueryBuilder) => PgInsertSelectQueryBuilder<TTable> | SQL),
  ): PgEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery

    if (!is(select, SQL) && !haveSameKeys(getTableColumnsRuntime(this.table), select._.selectedFields)) {
      throw new Error(
        "Insert select error: selected fields are not the same or are in a different order compared to the table definition",
      )
    }

    return new PgEffectInsertBase(this.table, select, this.session, this.dialect, this.withList, true)
  }
}

export interface PgEffectInsertBase<
  TTable extends PgTable,
  TRunResult,
  TReturning = undefined,
  TDynamic extends boolean = false,
  _TExcludedMethods extends string = never,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> extends SQLWrapper,
    RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "pg">,
    Effect.Effect<
      TReturning extends undefined ? TRunResult : TReturning[],
      TEffectHKT["error"],
      TEffectHKT["context"]
    > {
  readonly _: {
    readonly dialect: "pg"
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

export class PgEffectInsertBase<
    TTable extends PgTable,
    TRunResult,
    TReturning = undefined,
    TDynamic extends boolean = false,
    _TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  implements RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "pg">, SQLWrapper
{
  static readonly [entityKind]: string = "PgEffectInsert"

  /** @internal */
  config: PgInsertConfig<TTable>

  constructor(
    private table: TTable,
    values: PgInsertConfig["values"],
    private effectSession: PgEffectSession<TEffectHKT, TRunResult, any>,
    private effectDialect: PgDialect,
    withList?: Subquery[],
    select?: boolean,
  ) {
    this.config = { table, values: values as any, withList, select }
  }

  returning(): PgEffectInsertReturningAll<this, TDynamic>
  returning<TSelectedFields extends SelectedFieldsFlat>(
    fields: TSelectedFields,
  ): PgEffectInsertReturning<this, TDynamic, TSelectedFields>
  returning(
    fields: SelectedFieldsFlat = getTableColumnsRuntime(this.config.table) as unknown as SelectedFieldsFlat,
  ): PgEffectInsertWithout<AnyPgEffectInsert, TDynamic, "returning"> {
    this.config.returning = orderSelectedFields<PgColumn>(fields, undefined, pgCodecs)
    return this as any
  }

  onConflictDoNothing(config: { target?: IndexColumn | IndexColumn[]; where?: SQL } = {}): this {
    if (config.target === undefined) {
      this.config.onConflict = sql`do nothing`
    } else {
      const targetColumn = Array.isArray(config.target)
        ? config.target.map((it) => this.effectDialect.escapeName(it.name)).join(",")
        : this.effectDialect.escapeName(config.target.name)
      const whereSql = config.where ? sql` where ${config.where}` : undefined
      this.config.onConflict = sql`(${sql.raw(targetColumn)})${whereSql} do nothing`
    }
    return this
  }

  onConflictDoUpdate(config: PgEffectInsertOnConflictDoUpdateConfig<this>): this {
    if (config.where && (config.targetWhere || config.setWhere)) {
      throw new Error(
        'You cannot use both "where" and "targetWhere"/"setWhere" at the same time - "where" is deprecated, use "targetWhere" or "setWhere" instead.',
      )
    }

    const whereSql = config.where ? sql` where ${config.where}` : undefined
    const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : undefined
    const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : undefined
    const targetColumn = Array.isArray(config.target)
      ? config.target.map((it) => this.effectDialect.escapeName(it.name)).join(",")
      : this.effectDialect.escapeName(config.target.name)
    const setSql = this.effectDialect.buildUpdateSet(
      this.config.table,
      mapUpdateSet(this.config.table, config.set as PgUpdateSetSource<TTable>),
    )
    this.config.onConflict = sql`(${sql.raw(targetColumn)})${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`
    return this
  }

  /** @internal */
  getSQL(): SQL {
    return this.effectDialect.buildInsertQuery(this.config)
  }

  toSQL(): Query {
    return this.effectDialect.sqlToQuery(this.getSQL())
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): PgEffectInsertPrepare<this, TEffectHKT> {
    return this.effectSession[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.effectDialect.sqlToQuery(this.getSQL()),
      this.config.returning,
      this.config.returning ? "all" : "run",
      undefined,
      {
        type: "insert",
        tables: extractUsedTable(this.config.table),
      },
    ) as PgEffectInsertPrepare<this, TEffectHKT>
  }

  prepare(): PgEffectInsertPrepare<this, TEffectHKT> {
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

  $dynamic(): PgEffectInsertDynamic<this> {
    return this as any
  }
}

applyEffectWrapper(PgEffectInsertBase)
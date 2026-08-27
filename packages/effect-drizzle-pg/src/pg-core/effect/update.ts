/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind, is } from "drizzle-orm/entity"
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import { SelectionProxyHandler } from "drizzle-orm/selection-proxy"
import type { Placeholder, Query, SQL, SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import type { SelectedFields, PgSelectJoinConfig } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PgUpdateConfig, PgUpdateSetSource } from "drizzle-orm/pg-core/query-builders/update"
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session"
import { PgTable } from "drizzle-orm/pg-core/table"
import { extractUsedTable } from "drizzle-orm/pg-core/utils"
import { PgViewBase } from "drizzle-orm/pg-core/view-base"
import { Subquery } from "drizzle-orm/subquery"
import { type DrizzleTypeError, type UpdateSet, type ValueOrArray } from "drizzle-orm/utils"
import type { PgColumn } from "drizzle-orm/pg-core/columns/common"
import {
  getTableColumnsRuntime,
  getTableLikeName,
  getViewSelectedFieldsRuntime,
  mapUpdateSet,
  orderSelectedFields,
  pgCodecs,
} from "../../internal/drizzle-utils"
import type { PgEffectPreparedQuery, PgEffectSession } from "./session"

export type PgEffectUpdateWithout<
  T extends AnyPgEffectUpdate,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true
  ? T
  : Omit<
      PgEffectUpdateBase<
        T["_"]["table"],
        T["_"]["runResult"],
        T["_"]["from"],
        T["_"]["returning"],
        TDynamic,
        T["_"]["excludedMethods"] | K,
        T["_"]["effectHKT"]
      >,
      T["_"]["excludedMethods"] | K
    >

export type PgEffectUpdateWithJoins<
  T extends AnyPgEffectUpdate,
  TDynamic extends boolean,
  TFrom extends PgTable | Subquery | PgViewBase | SQL,
> = TDynamic extends true
  ? T
  : Omit<
      PgEffectUpdateBase<
        T["_"]["table"],
        T["_"]["runResult"],
        TFrom,
        T["_"]["returning"],
        TDynamic,
        Exclude<T["_"]["excludedMethods"] | "from", "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin">,
        T["_"]["effectHKT"]
      >,
      Exclude<T["_"]["excludedMethods"] | "from", "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin">
    >

export type PgEffectUpdateReturningAll<
  T extends AnyPgEffectUpdate,
  TDynamic extends boolean,
> = PgEffectUpdateWithout<
  PgEffectUpdateBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["from"],
    T["_"]["table"]["$inferSelect"],
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectUpdateReturning<
  T extends AnyPgEffectUpdate,
  TDynamic extends boolean,
  TSelectedFields extends SelectedFields,
> = PgEffectUpdateWithout<
  PgEffectUpdateBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["from"],
    SelectResultFields<TSelectedFields>,
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type PgEffectUpdateExecute<T extends AnyPgEffectUpdate> = T["_"]["returning"] extends undefined
  ? T["_"]["runResult"]
  : T["_"]["returning"][]

export type PgEffectUpdatePrepare<
  T extends AnyPgEffectUpdate,
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
    execute: PgEffectUpdateExecute<T>
  },
  TEffectHKT
>

export type PgEffectUpdateDynamic<T extends AnyPgEffectUpdate> = PgEffectUpdate<
  T["_"]["table"],
  T["_"]["runResult"],
  T["_"]["from"],
  T["_"]["returning"],
  T["_"]["effectHKT"]
>

export type PgEffectUpdate<
  TTable extends PgTable = PgTable,
  TRunResult = unknown,
  TFrom extends PgTable | Subquery | PgViewBase | SQL | undefined = undefined,
  TReturning extends Record<string, unknown> | undefined = Record<string, unknown> | undefined,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = PgEffectUpdateBase<TTable, TRunResult, TFrom, TReturning, true, never, TEffectHKT>

export type AnyPgEffectUpdate = PgEffectUpdateBase<any, any, any, any, any, any, any>

export type PgEffectUpdateJoinFn<T extends AnyPgEffectUpdate> = <
  TJoinedTable extends PgTable | Subquery | PgViewBase | SQL,
>(
  table: TJoinedTable,
  on:
    | ((
        updateTable: T["_"]["table"]["_"]["columns"],
        from: T["_"]["from"] extends PgTable
          ? T["_"]["from"]["_"]["columns"]
          : T["_"]["from"] extends Subquery | PgViewBase
            ? T["_"]["from"]["_"]["selectedFields"]
            : never,
      ) => SQL | undefined)
    | SQL
    | undefined,
) => T

export class PgEffectUpdateBuilder<
  TTable extends PgTable,
  TRunResult,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "PgEffectUpdateBuilder"

  declare readonly _: {
    readonly table: TTable
  }

  constructor(
    protected table: TTable,
    protected session: PgEffectSession<TEffectHKT, TRunResult, any>,
    protected dialect: PgDialect,
    private withList?: Subquery[],
  ) {}

  set(
    values: PgUpdateSetSource<TTable>,
  ): PgEffectUpdateWithout<
    PgEffectUpdateBase<TTable, TRunResult, undefined, undefined, false, never, TEffectHKT>,
    false,
    "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin"
  > {
    return new PgEffectUpdateBase(
      this.table,
      mapUpdateSet(this.table, values),
      this.session,
      this.dialect,
      this.withList,
    ) as any
  }
}

export interface PgEffectUpdateBase<
  TTable extends PgTable = PgTable,
  TRunResult = unknown,
  TFrom extends PgTable | Subquery | PgViewBase | SQL | undefined = undefined,
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
    readonly from: TFrom
    readonly returning: TReturning
    readonly dynamic: TDynamic
    readonly excludedMethods: _TExcludedMethods
    readonly result: TReturning extends undefined ? TRunResult : TReturning[]
    readonly effectHKT: TEffectHKT
  }
}

export class PgEffectUpdateBase<
    TTable extends PgTable = PgTable,
    TRunResult = unknown,
    TFrom extends PgTable | Subquery | PgViewBase | SQL | undefined = undefined,
    TReturning = undefined,
    TDynamic extends boolean = false,
    _TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  implements RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "pg">, SQLWrapper
{
  static readonly [entityKind]: string = "PgEffectUpdate"

  /** @internal */
  config: PgUpdateConfig

  constructor(
    table: TTable,
    set: UpdateSet,
    private effectSession: PgEffectSession<TEffectHKT, TRunResult, any>,
    private effectDialect: PgDialect,
    withList?: Subquery[],
  ) {
    this.config = { set, table, withList, joins: [] }
  }

  from<TFrom extends PgTable | Subquery | PgViewBase | SQL>(
    source: TFrom,
  ): PgEffectUpdateWithJoins<this, TDynamic, TFrom> {
    this.config.from = source
    return this as any
  }

  private createJoin<TJoinType extends PgSelectJoinConfig["joinType"]>(
    joinType: TJoinType,
  ): PgEffectUpdateJoinFn<this> {
    return ((
      table: PgTable | Subquery | PgViewBase | SQL,
      on: ((updateTable: TTable, from: TFrom) => SQL | undefined) | SQL | undefined,
    ) => {
      const tableName = getTableLikeName(table)

      if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) {
        throw new Error(`Alias "${tableName}" is already used in this query`)
      }

      if (typeof on === "function") {
        const from = this.config.from
          ? is(table, PgTable)
            ? getTableColumnsRuntime(table)
            : is(table, Subquery)
              ? table._.selectedFields
              : is(table, PgViewBase)
                ? getViewSelectedFieldsRuntime(table).selectedFields
                : undefined
          : undefined
        on = on(
          new Proxy(
            this.config.table._.columns,
            new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" }),
          ) as any,
          from &&
            (new Proxy(from, new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })) as any),
        )
      }

      this.config.joins.push({ on, table, joinType, alias: tableName })

      return this as any
    }) as any
  }

  leftJoin = this.createJoin("left")

  rightJoin = this.createJoin("right")

  innerJoin = this.createJoin("inner")

  fullJoin = this.createJoin("full")

  where(where: SQL | undefined): PgEffectUpdateWithout<this, TDynamic, "where"> {
    this.config.where = where
    return this as any
  }

  returning(): PgEffectUpdateReturningAll<this, TDynamic>
  returning<TSelectedFields extends SelectedFields>(
    fields: TSelectedFields,
  ): PgEffectUpdateReturning<this, TDynamic, TSelectedFields>
  returning(
    fields: SelectedFields = getTableColumnsRuntime(this.config.table) as unknown as SelectedFields,
  ): PgEffectUpdateWithout<AnyPgEffectUpdate, TDynamic, "returning"> {
    this.config.returning = orderSelectedFields<PgColumn>(fields, undefined, pgCodecs)
    return this as any
  }

  /** @internal */
  getSQL(): SQL {
    return this.effectDialect.buildUpdateQuery(this.config)
  }

  toSQL(): Query {
    return this.effectDialect.sqlToQuery(this.getSQL())
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): PgEffectUpdatePrepare<this, TEffectHKT> {
    return this.effectSession[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.effectDialect.sqlToQuery(this.getSQL()),
      this.config.returning,
      this.config.returning ? "all" : "run",
      undefined,
      {
        type: "update",
        tables: extractUsedTable(this.config.table),
      },
    ) as PgEffectUpdatePrepare<this, TEffectHKT>
  }

  prepare(): PgEffectUpdatePrepare<this, TEffectHKT> {
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

  $dynamic(): PgEffectUpdateDynamic<this> {
    return this as any
  }
}

applyEffectWrapper(PgEffectUpdateBase)
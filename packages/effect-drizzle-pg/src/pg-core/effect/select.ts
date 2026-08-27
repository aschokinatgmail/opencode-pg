/* oxlint-disable */
import type * as Effect from "effect/Effect"
import type { CacheConfig } from "drizzle-orm/cache/core/types"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind, is } from "drizzle-orm/entity"
import type {
  BuildSubquerySelection,
  GetSelectTableName,
  GetSelectTableSelection,
  JoinNullability,
  SelectMode,
  SelectResult,
} from "drizzle-orm/query-builders/select.types"
import { SQL } from "drizzle-orm/sql/sql"
import type { ColumnsSelection, SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgColumn } from "drizzle-orm/pg-core/columns"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import { PgSelectBase } from "drizzle-orm/pg-core/query-builders/select"
import type { SelectedFields, PgSelectConfig, PgSelectHKTBase } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PgTable } from "drizzle-orm/pg-core/table"
import { PgViewBase } from "drizzle-orm/pg-core/view-base"
import { Subquery } from "drizzle-orm/subquery"
import { type Assume, getTableColumns } from "drizzle-orm/utils"
import { extractUsedTable } from "drizzle-orm/pg-core/utils"
import { getViewSelectedFieldsRuntime, getTableLikeName, orderSelectedFields, pgCodecs } from "../../internal/drizzle-utils"
import type { PgEffectPreparedQuery, PgEffectSession } from "./session"

export type PgEffectSelectPrepare<
  T extends AnyPgEffectSelect,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = PgEffectPreparedQuery<
  {
    type: "async"
    run: T["_"]["runResult"]
    all: T["_"]["result"]
    get: T["_"]["result"][number] | undefined
    values: any[][]
    execute: T["_"]["result"]
  },
  TEffectHKT
>

export class PgEffectSelectBuilder<
  TSelection extends SelectedFields | undefined,
  TRunResult,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "PgEffectSelectBuilder"

  private fields: TSelection
  private session: PgEffectSession<TEffectHKT, TRunResult, any> | undefined
  private dialect: PgDialect
  private withList: Subquery[] | undefined
  private distinct: boolean | undefined

  constructor(config: {
    fields: TSelection
    session: PgEffectSession<TEffectHKT, TRunResult, any> | undefined
    dialect: PgDialect
    withList?: Subquery[]
    distinct?: boolean
  }) {
    this.fields = config.fields
    this.session = config.session
    this.dialect = config.dialect
    this.withList = config.withList
    this.distinct = config.distinct
  }

  from<TFrom extends PgTable | Subquery | PgViewBase | SQL>(
    source: TFrom,
  ): PgEffectSelectBase<
      GetSelectTableName<TFrom>,
      TRunResult,
      TSelection extends undefined ? GetSelectTableSelection<TFrom> : TSelection,
      TSelection extends undefined ? "single" : "partial",
      GetSelectTableName<TFrom> extends string ? Record<GetSelectTableName<TFrom>, "not-null"> : {},
      false,
      never,
      SelectResult<
        TSelection extends undefined ? GetSelectTableSelection<TFrom> : TSelection,
        TSelection extends undefined ? "single" : "partial",
        GetSelectTableName<TFrom> extends string ? Record<GetSelectTableName<TFrom>, "not-null"> : {}
      >[],
      BuildSubquerySelection<
        TSelection extends undefined ? GetSelectTableSelection<TFrom> : TSelection,
        GetSelectTableName<TFrom> extends string ? Record<GetSelectTableName<TFrom>, "not-null"> : {}
      >,
      TEffectHKT
    > {
    const isPartialSelect = !!this.fields

    let fields: SelectedFields
    if (this.fields) {
      fields = this.fields
    } else if (is(source, Subquery)) {
      fields = Object.fromEntries(
        Object.keys(source._.selectedFields).map((key) => [
          key,
          source[key as unknown as keyof typeof source] as unknown as SelectedFields[string],
        ]),
      )
    } else if (is(source, PgViewBase)) {
      fields = getViewSelectedFieldsRuntime(source).selectedFields as SelectedFields
    } else if (is(source, SQL)) {
      fields = {}
    } else {
      fields = getTableColumns<PgTable>(source)
    }

    return new PgEffectSelectBase({
      table: source,
      fields,
      isPartialSelect,
      session: this.session as any,
      dialect: this.dialect,
      withList: this.withList,
      distinct: this.distinct,
    }) as any
  }
}

export interface PgEffectSelectHKT<TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends PgSelectHKTBase {
  runResult: unknown
  _type: PgEffectSelectBase<
    this["tableName"],
    this["runResult"],
    Assume<this["selection"], ColumnsSelection>,
    this["selectMode"],
    Assume<this["nullabilityMap"], Record<string, JoinNullability>>,
    this["dynamic"],
    this["excludedMethods"],
    Assume<this["result"], any[]>,
    Assume<this["selectedFields"], ColumnsSelection>,
    TEffectHKT
  >
}

export interface PgEffectSelectBase<
  TTableName extends string | undefined,
  TRunResult,
  TSelection extends ColumnsSelection,
  TSelectMode extends SelectMode = "single",
  TNullabilityMap extends Record<string, JoinNullability> = TTableName extends string
    ? Record<TTableName, "not-null">
    : {},
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
  TResult extends any[] = SelectResult<TSelection, TSelectMode, TNullabilityMap>[],
  TSelectedFields extends ColumnsSelection = BuildSubquerySelection<TSelection, TNullabilityMap>,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> extends PgSelectBase<
      PgEffectSelectHKT<TEffectHKT>,
      TTableName,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]> {
  readonly _: {
    readonly dialect: "pg"
    readonly hkt: PgEffectSelectHKT<TEffectHKT>
    readonly tableName: TTableName
    readonly runResult: TRunResult
    readonly selection: TSelection
    readonly selectMode: TSelectMode
    readonly nullabilityMap: TNullabilityMap
    readonly dynamic: TDynamic
    readonly excludedMethods: TExcludedMethods
    readonly result: TResult
    readonly selectedFields: TSelectedFields
    readonly config: PgSelectConfig
  }
}

export class PgEffectSelectBase<
    TTableName extends string | undefined,
    TRunResult,
    TSelection extends ColumnsSelection,
    TSelectMode extends SelectMode = "single",
    TNullabilityMap extends Record<string, JoinNullability> = TTableName extends string
      ? Record<TTableName, "not-null">
      : {},
    TDynamic extends boolean = false,
    TExcludedMethods extends string = never,
    TResult extends any[] = SelectResult<TSelection, TSelectMode, TNullabilityMap>[],
    TSelectedFields extends ColumnsSelection = BuildSubquerySelection<TSelection, TNullabilityMap>,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  extends PgSelectBase<
    PgEffectSelectHKT<TEffectHKT>,
    TTableName,
    TSelection,
    TSelectMode,
    TNullabilityMap,
    TDynamic,
    TExcludedMethods,
    TResult,
    TSelectedFields
  >
  implements SQLWrapper
{
  static override readonly [entityKind]: string = "PgEffectSelect"

  constructor(config: {
    table: PgTable | Subquery | PgViewBase | SQL
    fields: TSelection
    isPartialSelect: boolean
    session: PgEffectSession<TEffectHKT, TRunResult, any> | undefined
    dialect: PgDialect
    withList?: Subquery[]
    distinct?: boolean
  }) {
    super({
      fields: config.fields,
      session: config.session as any,
      dialect: config.dialect,
      withList: config.withList,
      distinct: config.distinct,
    })
    // Replicate PgSelectBase.from() setup so the builder can construct a fully
    // configured Effect-yieldable select without calling the inherited from().
    const table = config.table
    ;(this as unknown as { config: PgSelectConfig }).config.table = table
    ;(this as unknown as { config: PgSelectConfig }).config.fields = { ...config.fields }
    ;(this as unknown as { isPartialSelect: boolean }).isPartialSelect = config.isPartialSelect
    const tableName = getTableLikeName(table)
    ;(this as unknown as { tableName: string | undefined }).tableName = tableName
    ;(this as unknown as { joinsNotNullableMap: Record<string, boolean> }).joinsNotNullableMap =
      typeof tableName === "string" ? { [tableName]: true } : {}
    for (const item of extractUsedTable(table)) this.usedTables.add(item)
    config.withList?.forEach((it) => {
      for (const el of extractUsedTable(it)) this.usedTables.add(el)
    })
  }

  private get effectConfig() {
    return (this as unknown as { config: PgSelectConfig }).config
  }

  /** @internal */
  override getSQL(): SQL {
    return this.dialect.buildSelectQuery(this.effectConfig)
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): PgEffectSelectPrepare<this, TEffectHKT> {
    if (!this.session) {
      throw new Error("Cannot execute a query on a query builder. Please use a database instance instead.")
    }
    const session = this.session as unknown as PgEffectSession<TEffectHKT, TRunResult, any>
    const query = session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.dialect.sqlToQuery(this.getSQL()),
      orderSelectedFields<PgColumn>(this.effectConfig.fields, undefined, pgCodecs),
      "all",
      undefined,
      {
        type: "select",
        tables: [...this.usedTables],
      },
      this.cacheConfig,
    )
    query.joinsNotNullableMap = this.joinsNotNullableMap
    return query as ReturnType<this["prepare"]>
  }

  override $withCache(config?: { config?: CacheConfig; tag?: string; autoInvalidate?: boolean } | false) {
    this.cacheConfig =
      config === undefined
        ? { config: {}, enabled: true, autoInvalidate: true }
        : config === false
          ? { enabled: false }
          : { enabled: true, autoInvalidate: true, ...config }
    return this
  }

  prepare(): PgEffectSelectPrepare<this, TEffectHKT> {
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
}

applyEffectWrapper(PgEffectSelectBase)

export type AnyPgEffectSelect = PgEffectSelectBase<any, any, any, any, any, any, any, any, any, any>
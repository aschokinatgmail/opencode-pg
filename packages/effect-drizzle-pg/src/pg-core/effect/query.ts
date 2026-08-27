/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import {
  type BuildQueryResult,
  type BuildRelationalQueryResult,
  type DBQueryConfig,
  makeDefaultRqbMapper,
  type TableRelationalConfig,
  type TablesRelationalConfig,
} from "drizzle-orm/relations"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import { type Query, type SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import type { KnownKeysOnly } from "drizzle-orm/utils"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session"
import type { PgTable } from "drizzle-orm/pg-core/table"
import type { PgEffectPreparedQuery, PgEffectSession } from "./session"

export class PgEffectRelationalQueryBuilder<
  TSchema extends TablesRelationalConfig,
  TFields extends TableRelationalConfig,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "PgEffectRelationalQueryBuilderV2"

  constructor(
    private schema: TSchema,
    private table: PgTable,
    private tableConfig: TableRelationalConfig,
    private dialect: PgDialect,
    private session: PgEffectSession<TEffectHKT, any, any>,
    private rowMode?: boolean,
    private forbidJsonb?: boolean,
  ) {}

  findMany<TConfig extends DBQueryConfig<"many", TSchema, TFields>>(
    config?: KnownKeysOnly<TConfig, DBQueryConfig<"many", TSchema, TFields>>,
  ): PgEffectRelationalQuery<BuildQueryResult<TSchema, TFields, TConfig>[], TEffectHKT> {
    return new PgEffectRelationalQuery(
      this.schema,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      (config as DBQueryConfig<"many"> | undefined) ?? true,
      "many",
      this.rowMode,
      this.forbidJsonb,
    )
  }

  findFirst<TConfig extends DBQueryConfig<"one", TSchema, TFields>>(
    config?: KnownKeysOnly<TConfig, DBQueryConfig<"one", TSchema, TFields>>,
  ): PgEffectRelationalQuery<BuildQueryResult<TSchema, TFields, TConfig> | undefined, TEffectHKT> {
    return new PgEffectRelationalQuery(
      this.schema,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      (config as DBQueryConfig<"one"> | undefined) ?? true,
      "first",
      this.rowMode,
      this.forbidJsonb,
    )
  }
}

export interface PgEffectRelationalQuery<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    RunnableQuery<TResult, "pg">,
    SQLWrapper {}

export class PgEffectRelationalQuery<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  implements RunnableQuery<TResult, "pg">, SQLWrapper
{
  static readonly [entityKind]: string = "PgEffectRelationalQueryV2"

  declare readonly _: {
    readonly dialect: "pg"
    readonly type: "async"
    readonly result: TResult
  }

  /** @internal */
  mode: "many" | "first"
  /** @internal */
  table: PgTable

  constructor(
    private schema: TablesRelationalConfig,
    table: PgTable,
    private tableConfig: TableRelationalConfig,
    private dialect: PgDialect,
    private session: PgEffectSession<TEffectHKT, any, any>,
    private config: DBQueryConfig<"many" | "one"> | true,
    mode: "many" | "first",
    private rowMode?: boolean,
    private forbidJsonb?: boolean,
  ) {
    this.mode = mode
    this.table = table
  }

  /** @internal */
  getSQL(): SQL {
    return this._getQuery().sql
  }

  /** @internal */
  _prepare(
    isOneTimeQuery = true,
  ): PgEffectPreparedQuery<
    PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
    TEffectHKT,
    true
  > {
    const { query, builtQuery } = this._toSQL()
    const mapperConfig = {
      isFirst: this.mode === "first",
      parseJson: !this.rowMode,
      parseJsonIfString: false,
      rootJsonMappers: true,
      selection: query.selection,
    }

    return this.session[isOneTimeQuery ? "prepareOneTimeRelationalQuery" : "prepareRelationalQuery"](
      builtQuery,
      undefined,
      this.mode === "first" ? "get" : "all",
      makeDefaultRqbMapper(mapperConfig),
      mapperConfig,
    ) as PgEffectPreparedQuery<
      PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
      TEffectHKT,
      true
    >
  }

  prepare(): PgEffectPreparedQuery<
    PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
    TEffectHKT,
    true
  > {
    return this._prepare(false)
  }

  private _getQuery() {
    const query = this.dialect.buildRelationalQuery({
      schema: this.schema,
      table: this.table,
      tableConfig: this.tableConfig,
      queryConfig: this.config,
      mode: this.mode,
      nested: this.rowMode,
    })

    if (this.rowMode) {
      const jsonColumns = sql.join(
        query.selection.map((s) => {
          return sql`${sql.raw(this.dialect.escapeString(s.key))}, ${
            s.selection ? sql`jsonb(${sql.identifier(s.key)})` : sql.identifier(s.key)
          }`
        }),
        sql`, `,
      )

      query.sql = sql`select json_object(${jsonColumns}) as ${sql.identifier("r")} from (${query.sql}) as ${sql.identifier(
        "t",
      )}`
    }

    return query
  }

  private _toSQL(): { query: BuildRelationalQueryResult; builtQuery: Query } {
    const query = this._getQuery()

    const builtQuery = this.dialect.sqlToQuery(query.sql)

    return { query, builtQuery }
  }

  toSQL(): Query {
    return this._toSQL().builtQuery
  }

  execute(placeholderValues?: Record<string, unknown>) {
    return this.mode === "first" ? this._prepare().get(placeholderValues) : this._prepare().all(placeholderValues)
  }
}

applyEffectWrapper(PgEffectRelationalQuery)
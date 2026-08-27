/* oxlint-disable */
import { Effect } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { MutationOption } from "drizzle-orm/cache/core/cache"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { TypedQueryBuilder } from "drizzle-orm/query-builders/query-builder"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { SelectionProxyHandler } from "drizzle-orm/selection-proxy"
import { type ColumnsSelection, type SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import { QueryBuilder } from "drizzle-orm/pg-core/query-builders/query-builder"
import type { SelectedFields } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session"
import type { PgTable } from "drizzle-orm/pg-core/table"
import type { PgViewBase } from "drizzle-orm/pg-core/view-base"
import { WithSubquery } from "drizzle-orm/subquery"
import type { WithBuilder } from "drizzle-orm/pg-core/subquery"
import { PgEffectCountBuilder } from "./count"
import { PgEffectDeleteBase } from "./delete"
import { PgEffectInsertBuilder } from "./insert"
import { PgEffectRelationalQueryBuilder } from "./query"
import { PgEffectRaw } from "./raw"
import { PgEffectSelectBuilder } from "./select"
import type { PgEffectSelectBase } from "./select"
import type { PgEffectSession, PgEffectTransaction } from "./session"
import { PgEffectUpdateBuilder } from "./update"

export class PgEffectDatabase<
  TEffectHKT extends QueryEffectHKTBase,
  TRunResult,
  TRelations extends AnyRelations = EmptyRelations,
> {
  static readonly [entityKind]: string = "PgEffectDatabase"

  declare readonly _: {
    readonly relations: TRelations
    readonly session: PgEffectSession<TEffectHKT, TRunResult, TRelations>
  }

  query: {
    [K in keyof TRelations]: PgEffectRelationalQueryBuilder<TRelations, TRelations[K], TEffectHKT>
  }

  constructor(
    /** @internal */
    readonly dialect: PgDialect,
    /** @internal */
    readonly session: PgEffectSession<TEffectHKT, TRunResult, TRelations>,
    relations: TRelations,
    readonly rowModeRQB?: boolean,
    readonly forbidJsonb?: boolean,
  ) {
    this._ = {
      relations,
      session,
    }

    this.query = {} as (typeof this)["query"]
    for (const [tableName, relation] of Object.entries(relations)) {
      ;(this.query as PgEffectDatabase<TEffectHKT, TRunResult, AnyRelations>["query"])[tableName] =
        new PgEffectRelationalQueryBuilder(
          relations,
          relations[relation.name]!.table as PgTable,
          relation,
          dialect,
          session,
          rowModeRQB,
          forbidJsonb,
        )
    }

    this.$cache = {
      invalidate: (_params: MutationOption) => Effect.void,
    }
  }

  $with: WithBuilder = (alias: string, selection?: ColumnsSelection) => {
    const self = this
    const as = (
      qb:
        | TypedQueryBuilder<ColumnsSelection | undefined>
        | SQL
        | ((qb: QueryBuilder) => TypedQueryBuilder<ColumnsSelection | undefined> | SQL),
    ) => {
      if (typeof qb === "function") {
        qb = qb(new QueryBuilder(self.dialect))
      }

      return new Proxy(
        new WithSubquery(
          qb.getSQL(),
          selection ??
            (("getSelectedFields" in qb
              ? ((qb as { getSelectedFields(): SelectedFields | undefined }).getSelectedFields() ?? {})
              : {}) as SelectedFields),
          alias,
          true,
        ),
        new SelectionProxyHandler({ alias, sqlAliasedBehavior: "alias", sqlBehavior: "error" }),
      )
    }
    return { as }
  }

  $cache: { invalidate: EffectCacheShape["onMutate"] }

  $count(source: PgTable | PgViewBase | SQL | SQLWrapper, filters?: SQL<unknown>) {
    return new PgEffectCountBuilder({ source, filters, session: this.session })
  }

  with(...queries: WithSubquery[]) {
    const self = this

    function select(): PgEffectSelectBuilder<undefined, TRunResult, TEffectHKT>
    function select<TSelection extends SelectedFields>(
      fields: TSelection,
    ): PgEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>
    function select(
      fields?: SelectedFields,
    ): PgEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
      return new PgEffectSelectBuilder({
        fields: fields ?? undefined,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
      })
    }

    function selectDistinct(): PgEffectSelectBuilder<undefined, TRunResult, TEffectHKT>
    function selectDistinct<TSelection extends SelectedFields>(
      fields: TSelection,
    ): PgEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>
    function selectDistinct(
      fields?: SelectedFields,
    ): PgEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
      return new PgEffectSelectBuilder({
        fields: fields ?? undefined,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: true,
      })
    }

    function update<TTable extends PgTable>(
      table: TTable,
    ): PgEffectUpdateBuilder<TTable, TRunResult, TEffectHKT> {
      return new PgEffectUpdateBuilder(table, self.session, self.dialect, queries)
    }

    function insert<TTable extends PgTable>(
      into: TTable,
    ): PgEffectInsertBuilder<TTable, TRunResult, TEffectHKT> {
      return new PgEffectInsertBuilder(into, self.session, self.dialect, queries)
    }

    function delete_<TTable extends PgTable>(
      from: TTable,
    ): PgEffectDeleteBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
      return new PgEffectDeleteBase(from, self.session, self.dialect, queries)
    }

    return { select, selectDistinct, update, insert, delete: delete_ }
  }

  select(): PgEffectSelectBuilder<undefined, TRunResult, TEffectHKT>
  select<TSelection extends SelectedFields>(
    fields: TSelection,
  ): PgEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>
  select(fields?: SelectedFields): PgEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
    return new PgEffectSelectBuilder({ fields: fields ?? undefined, session: this.session, dialect: this.dialect })
  }

  selectDistinct(): PgEffectSelectBuilder<undefined, TRunResult, TEffectHKT>
  selectDistinct<TSelection extends SelectedFields>(
    fields: TSelection,
  ): PgEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>
  selectDistinct(
    fields?: SelectedFields,
  ): PgEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
    return new PgEffectSelectBuilder({
      fields: fields ?? undefined,
      session: this.session,
      dialect: this.dialect,
      distinct: true,
    })
  }

  update<TTable extends PgTable>(table: TTable): PgEffectUpdateBuilder<TTable, TRunResult, TEffectHKT> {
    return new PgEffectUpdateBuilder(table, this.session, this.dialect)
  }

  insert<TTable extends PgTable>(into: TTable): PgEffectInsertBuilder<TTable, TRunResult, TEffectHKT> {
    return new PgEffectInsertBuilder(into, this.session, this.dialect)
  }

  delete<TTable extends PgTable>(
    from: TTable,
  ): PgEffectDeleteBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    return new PgEffectDeleteBase(from, this.session, this.dialect)
  }

  private raw<TResult>(
    query: SQLWrapper | string,
    action: "all" | "get" | "run" | "values",
    execute: (query: SQL) => Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
  ): PgEffectRaw<TResult, TEffectHKT> {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL()
    return new PgEffectRaw(
      () => execute(sequel),
      () => sequel,
      action,
      this.dialect,
      (result) => result,
    )
  }

  run(query: SQLWrapper | string): PgEffectRaw<TRunResult, TEffectHKT> {
    return this.raw(query, "run", (sequel) => this.session.run(sequel))
  }

  all<T = unknown>(query: SQLWrapper | string): PgEffectRaw<T[], TEffectHKT> {
    return this.raw(query, "all", (sequel) => this.session.all(sequel))
  }

  get<T = unknown>(query: SQLWrapper | string): PgEffectRaw<T | undefined, TEffectHKT> {
    return this.raw(query, "get", (sequel) => this.session.get(sequel))
  }

  values<T extends unknown[] = unknown[]>(query: SQLWrapper | string): PgEffectRaw<T[], TEffectHKT> {
    return this.raw(query, "values", (sequel) => this.session.values(sequel))
  }

  transaction: <A, E, R>(
    transaction: (tx: PgEffectTransaction<TEffectHKT, TRunResult, TRelations>) => Effect.Effect<A, E, R>,
    config?: PgTransactionConfig,
  ) => Effect.Effect<A, E | SqlError, R> = (tx, config) => this.session.transaction(tx, config)
}

export type PgEffectWithReplicas<Q> = Q & { $primary: Q; $replicas: Q[] }

export const withReplicas = <
  TEffectHKT extends QueryEffectHKTBase,
  TRunResult,
  TRelations extends AnyRelations,
  Q extends PgEffectDatabase<TEffectHKT, TRunResult, TRelations>,
>(
  primary: Q,
  replicas: [Q, ...Q[]],
  getReplica: (replicas: Q[]) => Q = () => replicas[Math.floor(Math.random() * replicas.length)]!,
): PgEffectWithReplicas<Q> => {
  const select: Q["select"] = (...args: []) => getReplica(replicas).select(...args)
  const selectDistinct: Q["selectDistinct"] = (...args: []) => getReplica(replicas).selectDistinct(...args)
  const $count: Q["$count"] = (...args: [any]) => getReplica(replicas).$count(...args)
  const _with: Q["with"] = (...args: []) => getReplica(replicas).with(...args)
  const $with = ((...args: [string] | [string, ColumnsSelection]) =>
    args.length === 1
      ? getReplica(replicas).$with(args[0])
      : getReplica(replicas).$with(args[0], args[1])) as Q["$with"]

  const update: Q["update"] = (...args: [any]) => primary.update(...args)
  const insert: Q["insert"] = (...args: [any]) => primary.insert(...args)
  const $delete: Q["delete"] = (...args: [any]) => primary.delete(...args)
  const run: Q["run"] = (...args: [any]) => primary.run(...args)
  const all: Q["all"] = (...args: [any]) => primary.all(...args)
  const get: Q["get"] = (...args: [any]) => primary.get(...args)
  const values: Q["values"] = (...args: [any]) => primary.values(...args)
  const transaction: Q["transaction"] = (...args: [any]) => primary.transaction(...args)

  return {
    ...primary,
    update,
    insert,
    delete: $delete,
    run,
    all,
    get,
    values,
    transaction,
    $primary: primary,
    $replicas: replicas,
    select,
    selectDistinct,
    $count,
    $with,
    with: _with,
    get query() {
      return getReplica(replicas).query
    },
  }
}

export type AnyPgEffectDatabase = PgEffectDatabase<any, any, any>
export type AnyPgEffectSelectBase = PgEffectSelectBase<any, any, any, any, any, any, any, any, any, any>
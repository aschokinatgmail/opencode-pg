/* oxlint-disable */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { WithCacheConfig } from "drizzle-orm/cache/core/types"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import type { EffectLoggerShape } from "drizzle-orm/effect-core/logger"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations } from "drizzle-orm/relations"
import type { RelationalQueryMapperConfig } from "drizzle-orm/relations"
import type { Query } from "drizzle-orm/sql/sql"
import type { PgDialect } from "drizzle-orm/pg-core/dialect"
import { PgEffectPreparedQuery, PgEffectSession, PgEffectTransaction } from "../pg-core/effect/session"
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PreparedQueryConfig, PgTransactionConfig } from "drizzle-orm/pg-core/session"

export interface EffectPgQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError
  readonly context: never
}

export type EffectPgRunResult = readonly never[]

export interface EffectPgSessionOptions {
  logger: EffectLoggerShape
  cache: EffectCacheShape
  useJitMappers?: boolean
}

export class EffectPgSession<TRelations extends AnyRelations> extends PgEffectSession<
  EffectPgQueryEffectHKT,
  EffectPgRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectPgSession"

  constructor(
    private client: SqlClient,
    dialect: PgDialect,
    protected relations: TRelations,
    private options: EffectPgSessionOptions,
  ) {
    super(dialect)
  }

  override prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: "run" | "all" | "get",
    customResultMapper?: (rows: unknown[][], mapColumnValue?: (value: unknown) => unknown) => unknown,
    queryMetadata?: {
      type: "select" | "update" | "delete" | "insert"
      tables: string[]
    },
    cacheConfig?: WithCacheConfig,
  ): PgEffectPreparedQuery<T, EffectPgQueryEffectHKT> {
    return new PgEffectPreparedQuery<T, EffectPgQueryEffectHKT>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      undefined,
      undefined,
      this.isInTransaction(),
    )
  }

  override prepareRelationalQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: "run" | "all" | "get",
    customResultMapper: (rows: Record<string, unknown>[], mapColumnValue?: (value: unknown) => unknown) => unknown,
    config: RelationalQueryMapperConfig,
  ): PgEffectPreparedQuery<T, EffectPgQueryEffectHKT, true> {
    return new PgEffectPreparedQuery<T, EffectPgQueryEffectHKT, true>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      undefined,
      undefined,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      true,
      config,
      this.isInTransaction(),
    )
  }

  private execute(query: Query, params: unknown[], method: "run" | "all" | "get" | "values") {
    const statement = this.client.unsafe(query.sql, params)
    if (method === "values") return statement.values
    if (method === "get") return statement.withoutTransform.pipe(Effect.map((rows) => rows[0]))
    return statement.withoutTransform
  }

  private isInTransaction() {
    return Effect.serviceOption(this.client.transactionService).pipe(Effect.map((option) => option._tag === "Some"))
  }

  private executeTransactionStatement(connection: Effect.Success<SqlClient["reserve"]>, query: string) {
    return connection.executeUnprepared(query, [], undefined).pipe(Effect.asVoid)
  }

  private withTransaction<A, E, R>(effect: Effect.Effect<A, E, R>, config: PgTransactionConfig | undefined) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.withFiber<A, E | SqlError, R>((fiber) => {
        const services = fiber.context
        const connectionOption = Context.getOption(services, this.client.transactionService)
        const connection: Effect.Effect<
          readonly [Scope.Closeable | undefined, Effect.Success<SqlClient["reserve"]>],
          SqlError
        > =
          connectionOption._tag === "Some"
            ? Effect.succeed([undefined, connectionOption.value[0]] as const)
            : Scope.make().pipe(
                Effect.flatMap((scope) =>
                  Scope.provide(this.client.reserve, scope).pipe(
                    Effect.map((connection) => [scope, connection] as const),
                    Effect.catch((error) =>
                      Scope.close(scope, Exit.fail(error)).pipe(Effect.andThen(Effect.fail(error))),
                    ),
                  ),
                ),
              )
        const id = connectionOption._tag === "Some" ? connectionOption.value[1] + 1 : 0

        return connection.pipe(
          Effect.flatMap(([scope, connection]) => {
            const transaction = this.executeTransactionStatement(
              connection,
              id === 0 ? this.buildBegin(config) : `savepoint effect_pg_${id}`,
            ).pipe(
              Effect.flatMap(() =>
                Effect.provideContext(
                  restore(effect),
                  Context.add(services, this.client.transactionService, [connection, id]),
                ).pipe(
                  Effect.exit,
                  Effect.flatMap((exit) => {
                    const finalize = Exit.isSuccess(exit)
                      ? id === 0
                        ? this.executeTransactionStatement(connection, "commit").pipe(
                            // PG auto-rollbacks on commit failure (deferred constraint violations abort
                            // the transaction). The explicit rollback is a no-op safety net: if the
                            // transaction is already aborted, ROLLBACK succeeds; if not, it would
                            // error, which we swallow. See PORT-NOTES.md for the full analysis.
                            Effect.catch((error) =>
                              this.executeTransactionStatement(connection, "rollback").pipe(
                                Effect.catch(() => Effect.void),
                                Effect.andThen(Effect.fail(error)),
                              ),
                            ),
                          )
                        : this.executeTransactionStatement(connection, `release savepoint effect_pg_${id}`)
                      : id === 0
                        ? this.executeTransactionStatement(connection, "rollback")
                        : this.executeTransactionStatement(connection, `rollback to savepoint effect_pg_${id}`).pipe(
                            Effect.andThen(
                              this.executeTransactionStatement(connection, `release savepoint effect_pg_${id}`),
                            ),
                          )

                    return finalize.pipe(Effect.flatMap(() => exit))
                  }),
                ),
              ),
            )

            return scope === undefined
              ? transaction
              : transaction.pipe(Effect.onExit((exit) => Scope.close(scope, exit)))
          }),
        )
      }),
    )
  }

  // PG BEGIN syntax: BEGIN ISOLATION LEVEL X, READ ONLY|WRITE, DEFERRABLE|NOT DEFERRABLE.
  // SQLite uses `begin deferred|immediate|exclusive`; PG has no equivalent of `deferred` begin
  // (constraint deferral is per-constraint via DEFERRABLE INITIALLY DEFERRED, not per-transaction).
  private buildBegin(config: PgTransactionConfig | undefined) {
    const parts: string[] = ["begin"]
    if (config?.isolationLevel) {
      parts.push(`isolation level ${config.isolationLevel}`)
    }
    if (config?.accessMode) {
      parts.push(config.accessMode)
    }
    if (config?.deferrable !== undefined) {
      parts.push(config.deferrable ? "deferrable" : "not deferrable")
    }
    return parts.join(" ")
  }

  override transaction<A, E, R>(
    transaction: (tx: EffectPgTransaction<TRelations>) => Effect.Effect<A, E, R>,
    config?: PgTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    const { dialect, relations } = this

    return this.withTransaction(
      Effect.gen({ self: this }, function* () {
        const tx = new EffectPgTransaction<TRelations>(dialect, this, relations)

        return yield* transaction(tx)
      }),
      config,
    )
  }
}

export class EffectPgTransaction<TRelations extends AnyRelations> extends PgEffectTransaction<
  EffectPgQueryEffectHKT,
  EffectPgRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectPgTransaction"

  override transaction: <A, E, R>(
    transaction: (
      tx: PgEffectTransaction<EffectPgQueryEffectHKT, EffectPgRunResult, TRelations>,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, SqlError | E, R> = (tx) => this.session.transaction(tx)
}
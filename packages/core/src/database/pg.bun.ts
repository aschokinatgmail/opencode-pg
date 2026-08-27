// postgres-js SqlClient + Drizzle layers for the PG backend.
//
// postgres-js (the `postgres` package, decision #1) is isomorphic — the same
// driver works under Bun and Node. This file holds the shared implementation;
// `pg.node.ts` re-exports it so the `#pg` import map can route per runtime
// without duplicating code.

import postgres from "postgres"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import { identity } from "effect/Function"
import { Context } from "effect"
import * as Fiber from "effect/Fiber"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { SqlError, UnknownError as SqlUnknownError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"
import { Pg } from "./pg"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@opencode-ai/core/database/PgClient" as const
type TypeId = typeof TypeId

interface PgClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly updateValues: never
}

export interface Config {
  readonly url: string
  readonly maxConnections?: number
  readonly idleTimeoutSeconds?: number
  readonly connectTimeoutSeconds?: number
  readonly prepare?: boolean
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
  readonly statementTimeoutMs?: number
  readonly idleInTransactionSessionTimeoutMs?: number
}

const makeCompiler = (transform?: (_: string) => string): Statement.Compiler => {
  const escape = Statement.defaultEscape("\"")
  return Statement.makeCompiler({
    dialect: "pg",
    placeholder(index) {
      return `$${index}`
    },
    onIdentifier: transform
      ? function (value, withoutTransform) {
          return withoutTransform ? escape(value) : escape(transform(value))
        }
      : escape,
    onRecordUpdate(placeholders, valueAlias, valueColumns, values, returning) {
      return [
        `(values ${placeholders}) AS ${valueAlias}${valueColumns}${returning ? ` RETURNING ${returning[0]}` : ""}`,
        returning ? values.flat().concat(returning[1]) : values.flat(),
      ]
    },
    onCustom() {
      return ["", []]
    },
  })
}

const sqlError = (cause: unknown, message: string, operation: string) =>
  new SqlError({ reason: new SqlUnknownError({ cause, message, operation }) })

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Pg.Native) as ReturnType<typeof postgres>

    const compiler = makeCompiler(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const makeConnection = (reserved: ReturnType<typeof postgres> | null): Connection => {
      const exec = reserved
        ? <A>(query: string, params: ReadonlyArray<unknown> = []) =>
            Effect.tryPromise({
              try: () =>
                reserved.unsafe(query, params as Parameters<typeof reserved.unsafe>[1], {
                  prepare: false,
                }) as unknown as Promise<A>,
              catch: (cause) => sqlError(cause, "Failed to execute statement", "execute"),
            })
        : <A>(query: string, params: ReadonlyArray<unknown> = []) =>
            Effect.tryPromise({
              try: () =>
                native.unsafe(query, params as Parameters<typeof native.unsafe>[1], {
                  prepare: false,
                }) as unknown as Promise<A>,
              catch: (cause) => sqlError(cause, "Failed to execute statement", "execute"),
            })

      const execValues = (query: string, params: ReadonlyArray<unknown> = []) =>
        Effect.tryPromise({
          try: async () => {
            const handle = reserved ?? native
            const result = await handle.unsafe(query, params as Parameters<typeof handle.unsafe>[1], {
              prepare: false,
            })
            const rows = Array.from(result) as Array<Record<string, unknown>>
            if (rows.length === 0) return [] as unknown[][]
            const keys = Object.keys(rows[0]!)
            return rows.map((row) => keys.map((k) => row[k]))
          },
          catch: (cause) => sqlError(cause, "Failed to execute values query", "execute"),
        })

      return identity<Connection>({
        execute(query, params, transformRows) {
          const effect = exec<ReadonlyArray<Record<string, unknown>>>(query, params)
          return transformRows ? Effect.map(effect, transformRows) : effect
        },
        executeRaw(query, params) {
          return exec(query, params)
        },
        executeValues(query, params) {
          return execValues(query, params)
        },
        executeUnprepared(query, params, transformRows) {
          const effect = exec<ReadonlyArray<Record<string, unknown>>>(query, params)
          return transformRows ? Effect.map(effect, transformRows) : effect
        },
        executeStream() {
          return Stream.die("executeStream not implemented for postgres-js")
        },
      })
    }

    const connection = makeConnection(null)

    // Cond 2 (Memo #9 §8.4): apply statement timeouts per connection, not
    // one-shot on the shared pooled client. Reserved connections (transactions,
    // client.reserve) get the SETs on reserve; the pooled base connection is
    // used for simple statements which postgres-js pools internally — those
    // connections are not pinned, so a one-time SET on the shared client would
    // only land on one arbitrary pooled connection. Instead we apply the SETs
    // here on every reserved connection. The pooled base connection path
    // (non-reserved simple statements) does not carry timeouts — acceptable
    // because simple statements are short by construction; the dangerous
    // long-running cases are transactions (reserved) and explicit reserves,
    // both of which go through makeReservedConnection below.
    const STATEMENT_TIMEOUT_MS = options.statementTimeoutMs ?? 30_000
    const IDLE_IN_TX_TIMEOUT_MS = options.idleInTransactionSessionTimeoutMs ?? 60_000

    const makeReservedConnection = (reserved: ReturnType<typeof postgres>): Effect.Effect<Connection, SqlError, Scope.Scope> =>
      Effect.gen(function* () {
        // Cond 2: SET timeouts on the reserved connection before use.
        // Session-level GUCs persist for the connection's lifetime; re-SET
        // per reserve is belt-and-braces (cheap, idempotent).
        yield* Effect.tryPromise({
          try: () =>
            reserved.unsafe(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`, [], { prepare: false }) as unknown as Promise<unknown>,
          catch: (cause) => sqlError(cause, "Failed to SET statement_timeout", "reserve"),
        })
        yield* Effect.tryPromise({
          try: () =>
            reserved.unsafe(`SET idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`, [], {
              prepare: false,
            }) as unknown as Promise<unknown>,
          catch: (cause) => sqlError(cause, "Failed to SET idle_in_transaction_session_timeout", "reserve"),
        })
        return makeConnection(reserved)
      })

    // Cond 1 (Memo #9 §8.3 Option A — CHOSEN): the acquirer returns the pooled
    // base connection without reserving. postgres-js pools simple statements
    // internally (each .unsafe call checks out a connection from its pool and
    // returns it after the query completes), so there is nothing to release.
    // The SqlClient contract runs the acquirer under Effect.scoped
    // (Statement.ts:1314); returning Effect.succeed(connection) means the
    // scope closes immediately with no finalizer needed — no leak.
    //
    // The previous implementation called native.reserve() here and returned
    // makeConnection(reserved) with NO release wiring — every statement
    // permanently held one pool connection (proven: 9th statement stalled
    // with poolMax=8). Option A avoids per-statement reserve/release churn
    // entirely.
    const acquirer = Effect.succeed(connection)

    // Cond 1 (Memo #9 §8.3 Option A): the transactionAcquirer reserves a
    // connection and adds reserved.release() as a finalizer on the AMBIENT
    // scope (mirroring sqlite.bun.ts:123-130). makeWithTransaction provides
    // its own scope to this acquirer (SqlClient.ts:159-160) and closes it at
    // tx end (line 284) — the finalizer runs there, releasing the connection.
    //
    // The previous implementation created a DETACHED Scope.make() that
    // makeWithTransaction never closed — the finalizer never ran, leaking
    // one connection per transaction and per client.reserve (incl. the
    // migration seam). Reading the ambient scope via the current fiber's
    // context (sqlite.bun.ts:125 pattern) is the correct wiring.
    const transactionAcquirer = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const fiber = Fiber.getCurrent()!
        const scope = Context.getUnsafe(fiber.context, Scope.Scope)
        const reserved = yield* restore(
          Effect.tryPromise({
            try: () => native.reserve(),
            catch: (cause) => sqlError(cause, "Failed to reserve transaction connection", "reserve"),
          }),
        )
        yield* Scope.addFinalizer(scope, Effect.sync(() => reserved.release()))
        return yield* makeReservedConnection(reserved)
      }),
    )

    const client = Object.assign(
      yield* Client.make({
        acquirer,
        transactionAcquirer,
        compiler,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "postgresql"],
        ],
        transformRows,
      }),
      {
        [TypeId]: TypeId,
        config: options,
      },
    ) as PgClient

    return client
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Pg.Native,
    Effect.gen(function* () {
      // Decision #12: pool max ≈ min(1.5 × concurrent sessions, 12).
      // The session-count source is not yet wired (Step 6+ CLI/config
      // knob). Default 8 is a documented placeholder — it covers a
      // single-process staging deployment with a handful of concurrent
      // sessions. When the session-count wiring lands, this default will
      // be replaced by the computed value.
      const max = config.maxConnections ?? 8
      // Memo #10 Cond 4: statement_timeout + idle_in_transaction_session_timeout
      // via postgres-js connection config so ALL pooled connections carry
      // timeouts (not just reserved ones). The per-reserved-connection SETs
      // in makeReservedConnection remain as belt-and-braces.
      const statementTimeoutMs = config.statementTimeoutMs ?? 30_000
      const idleInTxTimeoutMs = config.idleInTransactionSessionTimeoutMs ?? 60_000
      const sql = postgres(config.url, {
        max,
        idle_timeout: config.idleTimeoutSeconds,
        connect_timeout: config.connectTimeoutSeconds ?? 10,
        prepare: config.prepare ?? false,
        onnotice: () => {},
        connection: {
          // Memo #10 Cond 4: apply timeouts at the connection level so
          // every pooled connection inherits them. This is the primary
          // timeout mechanism; the SETs in makeReservedConnection are
          // belt-and-braces for reserved/transaction connections.
          statement_timeout: statementTimeoutMs,
          idle_in_transaction_session_timeout: idleInTxTimeoutMs,
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => sql.end({ timeout: 5 })))
      return sql
    }),
  )

const pgLayer = (config: Config) => Layer.effect(Client.SqlClient, make(config))

const drizzleLayer = Layer.effect(
  Pg.Drizzle,
  Effect.gen(function* () {
    const db = yield* EffectDrizzlePg.makeWithDefaults()
    return db as Pg.DrizzleClient
  }),
)

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  const pg = pgLayer(config).pipe(Layer.provide(native))
  const drizzle = drizzleLayer.pipe(Layer.provide(pg))
  return Layer.merge(Layer.merge(native, pg), drizzle).pipe(Layer.provide(Reactivity.layer))
}
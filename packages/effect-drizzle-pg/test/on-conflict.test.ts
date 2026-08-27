// FM-26 regression (Memo #13, Condition 2): onConflict emission must produce
// EXACTLY ONE " on conflict " prefix per clause. Also closes FM-25 residual:
// delete .returning() bigint codec coverage (delete.ts:175).
//
// Modelled on test/bigint-codec.test.ts — same layer/run pattern,
// makeWithDefaults({ jit }), default jit.

import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { eq, sql } from "drizzle-orm"
import { bigint, pgTable, text } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzlePg } from "../src"

const counters = pgTable("m13_counters", {
  id: text().primaryKey(),
  n: bigint({ mode: "number" }).notNull(),
})

const databaseUrl = process.env.TEST_DATABASE_URL

const pgLayer = PgClient.layer({ url: Redacted.make(databaseUrl!) })

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(pgLayer)))

const boot = (jit: boolean | undefined) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzlePg.makeWithDefaults({ jit })
    yield* db.run(sql`drop table if exists m13_counters`)
    yield* db.run(sql`create table m13_counters (id text primary key, n bigint not null)`)
    return db
  })

// ── DB-free toSQL() asserts ──

test("toSQL: onConflictDoNothing without target contains exactly one ' on conflict '", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzlePg.makeWithDefaults()
      const q = db.insert(counters).values({ id: "x", n: 1 }).onConflictDoNothing()
      const { sql: sqlText } = q.toSQL()
      const matches = (sqlText.match(/ on conflict /g) ?? []).length
      expect(matches).toBe(1)
    }),
  )
})

test("toSQL: onConflictDoNothing with target contains exactly one ' on conflict ' and a parenthesized target", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzlePg.makeWithDefaults()
      const q = db.insert(counters).values({ id: "x", n: 1 }).onConflictDoNothing({ target: counters.id })
      const { sql: sqlText } = q.toSQL()
      const matches = (sqlText.match(/ on conflict /g) ?? []).length
      expect(matches).toBe(1)
      expect(sqlText).toContain("(")
      expect(sqlText).toContain(")")
    }),
  )
})

test("toSQL: onConflictDoUpdate contains exactly one ' on conflict ' and a parenthesized target", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzlePg.makeWithDefaults()
      const q = db
        .insert(counters)
        .values({ id: "x", n: 1 })
        .onConflictDoUpdate({ target: counters.id, set: { n: 2 } })
      const { sql: sqlText } = q.toSQL()
      const matches = (sqlText.match(/ on conflict /g) ?? []).length
      expect(matches).toBe(1)
      expect(sqlText).toContain("(")
      expect(sqlText).toContain(")")
    }),
  )
})

// ── Live upsert round-trips ──

test("onConflictDoNothing is idempotent (insert twice, count stays 1)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(true)
      yield* db.insert(counters).values({ id: "k1", n: 1 }).onConflictDoNothing()
      yield* db.insert(counters).values({ id: "k1", n: 99 }).onConflictDoNothing()
      const row = yield* db.select().from(counters).where(eq(counters.id, "k1")).get()
      expect(row).toBeDefined()
      expect(row?.n).toBe(1)
    }),
  )
})

test("onConflictDoUpdate actually updates the row", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(true)
      yield* db.insert(counters).values({ id: "k2", n: 1 }).onConflictDoNothing()
      yield* db
        .insert(counters)
        .values({ id: "k2", n: 42 })
        .onConflictDoUpdate({ target: counters.id, set: { n: 42 } })
      const row = yield* db.select().from(counters).where(eq(counters.id, "k2")).get()
      expect(row).toBeDefined()
      expect(row?.n).toBe(42)
    }),
  )
})

// ── FM-25 residual: delete .returning() bigint codec ──

test("delete .returning() round-trips bigint as NUMBER (jit default)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(undefined)
      yield* db.insert(counters).values({ id: "del1", n: 123 })
      const deleted = yield* db
        .delete(counters)
        .where(eq(counters.id, "del1"))
        .returning()
      expect(deleted).toHaveLength(1)
      expect(typeof deleted[0]?.n).toBe("number")
      expect(deleted[0]?.n).toBe(123)
    }),
  )
})

test("delete .returning() round-trips bigint as NUMBER (jit disabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(false)
      yield* db.insert(counters).values({ id: "del2", n: 456 })
      const deleted = yield* db
        .delete(counters)
        .where(eq(counters.id, "del2"))
        .returning()
      expect(deleted).toHaveLength(1)
      expect(typeof deleted[0]?.n).toBe("number")
      expect(deleted[0]?.n).toBe(456)
    }),
  )
})

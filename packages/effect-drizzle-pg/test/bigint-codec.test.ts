// FM-25 regression (Memo #12, B-A / Condition 3b): bigint({mode:"number"})
// must round-trip as a JS NUMBER through both the select path and the
// .returning() path, with jit enabled AND disabled. postgres-js returns
// bigint as STRING; RC2 keeps the decode in the codec registry
// (`genericPgCodecs["bigint:number"].normalize = Number`), not the column.
// The vendored bridge must thread the registry through orderSelectedFields
// + mapResultRow so the codec fires before mapFromDriverValue.

import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { eq, sql } from "drizzle-orm"
import { bigint, pgTable, text } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzlePg } from "../src"

const counters = pgTable("bigint_counters", {
  id: text().primaryKey(),
  count: bigint({ mode: "number" }).notNull(),
})

const databaseUrl = process.env.TEST_DATABASE_URL

const pgLayer = PgClient.layer({ url: Redacted.make(databaseUrl!) })

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(pgLayer)))

const boot = (jit: boolean | undefined) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzlePg.makeWithDefaults({ jit })
    yield* db.run(sql`drop table if exists bigint_counters`)
    yield* db.run(sql`create table bigint_counters (id text primary key, count bigint not null)`)
    return db
  })

const BIG = 9007199254740993 // exceeds Number.MAX_SAFE_INTEGER boundary region but fits in int53

test("bigint mode:number round-trips as NUMBER via select (jit enabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(true)
      yield* db.insert(counters).values({ id: "a", count: 42 })
      const row = yield* db.select().from(counters).where(eq(counters.id, "a")).get()
      expect(row).toBeDefined()
      expect(typeof row?.count).toBe("number")
      expect(row?.count).toBe(42)
    }),
  )
})

test("bigint mode:number round-trips as NUMBER via select (jit disabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(false)
      yield* db.insert(counters).values({ id: "b", count: 99 })
      const row = yield* db.select().from(counters).where(eq(counters.id, "b")).get()
      expect(row).toBeDefined()
      expect(typeof row?.count).toBe("number")
      expect(row?.count).toBe(99)
    }),
  )
})

test("bigint mode:number round-trips as NUMBER via .returning() (jit enabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(true)
      const inserted = yield* db.insert(counters).values({ id: "c", count: BIG }).returning()
      expect(inserted).toHaveLength(1)
      expect(typeof inserted[0]?.count).toBe("number")
      expect(inserted[0]?.count).toBe(BIG)
    }),
  )
})

test("bigint mode:number round-trips as NUMBER via .returning() (jit disabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(false)
      const inserted = yield* db.insert(counters).values({ id: "d", count: BIG }).returning()
      expect(inserted).toHaveLength(1)
      expect(typeof inserted[0]?.count).toBe("number")
      expect(inserted[0]?.count).toBe(BIG)
    }),
  )
})

test("bigint mode:number round-trips as NUMBER via update .returning() (jit enabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(true)
      yield* db.insert(counters).values({ id: "e", count: 1 })
      const updated = yield* db.update(counters).set({ count: 7 }).where(eq(counters.id, "e")).returning()
      expect(updated).toHaveLength(1)
      expect(typeof updated[0]?.count).toBe("number")
      expect(updated[0]?.count).toBe(7)
    }),
  )
})

test("bigint mode:number round-trips as NUMBER via update .returning() (jit disabled)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* boot(false)
      yield* db.insert(counters).values({ id: "f", count: 1 })
      const updated = yield* db.update(counters).set({ count: 8 }).where(eq(counters.id, "f")).returning()
      expect(updated).toHaveLength(1)
      expect(typeof updated[0]?.count).toBe("number")
      expect(updated[0]?.count).toBe(8)
    }),
  )
})
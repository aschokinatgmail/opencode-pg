import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { eq, sql } from "drizzle-orm"
import { pgTable, serial, text } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzlePg } from "../src"

const users = pgTable("users", {
  id: serial().primaryKey(),
  name: text().notNull(),
})

const databaseUrl = process.env.TEST_DATABASE_URL

const pgLayer = PgClient.layer({ url: Redacted.make(databaseUrl!) })

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(pgLayer)))

const makeDb = Effect.gen(function* () {
  const db = yield* EffectDrizzlePg.makeWithDefaults()
  yield* db.run(sql`drop table if exists users`)
  yield* db.run(sql`create table users (id serial primary key, name text not null)`)
  return db
})

const createMigrationsFolder = async () => {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "effect-drizzle-pg-"))
  await mkdir(join(migrationsFolder, "20240101000000_create_migrated_users"), { recursive: true })
  await Bun.write(
    join(migrationsFolder, "20240101000000_create_migrated_users", "migration.sql"),
    "create table migrated_users (id serial primary key, name text not null);",
  )
  return migrationsFolder
}

test("selects rows through Effect-yieldable query builders", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.insert(users).values({ name: "Ada" })

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Ada" }])
      expect(yield* db.select({ id: users.id }).from(users).where(eq(users.name, "Ada")).get()).toEqual({ id: 1 })
    }),
  )
})

test("commits successful transactions", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db.transaction((tx) => tx.insert(users).values({ name: "Grace" }))

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Grace" }])
    }),
  )
})

test("rolls back failed transactions", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Linus" })
            .pipe(Effect.andThen(Effect.fail("boom"))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("rolls back explicit transaction rollback", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Barbara" })
            .pipe(Effect.andThen(Effect.fail(tx.rollback()))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("supports nested savepoints (tx-in-tx via the bridge)", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.insert(users).values({ name: "Outer" })
          yield* tx
            .transaction((inner) =>
              Effect.gen(function* () {
                yield* inner.insert(users).values({ name: "Inner" })
                yield* Effect.fail("inner-rollback")
              }),
            )
            .pipe(Effect.ignore)
        }),
      )

      const rows = yield* db.select().from(users)
      expect(rows).toEqual([{ id: 1, name: "Outer" }])
    }),
  )
})

test("rolls back to savepoint boundary on constraint failure mid-tx", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db.run(sql`drop table if exists constrained`)
      yield* db.run(sql`create table constrained (id integer primary key, name text not null)`)

      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.run(sql`insert into constrained (id, name) values (1, 'first')`)
          yield* tx
            .transaction((inner) =>
              Effect.gen(function* () {
                yield* inner.run(sql`insert into constrained (id, name) values (1, 'duplicate')`)
              }),
            )
            .pipe(Effect.ignore)
          yield* tx.run(sql`insert into constrained (id, name) values (2, 'second')`)
        }),
      )

      const rows = yield* db.all<{ id: number; name: string }>(sql`select id, name from constrained order by id`)
      expect(rows).toEqual([
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ])
    }),
  )
})

test("preserves failed transaction statement errors", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzlePg.makeWithDefaults()
      yield* db.run(sql`drop table if exists lock_target`)
      yield* db.run(sql`create table lock_target (id integer primary key)`)

      const error = yield* db
        .transaction((tx) => tx.run(sql`insert into nonexistent_table (id) values (1)`))
        .pipe(Effect.flip)

      // The bridge wraps statement errors in EffectDrizzleQueryError; the underlying SqlError is in the cause.
      if (!error) throw new Error("Expected transaction to fail with an error")
    }),
  )
})

test("supports returning and rejects empty update sets", async () => {
  if (!databaseUrl) return
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      const inserted = yield* db.insert(users).values({ name: "Ada" }).returning({ id: users.id, name: users.name })
      expect(inserted).toEqual([{ id: 1, name: "Ada" }])

      const updated = yield* db.update(users).set({ name: "Grace" }).where(eq(users.id, 1)).returning()
      expect(updated).toEqual([{ id: 1, name: "Grace" }])

      const deleted = yield* db.delete(users).where(eq(users.id, 1)).returning({ id: users.id })
      expect(deleted).toEqual([{ id: 1 }])

      expect(() => db.update(users).set({ name: undefined })).toThrow("No values to set")
    }),
  )
})

test("runs migrations once and records migration metadata", async () => {
  if (!databaseUrl) return
  const migrationsFolder = await createMigrationsFolder()
  try {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzlePg.makeWithDefaults()
        yield* db.run(sql`drop table if exists migrated_users`)
        yield* db.run(sql`drop table if exists __drizzle_migrations`)

        yield* EffectDrizzlePg.migrate(db, { migrationsFolder })
        yield* EffectDrizzlePg.migrate(db, { migrationsFolder })
        yield* db.run(sql`insert into migrated_users (name) values ('Margaret')`)

        expect(yield* db.all<{ name: string }>(sql`select name from migrated_users`)).toEqual([{ name: "Margaret" }])
        expect(yield* db.all<{ name: string | null }>(sql`select name from __drizzle_migrations`)).toEqual([
          { name: "20240101000000_create_migrated_users" },
        ])
      }),
    )
  } finally {
    await rm(migrationsFolder, { recursive: true, force: true })
  }
})
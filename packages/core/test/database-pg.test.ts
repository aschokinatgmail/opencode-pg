import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "#pg"
import * as DatabaseMigrationPg from "@opencode-ai/core/database/migration.pg"
import { fileURLToPath } from "url"
import { dirname, join, resolve } from "path"
import { mkdir, rm, writeFile } from "fs/promises"

const databaseUrl = process.env.TEST_DATABASE_URL
const TEST_TIMEOUT = 30_000

const run = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(pgLayer({ url: databaseUrl! }))) as Effect.Effect<A, E, never>,
  )

// Cond 1 (Memo #9 §8.3) regression test harness: a layer with a small pool
// max so the test can run MORE than poolMax operations and prove no leak.
const POOL_MAX = 2
const runSmallPool = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(pgLayer({ url: databaseUrl!, maxConnections: POOL_MAX })),
    ) as Effect.Effect<A, E, never>,
  )

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.opencode/db-migrations",
)

const FAKE_MIGRATION_ID = "0001_test_marker"
const FAKE_MIGRATION_PATH = join(migrationsDir, `${FAKE_MIGRATION_ID}.sql`)
const FAKE_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS "test_marker" (id text PRIMARY KEY);`

async function cleanupFakeMigration() {
  await rm(FAKE_MIGRATION_PATH, { force: true })
}

async function resetSchema() {
  await run(
    Effect.gen(function* () {
      const client = yield* Client.SqlClient
      yield* client.unsafe("DROP SCHEMA public CASCADE").withoutTransform
      yield* client.unsafe("CREATE SCHEMA public").withoutTransform
    }),
  )
}

describe("PG database layer boot", () => {
  test("boots and SELECT 1 via the SqlClient bridge", async () => {
    if (!databaseUrl) return
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        const rows = yield* client.unsafe("SELECT 1 as value").withoutTransform
        expect(rows).toEqual([{ value: 1 }])
      }),
    )
  }, TEST_TIMEOUT)

  test("round-trips an insert/select via raw SqlClient", async () => {
    if (!databaseUrl) return
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* client.unsafe("DROP TABLE IF EXISTS pg_boot_probe").withoutTransform
        yield* client.unsafe("CREATE TABLE pg_boot_probe (id serial PRIMARY KEY, label text NOT NULL)").withoutTransform
        yield* client.unsafe("INSERT INTO pg_boot_probe (label) VALUES ('boot')").withoutTransform
        const rows = yield* client.unsafe("SELECT label FROM pg_boot_probe WHERE label = 'boot'").withoutTransform
        expect(rows).toHaveLength(1)
        expect((rows[0] as Record<string, unknown>)?.label).toBe("boot")
        yield* client.unsafe("DROP TABLE pg_boot_probe").withoutTransform
      }),
    )
  }, TEST_TIMEOUT)

  test("migration seam applies 0000_init.sql under advisory lock", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        const tables = yield* client.unsafe(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'session'",
        ).withoutTransform
        expect(tables.length).toBe(1)

        const partitions = yield* client.unsafe(
          "SELECT count(*)::int AS count FROM pg_inherits WHERE inhparent = 'event'::regclass",
        ).withoutTransform
        expect((partitions[0] as Record<string, number>)?.count).toBe(16)
      }),
    )
  }, TEST_TIMEOUT)
})

describe("PG migration runner", () => {
  test("fresh DB boot applies 0000_init and journals it", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        const sessionTable = yield* client.unsafe(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'session'",
        ).withoutTransform
        expect(sessionTable.length).toBe(1)

        const journal = yield* client.unsafe(
          `SELECT id FROM "migration" WHERE id = '0000_init'`,
        ).withoutTransform
        expect(journal.length).toBe(1)
        expect((journal[0] as Record<string, string>)?.id).toBe("0000_init")
      }),
    )
  }, TEST_TIMEOUT)

  test("second boot is a no-op — journal intact, no duplicate", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)
      }),
    )
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        const journalRows = yield* client.unsafe(`SELECT id FROM "migration" WHERE id = '0000_init'`).withoutTransform
        expect(journalRows.length).toBe(1)
      }),
    )
  }, TEST_TIMEOUT)

  test("fake numbered migration is applied on next boot and journaled", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)
      }),
    )
    await mkdir(migrationsDir, { recursive: true })
    await writeFile(FAKE_MIGRATION_PATH, FAKE_MIGRATION_SQL, "utf-8")
    try {
      await run(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          yield* DatabaseMigrationPg.apply(client)

          const markerTable = yield* client.unsafe(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'test_marker'",
          ).withoutTransform
          expect(markerTable.length).toBe(1)

          const journal = yield* client.unsafe(
            `SELECT id FROM "migration" WHERE id = '${FAKE_MIGRATION_ID}'`,
          ).withoutTransform
          expect(journal.length).toBe(1)
        }),
      )
    } finally {
      await cleanupFakeMigration()
    }
  }, TEST_TIMEOUT)

  test("concurrent boot race — exactly one applies 0000_init, other no-ops", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    const results = await Promise.all([
      run(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          yield* DatabaseMigrationPg.apply(client)
        }),
      ),
      run(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          yield* DatabaseMigrationPg.apply(client)
        }),
      ),
    ])
    expect(results).toHaveLength(2)
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        const journalRows = yield* client.unsafe(`SELECT id FROM "migration" WHERE id = '0000_init'`).withoutTransform
        expect(journalRows.length).toBe(1)

        const sessionTable = yield* client.unsafe(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'session'",
        ).withoutTransform
        expect(sessionTable.length).toBe(1)
      }),
    )
  }, TEST_TIMEOUT)

  // Cond 1 (Memo #10): failed numbered migration must not poison the pooled
  // connection. Regression for FM-22 — the old Effect.try-wrapped ROLLBACK
  // never executed, leaving the reserved connection in an aborted transaction.
  test("failed numbered migration does not poison pooled connection", async () => {
    if (!databaseUrl) return
    const FAIL_MIGRATION_ID = "0001_fail_test"
    const FAIL_MIGRATION_PATH = join(migrationsDir, `${FAIL_MIGRATION_ID}.sql`)
    const FAIL_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS "fail_probe" (id text PRIMARY KEY);\nTHIS IS NOT SQL;`

    await rm(FAIL_MIGRATION_PATH, { force: true })
    await cleanupFakeMigration()
    await resetSchema()

    // Use ONE shared layer with maxConnections=1 so the follow-up statement
    // rides the same connection that the failed migration reserved.
    const layer = pgLayer({ url: databaseUrl!, maxConnections: 1 })

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)
      }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
    )

    await mkdir(migrationsDir, { recursive: true })
    await writeFile(FAIL_MIGRATION_PATH, FAIL_MIGRATION_SQL, "utf-8")

    try {
      let applyError: unknown
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* Client.SqlClient
            yield* DatabaseMigrationPg.apply(client)
          }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
        )
      } catch (e) {
        applyError = e
      }
      expect(applyError).toBeDefined()

      // Follow-up on the SAME layer must succeed (no 25P02 poisoning).
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const rows = yield* client.unsafe("SELECT 1 as value").withoutTransform
          expect((rows[0] as Record<string, number>)?.value).toBe(1)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )

      // Failed migration absent from journal; 0000_init still present.
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const failJournal = yield* client.unsafe(
            `SELECT id FROM "migration" WHERE id = '${FAIL_MIGRATION_ID}'`,
          ).withoutTransform
          expect(failJournal.length).toBe(0)

          const initJournal = yield* client.unsafe(
            `SELECT id FROM "migration" WHERE id = '0000_init'`,
          ).withoutTransform
          expect(initJournal.length).toBe(1)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )
    } finally {
      await rm(FAIL_MIGRATION_PATH, { force: true })
    }
  }, TEST_TIMEOUT)
})

// Cond 1 (Memo #9 §8.3) regression: proves the acquirer rewrite cannot leak
// reserved connections. ONE layer, pool max = 2. Runs MORE than poolMax
// plain statements AND more than poolMax sequential transactions AND one
// concurrent pair of transactions — all must complete without hanging.
// The previous implementation (native.reserve() with no release) stalled
// on statement #9 with poolMax=8; this test fails fast via Effect.timeout
// if the leak regresses.
describe("PG pool lifecycle — no connection leak (Cond 1, Memo #9 §8.3)", () => {
  const FAIL_FAST_TIMEOUT = "30 seconds"

  test("completes > poolMax plain statements without hanging — proves acquirer does not leak", async () => {
    if (!databaseUrl) return
    const statementCount = POOL_MAX + 5
    await runSmallPool(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        for (let i = 0; i < statementCount; i++) {
          const rows = yield* client.unsafe(`SELECT ${i} as value`).withoutTransform
          expect((rows[0] as Record<string, number>)?.value).toBe(i)
        }
      }).pipe(Effect.timeout(FAIL_FAST_TIMEOUT)),
    )
  }, TEST_TIMEOUT)

  test("completes > poolMax sequential transactions without hanging — proves transactionAcquirer releases", async () => {
    if (!databaseUrl) return
    const txCount = POOL_MAX + 3
    await runSmallPool(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        for (let i = 0; i < txCount; i++) {
          yield* client.withTransaction(
            Effect.gen(function* () {
              const rows = yield* client.unsafe(`SELECT ${i} as value`).withoutTransform
              expect((rows[0] as Record<string, number>)?.value).toBe(i)
            }),
          )
        }
      }).pipe(Effect.timeout(FAIL_FAST_TIMEOUT)),
    )
  }, TEST_TIMEOUT)

  test("completes a concurrent pair of transactions without hanging — proves concurrent reserve/release", async () => {
    if (!databaseUrl) return
    await runSmallPool(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        // Two transactions running concurrently each hold a reserved
        // connection. With poolMax=2 this saturates the pool; if either
        // leaks, subsequent operations stall.
        const [a, b] = yield* Effect.all([
          client.withTransaction(
            Effect.gen(function* () {
              const rows = yield* client.unsafe("SELECT 1 as value").withoutTransform
              return (rows[0] as Record<string, number>)?.value
            }),
          ),
          client.withTransaction(
            Effect.gen(function* () {
              const rows = yield* client.unsafe("SELECT 2 as value").withoutTransform
              return (rows[0] as Record<string, number>)?.value
            }),
          ),
        ])
        expect(a).toBe(1)
        expect(b).toBe(2)
        // After both transactions complete, the pool must be fully
        // released — this statement would stall if either leaked.
        const rows = yield* client.unsafe("SELECT 3 as value").withoutTransform
        expect((rows[0] as Record<string, number>)?.value).toBe(3)
      }).pipe(Effect.timeout(FAIL_FAST_TIMEOUT)),
    )
  }, TEST_TIMEOUT)
})

// Memo #8 Cond 1: automated test for the commit-time deferred-constraint
// failure path. This is the ONLY path where PG/SQLite semantics genuinely
// diverge: a UNIQUE ... DEFERRABLE INITIALLY DEFERRED constraint allows a
// duplicate insert to SUCCEED inside the transaction, but COMMIT must FAIL
// with the constraint error (23505). The bridge's withTransaction must:
// (a) propagate the COMMIT failure as a SqlError;
// (b) leave the connection usable (PG auto-terminates the tx; the bridge's
//     follow-up ROLLBACK is a warning-only no-op — FM-17);
// (c) nothing persisted (the duplicate and the original are both rolled back).
// Empirically verified manually in Memo #8 §7.1; this is the automated form.
describe("PG deferred-constraint commit failure (Memo #8 Cond 1, FM-17)", () => {
  test("DEFERRABLE INITIALLY DEFERRED: dup insert succeeds in-tx, COMMIT fails, connection usable, nothing persisted", async () => {
    if (!databaseUrl) return
    // Use a single shared layer with maxConnections=1 so the follow-up
    // statement rides the SAME connection that the failed commit left behind.
    const layer = pgLayer({ url: databaseUrl!, maxConnections: 1 })

    // Setup: create a table with a DEFERRABLE INITIALLY DEFERRED unique constraint.
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* client.unsafe("DROP TABLE IF EXISTS deferred_probe").withoutTransform
        yield* client.unsafe(
          `CREATE TABLE deferred_probe (
            id text PRIMARY KEY,
            label text NOT NULL,
            CONSTRAINT deferred_probe_label_unique UNIQUE (label) DEFERRABLE INITIALLY DEFERRED
          )`,
        ).withoutTransform
      }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
    )

    try {
      // The deferred-constraint failure path: insert a row, then a duplicate
      // label inside the SAME transaction. The duplicate SUCCEEDS (constraint
      // is deferred). COMMIT must FAIL with 23505.
      let commitError: unknown
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* Client.SqlClient
            yield* client.withTransaction(
              Effect.gen(function* () {
                yield* client
                  .unsafe("INSERT INTO deferred_probe (id, label) VALUES ('r1', 'dup')")
                  .withoutTransform
                // Duplicate label — SUCCEEDS because the constraint is deferred.
                yield* client
                  .unsafe("INSERT INTO deferred_probe (id, label) VALUES ('r2', 'dup')")
                  .withoutTransform
              }),
            )
          }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
        )
      } catch (e) {
        commitError = e
      }

      // COMMIT must have failed with the constraint error.
      expect(commitError).toBeDefined()
      const pgError = (commitError as { reason?: { cause?: { code?: string; constraint_name?: string } } })
        .reason?.cause
      expect(pgError?.code).toBe("23505")
      expect(pgError?.constraint_name).toBe("deferred_probe_label_unique")

      // FM-17: connection must remain usable after the failed commit.
      // The bridge's follow-up ROLLBACK is a warning-only no-op (PG already
      // terminated the tx). This statement on the SAME layer must succeed.
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const rows = yield* client.unsafe("SELECT 1 as value").withoutTransform
          expect((rows[0] as Record<string, number>)?.value).toBe(1)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )

      // Nothing persisted: both rows were rolled back.
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const rows = yield* client
            .unsafe("SELECT count(*)::int AS count FROM deferred_probe")
            .withoutTransform
          expect((rows[0] as Record<string, number>)?.count).toBe(0)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )
    } finally {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          yield* client.unsafe("DROP TABLE IF EXISTS deferred_probe").withoutTransform
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      ).catch(() => {})
    }
  }, TEST_TIMEOUT)

  // Control: a NON-deferred unique constraint fails at the INSERT statement,
  // not at COMMIT. This proves the deferred constraint's in-tx success is
  // the divergent behavior (not just any unique violation).
  test("NON-deferred UNIQUE: duplicate insert fails immediately (control for the deferred path)", async () => {
    if (!databaseUrl) return
    const layer = pgLayer({ url: databaseUrl!, maxConnections: 1 })

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* client.unsafe("DROP TABLE IF EXISTS immediate_probe").withoutTransform
        yield* client.unsafe(
          `CREATE TABLE immediate_probe (
            id text PRIMARY KEY,
            label text NOT NULL,
            CONSTRAINT immediate_probe_label_unique UNIQUE (label)
          )`,
        ).withoutTransform
      }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
    )

    try {
      let insertError: unknown
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* Client.SqlClient
            yield* client.withTransaction(
              Effect.gen(function* () {
                yield* client
                  .unsafe("INSERT INTO immediate_probe (id, label) VALUES ('r1', 'dup')")
                  .withoutTransform
                // Non-deferred: this INSERT fails immediately (not at COMMIT).
                yield* client
                  .unsafe("INSERT INTO immediate_probe (id, label) VALUES ('r2', 'dup')")
                  .withoutTransform
              }),
            )
          }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
        )
      } catch (e) {
        insertError = e
      }

      expect(insertError).toBeDefined()
      const pgError = (insertError as { reason?: { cause?: { code?: string; constraint_name?: string } } })
        .reason?.cause
      expect(pgError?.code).toBe("23505")
      expect(pgError?.constraint_name).toBe("immediate_probe_label_unique")

      // Connection usable after the failure.
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const rows = yield* client.unsafe("SELECT 1 as value").withoutTransform
          expect((rows[0] as Record<string, number>)?.value).toBe(1)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )

      // Nothing persisted.
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          const rows = yield* client
            .unsafe("SELECT count(*)::int AS count FROM immediate_probe")
            .withoutTransform
          expect((rows[0] as Record<string, number>)?.count).toBe(0)
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      )
    } finally {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* Client.SqlClient
          yield* client.unsafe("DROP TABLE IF EXISTS immediate_probe").withoutTransform
        }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
      ).catch(() => {})
    }
  }, TEST_TIMEOUT)
})

// PART 4 step 4: partition-pruning EXPLAIN assert. The event log is HASH
// partitioned on aggregate_id into 16 partitions. A query constrained to a
// single aggregate_id must prune to exactly 1 partition; the unconstrained
// query must scan all 16. Non-vacuity: events exist, partitions exist.
describe("PG partition pruning — EXPLAIN assert (PART 4 step 4)", () => {
  test("aggregate_id-constrained query prunes to 1 partition; unconstrained scans all 16", async () => {
    if (!databaseUrl) return
    await cleanupFakeMigration()
    await resetSchema()
    const layer = pgLayer({ url: databaseUrl!, maxConnections: 1 })

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        // Non-vacuity: prove 16 partitions exist.
        const partitionCount = yield* client.unsafe(
          "SELECT count(*)::int AS count FROM pg_inherits WHERE inhparent = 'event'::regclass",
        ).withoutTransform
        expect((partitionCount[0] as Record<string, number>)?.count).toBe(16)

        // Insert events for 3 different aggregate_ids (hash to different partitions).
        const aggregates = ["ses_pruning_a", "ses_pruning_b", "ses_pruning_c"]
        for (const id of aggregates) {
          yield* client
            .unsafe(`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('${id}', -1) ON CONFLICT DO NOTHING`)
            .withoutTransform
          for (let seq = 0; seq < 3; seq++) {
            yield* client
              .unsafe(
                `INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_${id}_${seq}', '${id}', ${seq}, 'test', '{}')`,
              )
              .withoutTransform
          }
        }

        // Non-vacuity: prove events landed (9 rows across 3 aggregates).
        const eventCount = yield* client
          .unsafe("SELECT count(*)::int AS count FROM event")
          .withoutTransform
        expect((eventCount[0] as Record<string, number>)?.count).toBe(9)

        // EXPLAIN the constrained query — must prune to 1 partition.
        const constrainedPlan = yield* client
          .unsafe(
            "EXPLAIN (FORMAT TEXT) SELECT * FROM event WHERE aggregate_id = 'ses_pruning_a' AND seq > 0 ORDER BY seq",
          )
          .withoutTransform
        const constrainedLines = (constrainedPlan as Array<{ "QUERY PLAN": string }>).map(
          (r) => r["QUERY PLAN"],
        )
        const constrainedPlanText = constrainedLines.join("\n")

        // The constrained plan must reference exactly ONE event_pXX partition
        // (not an Append over multiple partitions).
        const constrainedPartitionRefs = constrainedLines.filter((l) =>
          l.match(/event_p\d+/),
        )
        expect(constrainedPartitionRefs.length).toBe(1)
        // No Append node in the constrained plan (Append = multi-partition scan).
        expect(constrainedPlanText).not.toContain("Append")

        // EXPLAIN the unconstrained query — must scan all 16 partitions.
        const unconstrainedPlan = yield* client
          .unsafe("EXPLAIN (FORMAT TEXT) SELECT * FROM event WHERE seq > 0 ORDER BY seq")
          .withoutTransform
        const unconstrainedLines = (unconstrainedPlan as Array<{ "QUERY PLAN": string }>).map(
          (r) => r["QUERY PLAN"],
        )
        const unconstrainedPlanText = unconstrainedLines.join("\n")

        // The unconstrained plan must reference all 16 partitions via Append.
        expect(unconstrainedPlanText).toContain("Append")
        const unconstrainedPartitionRefs = unconstrainedLines.filter((l) =>
          l.match(/event_p\d+/),
        )
        expect(unconstrainedPartitionRefs.length).toBe(16)

        // The plans differ — pruning is active, not decorative.
        expect(constrainedPlanText).not.toEqual(unconstrainedPlanText)
      }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
    )
  }, TEST_TIMEOUT)
})
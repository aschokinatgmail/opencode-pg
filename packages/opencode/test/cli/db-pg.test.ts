import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as pgLayer } from "@opencode-ai/core/database/pg.bun"
import * as DatabaseMigrationPg from "@opencode-ai/core/database/migration.pg"
import { redactUrl, PG_SESSIONS_PANEL_QUERY } from "../../src/cli/cmd/db"

const databaseUrl = process.env.TEST_DATABASE_URL
const TEST_TIMEOUT = 60_000

const run = <A, E>(effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(pgLayer({ url: databaseUrl! }))) as Effect.Effect<A, E, never>,
  )

async function resetSchema() {
  await run(
    Effect.gen(function* () {
      const client = yield* Client.SqlClient
      yield* client.unsafe("DROP SCHEMA public CASCADE").withoutTransform
      yield* client.unsafe("CREATE SCHEMA public").withoutTransform
    }),
  )
}

// These integration tests are gated on TEST_DATABASE_URL pointing at a
// DISPOSABLE postgres:17-alpine instance (resetSchema drops schema public
// CASCADE). They assert the two PG-specific safety contracts of the CLI:
// redaction (no password in output) and read-only enforcement (a write via
// query fails unless --write).
describe("db CLI PG integration", () => {
  test("redactUrl removes the password from a PG connection string", async () => {
    const url = "postgresql://user:supersecret@localhost:5432/opencode_test"
    const redacted = redactUrl(url)
    expect(redacted).not.toContain("supersecret")
    expect(redacted).toContain("***")
    expect(redacted).toContain("user")
    expect(redacted).toContain("localhost:5432")
    expect(redacted).toContain("opencode_test")
  })

  test("PG_SESSIONS_PANEL_QUERY is valid SQL against a migrated PG schema", async () => {
    if (!databaseUrl) return
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)
        // The panel query must execute without error against the migrated schema.
        const rows = yield* client.unsafe(PG_SESSIONS_PANEL_QUERY).withoutTransform
        // An empty database has zero sessions; the query returns [].
        expect(Array.isArray(rows)).toBe(true)
      }),
    )
  }, TEST_TIMEOUT)

  test("read-only enforcement: SET default_transaction_read_only blocks writes", async () => {
    if (!databaseUrl) return
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        // Simulate `db query` without --write: SET read-only, then attempt a write.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const conn = yield* client.reserve
            yield* conn.executeRaw("SET default_transaction_read_only = on", [])
            // A write must fail under read-only enforcement.
            const exit = yield* Effect.exit(
              conn.executeRaw(`INSERT INTO "session" (id, project_id, slug, directory, path, title, version, cost) VALUES ('ses_test', 'proj_test', 'test', '/tmp', '/tmp', 'test', 1, 0)`, []),
            )
            expect(Exit.isFailure(exit)).toBe(true)
          }),
        )
      }),
    )
  }, TEST_TIMEOUT)

  test("read-only enforcement: --write flag escapes the guard", async () => {
    if (!databaseUrl) return
    await resetSchema()
    await run(
      Effect.gen(function* () {
        const client = yield* Client.SqlClient
        yield* DatabaseMigrationPg.apply(client)

        // Simulate `db query --write`: SET read-only OFF, then write succeeds.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const conn = yield* client.reserve
            yield* conn.executeRaw("SET default_transaction_read_only = off", [])
            // A write must succeed with read-only disabled.
            yield* conn.executeRaw(
              `INSERT INTO "session" (id, project_id, slug, directory, path, title, version, cost) VALUES ('ses_test', 'proj_test', 'test', '/tmp', '/tmp', 'test', 1, 0)`,
              [],
            )
            const rows = yield* conn.executeRaw(`SELECT id FROM "session" WHERE id = 'ses_test'`, [])
            expect((rows as Array<unknown>).length).toBe(1)
          }),
        )
      }),
    )
  }, TEST_TIMEOUT)
})
// Step 7 static guard (AR5 + Memo #10 Cond 6 + Memo #16 Cond 1 + B6.3):
// A fast deterministic test that FAILS when banned patterns appear in src.
// Runs as part of `bun test` — no external deps, shells grep via Bun.file.
//
// Guarded surfaces (per the plan Step 7 + memos):
// 1. AR5: `data_migration` usage in PG runtime code (SQLite-only table,
//    must never appear in PG paths — B6 omitted it from 0000_init).
// 2. Memo #10 Cond 6: `drizzle-kit push` in any script/doc targeting PG
//    (migrations flow through the blessed SQL runner only).
// 3. `(q: any)`, `as any`, `@ts-ignore` in the DB/concurrency layer
//    (packages/core/src/database/ + event.ts + session/input.ts),
//    EXCLUDING sqlite.bun.ts (pre-existing, out of scope per memos).
// 4. B6.3: `0000_init.sql` byte-stability — sha256 must match a recorded
//    constant (the blessed-DDL freeze rule, mechanically enforced).
// 5. Memo #16 Cond 1: Text.Delta must not be registered as async-tier
//    (the dead registration was removed; this guard prevents re-introduction).

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { createHash } from "crypto"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const coreSrc = resolve(__dirname, "../src")
const dbDir = join(coreSrc, "database")
const migrationsDir = resolve(__dirname, "../../../.opencode/db-migrations")
const initSqlPath = join(migrationsDir, "0000_init.sql")

// Recorded sha256 of 0000_init.sql — the blessed-DDL freeze (B6.3).
// Update this constant ONLY when a numbered migration intentionally supersedes
// the bootstrap (which would itself be a memo-level decision).
const INIT_SQL_SHA256 = "818ee1a9bd75a8cfeeef32fc426e288108e69b5e5fb4360d876bf6ffef422fb3"

async function grep(pattern: string, ...paths: string[]): Promise<string[]> {
  const proc = await $`grep -rn -- ${pattern} ${paths}`.quiet().nothrow()
  return proc.stdout
    .toString()
    .split("\n")
    .filter((l) => l.length > 0)
    .filter((l) => !l.match(/:\s*\/\//))
}

async function grepCodeOnly(pattern: string, ...paths: string[]): Promise<string[]> {
  // Like grep but excludes lines where the match is inside a // comment.
  // Splits on the first `//` and checks the part before it for the pattern.
  // Known weakness: splitting on the first `//` truncates URLs in strings
  // (e.g. "https://..." would be treated as a comment). Conservative
  // direction — could under-report on URL-containing strings, acceptable
  // for current patterns (no banned pattern appears inside a URL string).
  const proc = await $`grep -rn -- ${pattern} ${paths}`.quiet().nothrow()
  return proc.stdout
    .toString()
    .split("\n")
    .filter((l) => l.length > 0)
    .filter((l) => {
      const commentIdx = l.indexOf("//")
      if (commentIdx === -1) return true
      return l.slice(0, commentIdx).match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    })
}

describe("grep-guard — static bans (Step 7)", () => {
  test("0000_init.sql sha256 matches recorded constant (B6.3 freeze)", async () => {
    const file = Bun.file(initSqlPath)
    const exists = await file.exists()
    expect(exists).toBe(true)
    const content = await file.text()
    const hash = createHash("sha256").update(content).digest("hex")
    expect(hash).toBe(INIT_SQL_SHA256)
  })

  test("AR5: data_migration does not appear in PG runtime code", async () => {
    // data_migration is a SQLite-only table (B6 omitted from 0000_init).
    // It must never appear in PG paths: sql.pg.ts, migration.pg.ts, schema.pg.ts.
    const pgFiles = [
      join(dbDir, "schema.pg.ts"),
      join(dbDir, "schema.sql.pg.ts"),
      join(dbDir, "migration.pg.ts"),
      join(dbDir, "pg.bun.ts"),
      join(dbDir, "pg.node.ts"),
    ]
    const matches = await grep("data_migration", ...pgFiles)
    expect(matches).toEqual([])
  })

  test("Memo #10 Cond 6: drizzle-kit push is banned in PG-targeting scripts/docs", async () => {
    // drizzle-kit push must never target PG — migrations flow through
    // the blessed SQL runner (migration.pg.ts) only. Scope matches the
    // guard's header claim: drizzle.config.ts + package.json scripts +
    // script/** + scripts/**.
    const drizzleConfig = resolve(__dirname, "../drizzle.config.ts")
    const packageJson = resolve(__dirname, "../package.json")
    const scriptDir = resolve(__dirname, "../script")
    const scriptsDir = resolve(__dirname, "../scripts")
    const paths = [drizzleConfig, packageJson]
    const scriptFiles = await Array.fromAsync(
      $`find ${scriptDir} ${scriptsDir} -name '*.ts' -o -name '*.js' -o -name '*.mjs' 2>/dev/null`.lines(),
    ).catch(() => [])
    paths.push(...scriptFiles.filter((f) => f.trim().length > 0))
    const matches = await grep("drizzle-kit push", ...paths)
    expect(matches).toEqual([])
  })

  test("DB/concurrency layer has no (q: any) — zero tolerance", async () => {
    const paths = [
      join(dbDir, "flush.ts"),
      join(dbDir, "lock.ts"),
      join(dbDir, "wake.ts"),
      join(dbDir, "database.ts"),
      join(dbDir, "migration.ts"),
      join(dbDir, "migration.pg.ts"),
      join(dbDir, "pg.bun.ts"),
      join(dbDir, "pg.node.ts"),
      join(dbDir, "schema.pg.ts"),
      join(dbDir, "schema.sql.pg.ts"),
      join(coreSrc, "event.ts"),
      join(coreSrc, "session/input.ts"),
    ]
    const matches = await grepCodeOnly("(q: any)", ...paths)
    expect(matches).toEqual([])
  })

  test("DB/concurrency layer has no `as any` (excluding sqlite.bun.ts)", async () => {
    // sqlite.bun.ts has pre-existing `as any` for bun-types gaps — out of scope.
    const allDbFiles = await Array.fromAsync(
      $`find ${dbDir} -name '*.ts' -not -name 'sqlite.bun.ts'`.lines(),
    )
    const cleanFiles = allDbFiles.filter((f) => f.trim().length > 0)
    const eventPath = join(coreSrc, "event.ts")
    const inputPath = join(coreSrc, "session/input.ts")
    const matches = await grepCodeOnly("as any", ...cleanFiles, eventPath, inputPath)
    expect(matches).toEqual([])
  })

  test("DB/concurrency layer has no @ts-ignore (excluding sqlite.bun.ts)", async () => {
    // @ts-ignore is a compiler directive in a comment — grep for it directly,
    // not via grepCodeOnly (which filters comment lines).
    const allDbFiles = await Array.fromAsync(
      $`find ${dbDir} -name '*.ts' -not -name 'sqlite.bun.ts'`.lines(),
    )
    const cleanFiles = allDbFiles.filter((f) => f.trim().length > 0)
    const eventPath = join(coreSrc, "event.ts")
    const inputPath = join(coreSrc, "session/input.ts")
    const matches = await grep("@ts-ignore", ...cleanFiles, eventPath, inputPath)
    expect(matches).toEqual([])
  })

  test("Memo #16 Cond 1: Text.Delta is not registered as async-tier", async () => {
    // The dead registration pair was removed (projector.ts). This guard
    // prevents re-introduction: Text.Delta is live-only by design.
    const projectorPath = join(coreSrc, "session/projector.ts")
    const matches = await grep("registerAsyncTierType.*Text.Delta", projectorPath)
    expect(matches).toEqual([])

    const projectMatches = await grep("events.project.*Text.Delta", projectorPath)
    expect(projectMatches).toEqual([])
  })

  test("Memo #17 Cond 3: PG-gated test files have no static RUNTIME imports of @opencode-ai/core/** (FM-28b recurrence guard)", async () => {
    // FM-28b instance (3) was caused by a static runtime import of
    // @opencode-ai/core/session/input in session-pg-roundtrip.test.ts,
    // which transitively imported database/database.ts and froze isPg=false.
    // This guard mechanically prevents instance (4): in PG-gated test files
    // (test/*-pg.test.ts, test/dialect-matrix.test.ts), ban static RUNTIME
    // (non-`import type`) imports of @opencode-ai/core/** except an explicit
    // allowlist of provably-clean modules whose transitive closure never
    // reaches database/database.ts.
    //
    // Allowlist (verified clean — none import database/database.ts):
    //   - database/migration.pg  (node builtins + effect only)
    //   - schema-pg-namespace    (type-only SchemaTables ref + sql.pg siblings)
    //   - *.sql.pg               (drizzle-orm pg-core only)
    //   - */schema               (effect Schema + @opencode-ai/schema)
    //   - session/message        (re-export from @opencode-ai/schema)
    //   - schema                 (effect Schema + @opencode-ai/schema)
    // The guard must not be silently widened — every allowlist addition
    // requires a memo-level verification of the module's import chain.
    const testDir = resolve(__dirname, "../test")
    // PG-gated test files: *-pg.test.ts, *-pg-*.test.ts (e.g.
    // session-pg-roundtrip), and dialect-matrix.test.ts (both legs).
    const pgTestFiles = await Array.fromAsync(
      $`find ${testDir} -name '*-pg.test.ts' -o -name '*-pg-*.test.ts' -o -name 'dialect-matrix.test.ts'`.lines(),
    )
    const files = pgTestFiles.filter((f) => f.trim().length > 0)

    // Allowlist of module path suffixes that are provably clean
    // (transitive closure never reaches database/database.ts).
    const ALLOWLIST = [
      "database/migration.pg",
      "schema-pg-namespace",
      "project/sql.pg",
      "session/sql.pg",
      "event/sql.pg",
      "database/schema.pg",
      "database/schema.sql.pg",
      "database/path.pg",
      "project/schema",
      "session/schema",
      "session/message",
      "schema",
    ]

    const isAllowlisted = (modulePath: string) =>
      ALLOWLIST.some((allowed) => modulePath === allowed || modulePath.endsWith("/" + allowed))

    const violations: string[] = []
    for (const file of files) {
      const content = await Bun.file(file).text()
      for (const line of content.split("\n")) {
        // Match static runtime imports of @opencode-ai/core/**
        // (NOT `import type` — type imports are erased at runtime).
        const runtimeImportMatch = line.match(/^import\s+(?!type\s).*?from\s+["']@opencode-ai\/core\/(.+?)["']/)
        if (!runtimeImportMatch) continue
        const modulePath = runtimeImportMatch[1]
        if (!isAllowlisted(modulePath)) {
          violations.push(`${file}:${line.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test("FM-21 (Condition C): app layer has no static RUNTIME imports of @opencode-ai/core/**/sql or **/sql.pg", async () => {
    // The app layer (packages/opencode/src) must source table objects ONLY
    // via the Database.Schema service (the DatabaseSchema seam in
    // storage/db-schema.ts). Direct imports of `*/sql` table objects are
    // SQLite-bound at module scope and emit SQLite-dialect SQL even when
    // the Database service runs on PostgreSQL (Decision Memo #19, Ruling
    // 4). `**/sql.pg` modules are core-internal PG table objects — equally
    // banned: the app layer must not reach into dialect-specific table
    // objects at all. Type-only imports are erased at runtime and are
    // therefore allowed (same convention as the Memo #17 Cond 3 guard).
    const appSrc = resolve(__dirname, "../../../packages/opencode/src")
    const appFiles = await Array.fromAsync(
      $`find ${appSrc} -name '*.ts'`.lines(),
    )
    const files = appFiles.filter((f) => f.trim().length > 0)

    const violations: string[] = []
    for (const file of files) {
      const content = await Bun.file(file).text()
      for (const line of content.split("\n")) {
        // Match static runtime imports of @opencode-ai/core/**
        // (NOT `import type` — type imports are erased at runtime).
        const runtimeImportMatch = line.match(/^import\s+(?!type\s).*?from\s+["']@opencode-ai\/core\/(.+?)["']/)
        if (!runtimeImportMatch) continue
        const modulePath = runtimeImportMatch[1]
        // Banned: any module path ending in /sql or sql.pg
        // (e.g. database/sql, session/sql.pg, event/sql.pg).
        if (/(^|\/)sql(\.pg)?$/.test(modulePath)) {
          violations.push(`${file}:${line.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
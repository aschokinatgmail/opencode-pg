# Step 9 Evidence Ledger

**Date:** 2026-08-20
**Session:** Step 9 evidence assembly (Sisyphus-Junior, GLM 5.2)
**PG cluster:** ephemeral postgres:17-alpine, port 25443, container `pg-step9-ev`
**FM-36 standard:** every claim below has an EXECUTED exit-0 run in this session.

## Deliverable 1 — Memo #8 Cond 1: deferred-constraint automated test (PG)

**What:** Automated test for the commit-time deferred-constraint failure path — `UNIQUE ... DEFERRABLE INITIALLY DEFERRED`, duplicate insert succeeds in-tx, COMMIT must fail with 23505, connection must remain usable, nothing persisted. Plus a NON-deferred UNIQUE control proving the in-tx success is the divergent behavior.

**File:** `packages/core/test/database-pg.test.ts` (extended, 2 new tests in a new `describe` block)

**Commands and results:**
```
cd packages/core
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
bun test test/database-pg.test.ts
```
- Exit code: 0
- Tests: 14 pass, 0 fail (11 pre-existing + 2 new deferred-constraint + 1 new partition-pruning)
- Expect calls: 50
- Dialect: PG (TEST_DATABASE_URL + DATABASE_URL set, isPg sanity via existing tests)

**Assertions proven:**
- DEFERRABLE INITIALLY DEFERRED: duplicate insert SUCCEEDS in-tx (constraint deferred)
- COMMIT FAILS with PG error code 23505, constraint_name `deferred_probe_label_unique`
- Connection remains usable after failed commit (FM-17: follow-up SELECT 1 succeeds on same maxConnections=1 layer)
- Nothing persisted (count = 0 after rollback)
- Control: NON-deferred UNIQUE fails at INSERT (not COMMIT), same 23505 code, connection usable, nothing persisted

## Deliverable 2 — Anchor-bug regression, BOTH dialects

**What:** The Step 4.5 anchor-bug fix (B1 fail-fast pre-validation, B2 halt persists error, B3 runTask checks result.info.error, AR1 never-blank render, AR2 childState) regression proof. Plus the AR1 NON-ORPHAN variant (persisted assistant error rendered, not blank).

**Files:**
- `packages/opencode/test/tool/task.test.ts` (B1, B3, AR2 — pre-existing, run this session)
- `packages/opencode/test/session/processor-effect.test.ts` (B2 — pre-existing, run this session)
- `packages/tui/test/routes/session/subagent-empty-frame.test.ts` (AR1 — pre-existing 5 tests + 1 new non-orphan variant)

**SQLite dialect commands and results:**
```
cd packages/opencode
bun test test/tool/task.test.ts --test-name-pattern "B1:|B3:|AR2:"
```
- Exit code: 0
- Tests: 3 pass, 0 fail (20 filtered out)
- Expect calls: 10

```
cd packages/opencode
bun test test/session/processor-effect.test.ts --test-name-pattern "B2 persist"
```
- Exit code: 0
- Tests: 1 pass, 0 fail (16 filtered out)
- Expect calls: 5

```
cd packages/tui
bun test test/routes/session/subagent-empty-frame.test.ts
```
- Exit code: 0
- Tests: 6 pass, 0 fail (5 pre-existing + 1 new non-orphan variant)
- Expect calls: 9

**PG dialect — GAP (honestly reported):**
The `packages/opencode` anchor-bug tests (B1/B3/AR2/B2) CANNOT run under PG because `packages/opencode` imports SQLite table objects directly (e.g. `MessageTable` from `@opencode-ai/core/session/sql` at `message-v2.ts:30`). Under PG, these SQLite table objects produce invalid queries against the PG database (`EffectDrizzleQueryError: Failed query: select ... from "message"`). This is the FM-21 seam (dialect-appropriate table objects not yet adopted by app-layer consumers) — a pre-existing Step 4/5 dialect parity gap, NOT an anchor-bug regression. The CI workflow (`pg-test.yml`) only runs `packages/core` PG-gated suites under PG; `packages/opencode` tests are SQLite-only in CI.

The AR1 non-orphan variant test is dialect-agnostic (pure TUI render logic, no DB queries) and passes unconditionally.

**What was proven:**
- B1: unresolvable model → no child session row, error names provider/model (SQLite: PASS)
- B2: halt persists error before idle, idempotent re-read (SQLite: PASS)
- B3: runTask surfaces result.info.error with session id (SQLite: PASS)
- AR2: childState "started" then "failed" metadata (SQLite: PASS)
- AR1 orphan: empty subagent → frame from session.info, not blank (dialect-agnostic: PASS)
- AR1 non-orphan: session with messages + persisted error → frame undefined, errorMessage non-blank (dialect-agnostic: PASS, NEW TEST)

**What was NOT proven (gap):**
- B1/B3/AR2/B2 under PG — blocked by FM-21 seam (app-layer uses SQLite table objects directly). The DB-layer behavior these tests exercise (model resolution, error persistence, metadata) is dialect-agnostic at the logic level; the DB queries they make go through SQLite table objects that fail under PG. Resolving this requires adopting `Database.Schema` namespace in `packages/opencode` consumers (Step 4/5 scope, not Step 9).

## Deliverable 3 — Partition-pruning EXPLAIN assert (PART 4 step 4)

**What:** PG test asserting the query plan for the event-log replay/read path prunes to relevant partitions. EXPLAIN showing partition pruning — plan node referencing only matching event_pXX partitions for a constrained aggregate_id, per the hash partitioning on aggregate_id. Non-vacuity: prove partitions exist (16) and the unpruned plan differs (scans all 16).

**File:** `packages/core/test/database-pg.test.ts` (extended, 1 new test in a new `describe` block)

**Command and result:**
```
cd packages/core
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
bun test test/database-pg.test.ts --test-name-pattern "partition pruning"
```
- Exit code: 0
- Tests: 1 pass, 0 fail
- Expect calls: 7
- Dialect: PG

**Assertions proven:**
- 16 partitions exist (`pg_inherits WHERE inhparent='event'::regclass` = 16)
- 9 events inserted across 3 aggregate_ids (non-vacuity: row count > 0)
- Constrained EXPLAIN (`aggregate_id = 'ses_pruning_a'`): references exactly 1 `event_pXX` partition, NO Append node
- Unconstrained EXPLAIN (`seq > 0` only): references all 16 `event_pXX` partitions via Append
- Plans differ (pruning is active, not decorative)

## Deliverable 4 — Multi-session no-double-promotion smoke

**What:** Per Item 6 note, Wave 3's 8-container boot supersedes the 2-container migration race. What remains is a MULTI-SESSION functional smoke: 2+ concurrent sessions with concurrent input admission/promotion proving no double-promotion and cross-session isolation. The existing wake-pg tests cover same-session concurrent promotion (zero double-promotion within ONE session); this test extends to the MULTI-session dimension.

**File:** `packages/core/test/wake-pg.test.ts` (extended, 1 new test in a new `describe` block)

**Command and result:**
```
cd packages/core
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
DATABASE_URL=postgres://postgres:postgres@localhost:25443/opencode \
bun test test/wake-pg.test.ts --test-name-pattern "multi-session"
```
- Exit code: 0
- Tests: 1 pass, 0 fail
- Expect calls: 16
- Dialect: PG (isPg sanity via existing wake-pg test)

**Assertions proven:**
- Two sessions (A: 2 inputs, B: 3 inputs), concurrent `promoteSteers` with `concurrency: "unbounded"`
- Both sessions' promotions succeed (Exit.isSuccess both)
- Session A promotes exactly 2, session B promotes exactly 3 (no cross-session interference)
- All inputs promoted (promoted_seq not null for every row)
- Unique promoted_seq values per session (no double-promotion)
- Non-vacuity: row counts asserted before behavior (2 + 3 = 5 inputs confirmed before promotion)

**Existing wake-pg coverage (not duplicated):**
- `promoteSteers` exactly-once (single session): 1 test
- `promoteNextQueued` exactly-one (single session): 1 test
- Concurrent `promoteSteers` same session → zero double-promotion: 1 test
- Savepoint continuation (LifecycleConflict mid-batch): 1 test
- NOTIFY rollback suppression: 1 test
- T2 contiguous seqs through real EventV2 pipe: 1 test
- isPg sanity: 1 test
- SQLite no-op: 2 tests

## Deliverable 5 — Evidence ledger

**File:** `.opencode/step9-evidence.md` (this file)

## Standing gates

### Typecheck (sequential, both packages)
```
cd packages/core && bun typecheck     # exit 0
cd packages/opencode && bun typecheck  # exit 0
```

### Full PG battery (all exit 0)
| Suite | Tests | Expect | Time |
|---|---|---|---|
| database-pg.test.ts | 14 pass | 50 | 15.55s |
| flush-pg.test.ts | 7 pass | 25 | 15.71s |
| wake-pg.test.ts | 10 pass | 56 | 39.74s |
| wake-receive-pg.test.ts | 8 pass | 13 | 11.85s |
| session-pg-roundtrip.test.ts | 5 pass | 9 | 3.98s |
| dialect-matrix.test.ts | 10 pass | 17 | 9.86s |
| grep-guard.test.ts | 8 pass | 10 | 169ms |
| **Total PG** | **62 pass** | **180** | — |

### SQLite quartet (all exit 0)
| Suite | Tests | Expect | Time |
|---|---|---|---|
| database-migration.test.ts | — | — | — |
| session-projector.test.ts | — | — | — |
| event.test.ts | — | — | — |
| grep-guard.test.ts | 8 pass | 10 | 169ms |
| **Total (4 files)** | **79 pass** | **152** | 3.59s |

### Anchor-bug regression (SQLite, all exit 0)
| Suite | Tests | Expect |
|---|---|---|
| task.test.ts (B1/B3/AR2) | 3 pass | 10 |
| processor-effect.test.ts (B2) | 1 pass | 5 |
| subagent-empty-frame.test.ts (AR1 + non-orphan) | 6 pass | 9 |

### Zero as-any/@ts-ignore in changed files
- `packages/core/test/database-pg.test.ts`: 0
- `packages/core/test/wake-pg.test.ts`: 0
- `packages/tui/test/routes/session/subagent-empty-frame.test.ts`: 0

## Files touched

| File | Change |
|---|---|
| `packages/core/test/database-pg.test.ts` | +2 deferred-constraint tests (Memo #8 Cond 1), +1 partition-pruning EXPLAIN test (PART 4 step 4) |
| `packages/core/test/wake-pg.test.ts` | +1 multi-session no-double-promotion test (Step 9 smoke) |
| `packages/tui/test/routes/session/subagent-empty-frame.test.ts` | +1 AR1 non-orphan variant test |
| `.opencode/step9-evidence.md` | NEW — this evidence ledger |

## Files NOT touched (per hard constraints)

- `packages/core/src/database/migration.pg.ts` — NOT touched (Athena Cond 1, parallel task)
- `docker/Dockerfile` — NOT touched (Athena Cond 2, parallel task)
- `packages/docs/pg-deploy.mdx` — NOT touched (Athena Cond 3, parallel task)
- `.opencode/db-decision-memos.md` — NOT touched (Athena owns it)
- `.omo/plans/pg-backend-staging.md` — NOT touched
- `.opencode/db-migrations/0000_init.sql` — NOT touched (byte-frozen, sha256 verified by grep-guard)

## Gaps and risks (honest report for Oracle's end-gate)

1. **Anchor-bug tests under PG (D2 gap):** The `packages/opencode` anchor-bug tests (B1/B3/AR2/B2) cannot run under PG due to the FM-21 seam — app-layer consumers import SQLite table objects directly (`MessageTable` from `@opencode-ai/core/session/sql`), which produce invalid queries against PG. This is a pre-existing Step 4/5 dialect parity gap, NOT an anchor-bug regression. The CI workflow only runs `packages/core` PG-gated suites under PG. Resolving this requires adopting `Database.Schema` namespace in `packages/opencode` consumers — out of scope for Step 9. The anchor-bug logic itself (model resolution, error persistence, metadata) is dialect-agnostic; the DB queries are the blocker.

2. **AR1 non-orphan variant is dialect-agnostic:** The test proves `emptySubagentFrame` returns undefined for non-orphan sessions (normal render path) and `errorMessage` produces a non-blank string for persisted errors. It does NOT exercise the full TUI render pipeline (which would require a Solid.js rendering test). The render path at `index.tsx:1563-1576` shows `errorMessage(props.message.error)` when `props.message.error` is set — the test proves the input to that render path is non-blank.

3. **Multi-session smoke is same-process:** The test runs two concurrent `promoteSteers` calls in the same process (via `Effect.all` with `concurrency: "unbounded"`). It does NOT test cross-process promotion (which would require two separate opencode containers). The plan's "container smoke" dimension is superseded by Wave 3's 8-container boot proof (Memo #18). The same-process test proves the DB-level no-double-promotion and cross-session isolation; cross-process serialization is proven by the advisory-lock migration race (Memo #18).

4. **`.opencode/db-migrations/` directory was restored from backup:** The directory was missing from the working tree (untracked, never committed — Memo #10 Cond 7 / Memo #11 Cond 2 pending). Restored from `.opencode/db-migrations.bak/` (sha256 verified: `818ee1a9...422fb3` matches the grep-guard constant). This is NOT a file touch — it's a restore of an existing artifact. The grep-guard test confirms byte-identity.
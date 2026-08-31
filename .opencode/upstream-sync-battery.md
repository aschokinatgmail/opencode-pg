# upstream-sync Battery Evidence Packet

## 1. Header

| Item | Value |
|---|---|
| Branch | `upstream-sync` |
| Commits | `22f7873b4b` (merge) → `495108a2c2` (test fix) → `70f4db88a1` (memo #21) |
| Base | `abd369e4cd` (dev tip, Memo #20 discharge) |
| Upstream merged | `dc4449df0d`, 192 commits |
| Plan | `.omo/plans/oc-upstream-update.md` (Oracle design, Momus-approved) |

## 2. Council Verdicts

- **Oracle:** APPROVE-WITH-CONDITIONS — upstream merge review: 7 invariants intact, plan rulings hold, no baseline change, no schema change, no new dependency in the PG path.
- **Athena:** APPROVE — MERGE IS FIT FOR dev (Memo #21, PART 20; six-lens verification passed).
- **Argus:** APPROVE-WITH-CONDITIONS — security surface unchanged; lockfile SCA + unlock.yml policy line follow-ups recorded.
- **Momus:** APPROVE-WITH-NOTES — battery ordering deviation accepted, V10 positive proof required and satisfied (check:generated exit 0).

## 3. Verification Battery (V1–V10)

| Gate | Result | Detail |
|---|---|---|
| V1 | PASS | `bun typecheck` in `packages/core` → exit 0, 0 errors |
| V2 | PASS | `bun typecheck` in `packages/opencode` → exit 0, 0 errors |
| V3 | ADJUDICATED | PRE-EXISTING via dev-worktree proof (task.test.ts failures identical on dev) |
| V4 | ADJUDICATED | FLAKY-UNDER-LOAD via isolation reruns (wake-pg suite passes when env is present) |
| V5a | PASS | opencode PG targets green post-fix (`495108a2c2` applied) |
| V5b | PASS | core PG 54/0 (six suites: database-pg, flush-pg, wake-pg, wake-receive-pg, session-pg-roundtrip, dialect-matrix) |
| V6 | PASS | grep-guard test green; app-layer `*/sql` import ban intact; zero new direct table-object imports across 192 commits |
| V8 | PASS | sha256 of `0000_init.sql` = `818ee1a9bd75a8cfeeef32fc426e288108e69b5e5fb4360d876bf6ffef422fb3` — byte-identical, constant |
| V9 | PASS | `docker compose config -q` exit 0 (required-env creds hardened) |
| V10 | PASS | `bun run check:generated` (packages/client) → exit 0, no diff |

## 4. Merge-Caused Defects + Fix Record

| # | Defect | Fix commit |
|---|---|---|
| 1 | task.test.ts: missing `providerCfg` attachment (B1 config stubs) | `495108a2c2` |
| 2 | task.test.ts: second missing `providerCfg` attachment | `495108a2c2` |
| 3 | task.test.ts: error format assertion drift (B3 format assertion) | `495108a2c2` |

**Post-fix result:** SQLite `bun test` 25/25 pass; PG targets green.

## 5. Execution-Deviation Ledger

| # | Deviation | Adjudication |
|---|---|---|
| 1 | 3-session split (model outages) | ACCEPTABLE — FM-36 authored-vs-executed discipline honored by final session reconciliation |
| 2 | Merge committed before battery completion | ACCEPTABLE by Momus — conflict work preserved on isolated branch (FM-37 lesson); defects fixed as follow-up commit `495108a2c2`; battery completed after |

## 6. Follow-Ups Backlog

| # | Follow-up | Owner | Status |
|---|---|---|---|
| A-2 | Never configure `unlock.yml` vars/secrets on the fork — policy line | Argus | Recorded |
| A-4 | Full lockfile SCA audit + `@ai-sdk/provider-utils` version | Argus | Recorded (version 4.0.23, CVE-2026-8769 <5.0.1) |
| SDK regen pointer | SDK regen script lives in `packages/sdk`, not `packages/client` | Oracle | Recorded — template fix |

## 7. Lockfile SCA Spot-Check

- `@ai-sdk/provider-utils` resolved at `4.0.23` in `bun.lock`
- CVE-2026-8769 affects versions <5.0.1 — current version is in the affected range
- Non-blocking for this merge; recorded for follow-up

---
*Assembled: 2026-08-31*

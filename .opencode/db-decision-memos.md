Task Result

Task ID: bg_7ed0072b
Description: Athena Task 1: DB structure design
Duration: 12m 33s
Session ID: ses_fed546ed7ffeIgOVNFD1daWd5q

---

This is the design session my mandate exists for. I need to:

1. Read the actual schema files — schema.gen.ts, the 11 *.sql.ts files, migration files, and understand the current SQLite schema completely.
2. Produce 5 decision memos adjudicating T1/T3/T4/T5 and bootstrap strategy.
3. Produce the complete bootstrap DDL for all 19 tables.
4. Produce the complete parity matrix.
5. Produce the observability queries (projection-lag gauge, db status --sessions).

Let me start by reading the ground-truth files. I should use codegraph_explore and read tools to get the actual schema. Let me begin by exploring the database directory structure and reading the schema files.

Key files to read:
- packages/core/src/database/schema.gen.ts
- packages/core/src/database/migration.gen.ts (probe)
- packages/core/src/database/migration.ts
- packages/core/src/database/database.ts
- All *.sql.ts files under packages/core/src — there should be ~11
- The 4 V2-semantics migrations among the 37

Let me fire off reads. First, let me get the directory structure.

I'll execute this design session properly. First, ground truth: read every schema file before any verdict.

The task mentions "11 *.sql.ts schema files" — let me find all of them. I see 3 so far. Let me search more broadly for sql.ts files and table definitions.

The 11 *.sql.ts files are in packages/console/core/src/schema/ (11 files) but those are the console package — likely NOT part of the opencode PG migration (console is a separate cloud service). The task says "ground truth: packages/core/src/database/schema.gen.ts + the 11 *.sql.ts schema files". Hmm, but the core schema files are:

- packages/core/src/account/sql.ts
- packages/core/src/control-plane/workspace.sql.ts
- packages/core/src/credential/sql.ts
- packages/core/src/data-migration.sql.ts
- packages/core/src/database/schema.sql.ts
- packages/core/src/event/sql.ts
- packages/core/src/permission/sql.ts
- packages/core/src/project/sql.ts
- packages/core/src/session/sql.ts
- packages/core/src/share/sql.ts

That's 10 files with table definitions in packages/core. Plus maybe others. Let me check for more — maybe there are tables defined elsewhere. Let me grep for "Table(" definitions across core.

The console schema files are a separate cloud service — the ground truth for opencode PG is packages/core. Let me enumerate every table definition in core:

19 tables confirmed: workspace, data_migration, account_state, account, control_account, credential, event_sequence, event, permission, project_directory, project, message, part, session_context_epoch, session_input, session_message, session, todo, session_share.

Now let me read all the actual schema files. I'll read them in parallel:
1. packages/core/src/database/schema.gen.ts
2. packages/core/src/session/sql.ts
3. packages/core/src/event/sql.ts
4. packages/core/src/account/sql.ts
5. packages/core/src/project/sql.ts
6. packages/core/src/credential/sql.ts
7. packages/core/src/permission/sql.ts
8. packages/core/src/share/sql.ts
9. packages/core/src/control-plane/workspace.sql.ts
10. packages/core/src/data-migration.sql.ts
11. packages/core/src/database/schema.sql.ts

19 tables confirmed. Now reading all schema source files in full:

One path was malformed. Let me read the remaining files with correct absolute paths.

Interesting — account/sql.ts was reported at "packages/core/src/account/sql.ts:6" by grep but the read failed. Let me check — maybe it's in a different location. The grep output said `packages/core/src/account/sql.ts:6:export const AccountTable`. Odd. Let me try again — maybe a transient path issue with the ".." segments. Let me use the exact absolute path again carefully.

Good. Now let me read schema.gen.ts in full to cross-check the authoritative generated DDL, and migration.ts + migration.gen.ts for the runner mechanics, plus the 4 V2-semantics migrations. Let me read schema.gen.ts.

All table sources read. Now the generated snapshot and migration machinery:

My path had a typo ("Documents.projects.nosync" instead of "Documents.nosync"). Let me redo with correct paths.

I've now read the full schema.gen.ts (19 tables, all indexes) and migration.ts. Now I need:

1. The 4 V2-semantics migrations (event-sourced session_input, inbox indexes, context-snapshot epoch). Let me look at migration.gen.ts to find them.
2. The event commit path (commitDurableEvent) to verify FOR UPDATE / event_sequence mechanics.
3. The drain / inbox promotion path (SKIP LOCKED baseline context).
4. database.ts for dual-backend path.
5. Check how event.data and session.metadata are queried (for GIN adjudication — baseline says GIN only if payload-field queries observed).

Let me read migration.gen.ts (probably large — 37 migrations). Let me list migration IDs first.

Now the 37 migrations — I need the four V2-semantics ones and the journal shape:

Now let me read the four V2-semantics migrations:
1. 20260603141458_session_input_inbox.ts
2. 20260604172448_event_sourced_session_input.ts
3. 20260605003541_add_session_context_snapshot.ts (context-snapshot epoch)
4. 20260622142730_simplify_session_context_epoch.ts (final shape)
5. Also 20260622202450_simplify_session_input.ts (final shape)

Also I should read the event commit path — let me find commitDurableEvent. And the drain path. Let me search.

Reading the four V2-semantics migrations plus the final-shape follow-ups:

Now I need the runtime paths to ground the memos:

1. commitDurableEvent — event commit with FOR UPDATE on event_sequence. Find it in packages/core/src/event or session.
2. The drain / promotion path — where session_input is promoted (promoted_seq IS NULL predicate), and where the SELECT FOR UPDATE SKIP LOCKED arbitration would sit.
3. Where event.data and session.metadata are queried with json_extract (GIN adjudication).
4. database.ts dual-backend path.

Let me use codegraph_explore for the event commit + inbox drain paths.

Migrations read. Now the runtime hot paths — event commit, inbox drain/promotion, and JSON query sites:

Good — I have the input.ts structure with `promoted_seq IS NULL` predicates (lines 136, 181, 257, 279). Let me read the key sections of event.ts (the commit path around lines 21-110 and 250-300 and 500-540) and the projector to understand the two-tier structure. Also check where session.metadata / event.data json_extract queries exist (GIN adjudication), and database.ts for dual backend.

I now have everything essential:

1. **All 19 tables** read from both the drizzle sources and schema.gen.ts.
2. **The 4 V2-semantics migrations** (session_input_inbox, event_sourced_session_input, add_session_context_snapshot + simplify) plus the reset migration.
3. **commitDurableEvent** at packages/core/src/event.ts:205 — reads event_sequence row, computes latest+1, inserts event, updates EventSequenceTable (lines 243-249, 276, 527). Under SQLite this is serialized by the DB transaction; under PG we need FOR UPDATE on the event_sequence select (that's T2, accepted).
4. **session_input promotion predicates** at packages/core/src/session/input.ts:136, 181, 257, 279 — `isNull(SessionInputTable.promoted_seq)`.
5. **JSON query sites**: grep for json_extract in src (excluding migrations/tests) returned nothing except in migrations — meaning no payload-field queries currently observed on event.data / session.metadata in core src → GIN stays OUT per baseline ("GIN only if payload-field queries are observed"). Good, that's evidence for the parity matrix: jsonb plain, no GIN.
6. **database.ts** — dual backend path, PRAGMAs, DatabaseMigration.apply.

Let me quickly double check the JSON grep actually ran — the output shows the json grep section printed nothing before ===DB.ts===. So zero payload-field JSON queries in core src outside migrations. Good evidence. Let me also check the event.ts continuation (lines 320-360) to see the event insert + EventSequence update + how transactions commit, and check line 527 context. Actually I have enough: lines 239-249 show the transaction, select from EventSequenceTable without FOR UPDATE (SQLite serializes writers), update at 276 and 527.

Also need to check session.metadata query usage for completeness? The baseline says "GIN only on event.data and session.metadata if payload-field queries are observed" — I observed none. So no GIN in bootstrap. Done.

One more thing: event insert. Let me peek at lines 320-360 quickly and the 500-540 region for the EventSequence update, to cite accurately. Also the projector.ts to understand T3 relevance (projector consumes events and writes session_message/message/part). Let me read those two slices.

I now have everything needed. Let me also quickly verify the projector writes session_message and check the flush characteristics for T3 membership (async tier = Text.Delta, Tool.Progress). Let me peek at projector.ts briefly to see what event types it handles — this determines async-tier membership evidence.

One more evidence pass — the projector's event-type handling (T3 async-tier membership) and any payload JSON queries:

Confirmed:
- Zero payload-field JSON queries (`json_extract`, `->>`) in packages/core/src or packages/server/src outside migrations → GIN stays out of bootstrap per baseline.
- `readAfter` (event.ts:541-545) is the replay query: `WHERE aggregate_id = ? AND seq > ? ORDER BY seq ASC` — the replay covering index requirement is grounded.
- Projector at projector.ts:389 handles Tool.Progress via events.project — the high-frequency projection path.

Now I have all the evidence I need. Let me also double-check a couple of details for the memos:

1. T1 divergence adjudication criteria: connection pinning requirements, fan-out cardinality at ~dozens of sessions, LISTEN connection failure blast radius, NOTIFY queue pressure.

Facts about PG NOTIFY:
- Channel names max 63 bytes (NAMEDATALEN-1).
- pg_notify(channel, payload): payload max 8000 bytes.
- Notifications are queued per-backend; a session in a transaction that has executed NOTIFY holds notifications until commit. Listener receives after commit — this is what makes "pg_notify inside commitDurableEvent's transaction" transactional.
- Each LISTEN connection receives only notifications on channels it listens to.
- With per-session channels: a process must LISTEN on oc_s_<id> for each session it has UI/subscriber interest in. As sessions churn (dozens), the listener must dynamically LISTEN/UNLISTEN. A reconnect loses ALL channels and must re-issue every LISTEN — blast radius is the same (one connection), but recovery requires knowing the full channel set (catch-up scan + re-subscribe list).
- With per-process channel: one channel oc_p_<pid/uuid>, every committing process must pg_notify to every live process channel? No wait — per-process channel means the notify side must know which processes care about which sessions. That requires a registry (a "subscriber interest" table) — cross-process fan-out bookkeeping. Actually the typical design: per-process channel requires each process to register "I'm interested in sessions X, Y" durably so writers can NOTIFY the right process channels. That's more moving parts. Alternatively per-process broadcast: writers NOTIFY all process channels on every commit — fan-out cardinality = N_processes per event, vs per-session = 1 NOTIFY per event (only the session's channel). At dozens of sessions and a handful of processes, per-session channels emit exactly one NOTIFY per commit, targeting interested listeners directly.

- NOTIFY queue pressure: PG has no global queue; each NOTIFY is delivered to each listening backend's queue. Per-session channel: one notification delivered to listeners of that channel only. Per-process broadcast: every event notifies every process channel → M×P notifications per event.

- Connection pinning: per-session channels can share ONE dedicated LISTEN connection (channels are multiplexed on a single connection — LISTEN a; LISTEN b; works fine). So pinning cost is identical: one pinned connection either way. The difference is the dynamic LISTEN/UNLISTEN bookkeeping vs static single LISTEN.

- Truncation: 63-byte limit; session IDs are UUID-ish (ses_... 26-ish chars?). Let me check SessionSchema.ID format quickly. Actually session IDs in opencode are like "ses_01J..." (ULIDs) — ~30 chars. "oc_s_" + 30 = 35 bytes, fine, but truncation rule still needed for safety.

Decision: per-session truncated channels (the Artistry/accepted-baseline "oc_s_<id>") with:
- single dedicated LISTEN connection per process, multiplexing all session channels it has interest in,
- self-drop by processId or by simply ignoring own notifications (compare backend PIDs — but with postgres-js each pool connection has its own PID; the notifier's PID is included in the notification payload so listeners can compare against... hmm, actually PgNotification includes processId of the notifying session. With a pool, the process can't know all its own connection PIDs cheaply — actually it can: pg_backend_pid() per connection. Simpler: include a process-unique sender tag (e.g., bootId/processUuid) in the tiny payload and self-drop on match. The design input says "self-drop by processId" — payload carries processId, listeners drop their own).
- catch-up scan before resume on reconnect: on LISTEN connection loss, the recovery is: begin listening again, then re-run a data scan (SELECT pending) for all sessions of interest — because notifications missed during the gap are gone. Order matters: LISTEN first (in its own transaction — LISTEN takes effect at commit), then scan; anything committed after the scan will notify; anything committed between LISTEN-commit and scan appears in both (dedupe by seq) — the standard at-least-once pattern. This is correctness-neutral because the poll backstop is always on.

Verdict for D1: per-session truncated channels.

2. T3 two-tier commit:
- sync tier: admissions (session_input INSERT), inbox promotion updates, epoch writes (session_context_epoch), structural rows (session, message, session_message core rows), event + event_sequence (durable log) — must go through the transactional pool with synchronous_commit=on (default).
- async tier: high-frequency delta/progress projections — Text.Delta, Tool.Progress — which under the current architecture are session_message.data updates (projector.ts:389 Tool.Progress). These flush in batches, gated by session_projection_checkpoint (session_id PK, applied_seq, flushed per batch).
- HARD FENCE: admitted session_input or committed epoch writes never via async pool. My bootstrap must create session_projection_checkpoint with session_id PK referencing session ON DELETE CASCADE, applied_seq bigint NOT NULL.
- synchronous_commit=off on the flush pool: risk = on crash, last batches may be lost — acceptable because derived (projection) and replayable from event log; the checkpoint row itself must be written... wait, checkpoint rows: are they durable or derived? The checkpoint (applied_seq) marks projection progress. If checkpoint is written via async pool with synchronous_commit=off and crashes, we lose "applied_seq" marker → replay from earlier → idempotent re-projection. But careful: if checkpoint advances BEFORE the projected rows are durable, a crash could leave checkpoint > actual durable projection → projection gap forever. So ordering rule: flush batch and checkpoint update in the SAME async transaction (batch rows + checkpoint commit atomically), then synchronous_commit=off only risks losing BOTH together — consistent. That's the correct condition to write down. Also fillfactor=80 on part and session_message (hot updates on data column), wal_compression=on (set at cluster level via compose command, not in migration — it's a superuser/postgres.conf setting; ALTER SYSTEM or compose command args). wal_compression is a GUC that can be set in postgres.conf / compose command. In migration I cannot set it (not superuser-safe, and migrations should not mutate GUCs). I'll put it in the compose/deploy notes and note it as such: `command: postgres -c wal_compression=on -c shared_preload_libraries=pg_stat_statements`. ALTER TABLE ... SET (autovacuum_...) per-table IS migration-safe.
- flush-on-read at history entry points + observable in projection-lag gauge (db status): the gauge query = max event.seq (per session aggregate) minus checkpoint.applied_seq. I'll write the query.

3. T4 client-side projection: pure client concern — readAggregate (event.ts:63), readAfter (event.ts:541) exist already and are covered by the replay index. No new structure. The only DB-structure implication is that the replay covering index must INCLUDE what readAfter selects (id, type, data) to be index-only-friendly... actually readAfter selects full rows including data (jsonb payload) — an INCLUDE (type, id) index still can't avoid heap visits for data. The invariant in my prompt says: "replay index covers (aggregate_id, seq) INCLUDE (type, id) or the T5 per-partition equivalent". The INCLUDE is for replayAll contiguity checks and type filtering; data still needs heap. Fine. Verdict: scoped out of bootstrap except confirming the replay index. Memo says: no DB-structure change beyond already-mandated indexes; compaction bounds memory client-side; T4 has no bootstrap footprint.

4. T5 hash-partitioned event log:
- PARTITION BY HASH (aggregate_id) with N partitions. Per-partition UNIQUE (aggregate_id, seq) — because global unique constraint on PK (id) and (aggregate_id, seq) can't be enforced across partitions in PG declarative partitioning (unique constraints must include the partition key; (aggregate_id, seq) includes aggregate_id ✓ — so per-partition unique works and is enforced... note: UNIQUE (aggregate_id, seq) on each partition IS valid because it includes the partition key. The global guarantee comes from partition routing + per-partition uniqueness. But (id) PK cannot be global — the parent can't have a PK on id alone. So event table gets: PRIMARY KEY (aggregate_id, seq, id)? Hmm. Design: parent table with no PK (or PK including partition key), partitions each with UNIQUE (aggregate_id, seq) and INDEX (aggregate_id, type, seq), plus UNIQUE (aggregate_id, id) per partition for event-ID dedupe (commitDurableEvent checks stored by event.id at event.ts:303-315). So per-partition: UNIQUE (aggregate_id, seq), UNIQUE (aggregate_id, id)... 

Wait — do we need event id uniqueness? commitDurableEvent does a select on EventTable where id = event.id (event.ts:303-308) to detect "already exists" — a correctness check inside the same transaction that holds FOR UPDATE on event_sequence, so two concurrent commits for the same aggregate serialize; a same-id event under a DIFFERENT aggregate would not be caught by per-partition unique (different aggregate → different partition). Is cross-aggregate id collision possible? Event IDs are generated UUIDs — collision ~impossible; and the check is defense-in-depth. Per-partition UNIQUE (aggregate_id, id) preserves the same guarantee level as today for same-aggregate, and cross-aggregate id collision is left to UUID entropy (same as SQLite? no — SQLite has global PK on id). Hmm, this is a real weakening. Options: (a) global separate unique index table, (b) accept UUID entropy, (c) don't partition. 

Decision on partition count: The event log is append-heavy, autovacuum-sensitive. 32 partitions at dozens of sessions is over-partitioned — each partition is a separate relation with its own indexes; planner must prune. With HASH(aggregate_id), pruning works on equality predicates (readAfter: aggregate_id = ? AND seq > ?) ✓. But 32 partitions × 3 indexes = 96 index relations for a staging/beta with maybe tens of thousands of rows = overhead without benefit. My call: 8 partitions (hash), same per-partition constraint shape, documented as one-way door; OR reject partitioning for staging/beta entirely?

The design input says "Migration-time one-way door — must precede data. Decide now, correctly." The tension: partitioning buys vacuum parallelism and smaller indexes for high-volume event logs; costs: no global PK on id, no cheap COUNT(*) cross-partition, attach/detach ops, and the parity matrix gets more complex. At staging/beta scale (~dozens of sessions), the honest engineering answer: partition by hash with a SMALL count (8) keeps the door open with bounded overhead... but actually, re-partitioning later from non-partitioned requires a table rewrite — that's the one-way door. Alternatively start non-partitioned and partition later via pg_partman? Also a rewrite. Which is riskier? Starting non-partitioned and needing to partition under load later = migration downtime on the hottest table. Starting partitioned = permanent complexity. Given: event log is THE hot table (every Text.Delta commit is an event row — event.ts commitDurableEvent per event, with Text.Delta being high-frequency), the volume per session is genuinely large (thousands of events per session), and autovacuum on one monolithic append-only table with per-partition tuning (0.01/0.005) is exactly where partitioning pays... My verdict: partition IN, but at 16 partitions, not 32. Rationale: 32 is cargo-culted from much larger deployments; 16 keeps per-partition index depth low, gives 16-way vacuum fan-out, halves the relation count; at dozens of sessions each partition still sees enough rows for stats. Hmm — but is 16 vs 32 defensible enough? With hash partitioning, more partitions = finer pruning granularity doesn't help (aggregate_id equality prunes to exactly 1 partition regardless of count). The ONLY benefits of more partitions: smaller per-partition indexes/tables, more parallel vacuum workers, better stats. Costs scale linearly: relation overhead, planning time (minor, pruned), lock/ops surface. For staging/beta: 8 or 16 both fine. I'll go 8 — wait, but the one-way door argument cuts the other way: changing partition count later requires full rewrite; under-sizing means doing that rewrite sooner. The safe middle for a system designed to grow into clustering: 16. Decision: 16 partitions. I'll write the modulus as a named constant with the rationale and an explicit note that changing it post-data is a rewrite.

Per-partition DDL (must be in bootstrap as explicit partitions event_p0..event_p15):
- UNIQUE (aggregate_id, seq) — replaces event_aggregate_seq_idx
- INDEX (aggregate_id, type, seq) — replaces event_aggregate_type_seq_idx
- UNIQUE (aggregate_id, id) — preserves event-ID dedupe within aggregate; cross-aggregate id uniqueness relies on ID generation (cite event.ts:303 check). Also note: parent table has no id-PK; parity matrix marks id: SQLite PK → PG: NOT NULL + per-partition unique(aggregate_id,id) — a documented deviation.

Also event FK to event_sequence: FK from partitioned table to plain table works (references event_sequence(aggregate_id)) — but note the CASCADE delete path event.ts:514-519 (remove). FK across partitioning is fine (PK on parent side event_sequence.aggregate_id exists).

Hmm, one more T5 consideration: ON DELETE CASCADE from event_sequence → event must cascade into partitions — supported.

5. Memo #5 bootstrap strategy: confirmed by baseline; the four V2-semantics migrations are 20260603141458 (create inbox), 20260604172448 (event-sourced input shape = CURRENT shape), 20260605003541 + 20260622142730 (epoch final shape), plus 20260622202450 (reset — not DDL, semantic reset only, no bootstrap section needed — it's a data reset for pre-release users; document as intentionally omitted). Actually "re-express the four V2-semantics migrations (event-sourced session_input, inbox indexes, context-snapshot epoch)" — the four named: event-sourced session_input, inbox indexes, context-snapshot epoch... that's 3 concepts / maybe 4 files. I'll treat: (1) session_input_inbox creation, (2) event_sourced_session_input reshape (current column set + 3 indexes), (3) add_session_context_snapshot (create epoch), (4) simplify_session_context_epoch (final column set). All four land as DDL sections in 0000_init; the schema.gen.ts snapshot ALREADY reflects their final state, so the bootstrap is generated from the snapshot + my PG overlay.

Now the schema design. 19 tables + session_projection_checkpoint + migration journal table = 21 tables in bootstrap (journal "migration" table is created by migration.ts runner; in PG bootstrap the runner creates it — I should include it in the bootstrap since fresh-init creates it right after schema.up; cleaner: keep runner behavior, bootstrap includes CREATE TABLE migration as the PG 0000 does it — migration.ts apply() creates it separately. I'll note it: the PG bootstrap 0000_init contains schema + PG-only structures; the runner journal table stays runner-owned. Actually looking at migration.ts:26-36: fresh DB path runs schema.up then creates migration table then inserts ALL migration ids. For PG, DatabaseMigration PG-variant will run 0000_init and record just "0000_init". Fine — that's implementer's port; my artifact covers the DDL.)

Type mapping decisions (parity matrix):
- text PKs → text PRIMARY KEY
- integer timestamps (time_created/time_updated/etc.) → timestamptz NOT NULL. Conversion at migration boundary (dump/restore script owns epoch-ms → timestamptz). token_expiry → timestamptz (nullable). time_used (workspace) → timestamptz. time_completed (data_migration) → timestamptz. time_initialized, time_compacting, time_archived → timestamptz nullable.
- integer counters (summary_*, tokens_*) → bigint (tokens can exceed int32? tokens_input total across a session could exceed 2^31? 2.1B tokens is unlikely but bigint is cheap and correct for counters; PG integer is 4-byte. Use bigint for tokens_* and summary_*). Hmm — "complete and exact" mapping: I'll map tokens_* and summary_* → bigint, seq columns → bigint (event.seq per aggregate could stay int4, but bigint future-proofs; event seq is per-aggregate count — int4 plenty, but bigint costs 4 bytes/row... on event table with partitions, 4 bytes × rows. I'll use bigint for seq to match "integer unix-ms is GONE" spirit? No — that's timestamps only. Decision: seq/admitted_seq/promoted_seq/baseline_seq → bigint (they derive from event seq space; consistency beats 4 bytes). position (todo) → integer (small). account_state.id → integer (singleton row) → integer.
- real (session.cost) → double precision.
- integer boolean (control_account.active, credential.active) → boolean.
- text json mode → jsonb: session.summary_diffs, session.metadata, session.revert, session.permission, session.model, message.data, part.data, session_message.data, session_input.prompt, session_context_epoch.snapshot, project.commands, workspace.extra, credential.value. NO GIN anywhere (zero payload queries observed — grep evidence).
- project.sandboxes: absoluteArrayColumn → text (JSON string array) — hmm, driverData string, JSON.stringify'd. Under PG: jsonb array of strings. It's a JSON array — map to jsonb with note that the custom type encodes as JSON string. Workspace.extra: text({mode:"json"}) → jsonb.

FKs: replicate all from schema.gen.ts (workspace.project_id, account_state.active_account_id SET NULL, event.aggregate_id cascade, permission.project_id, project_directory.project_id, message.session_id, part.message_id, session_context_epoch.session_id, session_input.session_id, session_message.session_id, session.project_id, todo.session_id, session_share.session_id). NOTE: session.parent_id has NO FK (self-ref avoided), session.workspace_id NO FK, part.session_id NO FK (denormalized, no constraint in SQLite either — check schema.gen.ts part table: only message_id FK. Correct.)

Indexes (SQLite → PG):
- event: per-partition (T5).
- message_session_time_created_id_idx → becomes (session_id, time_created DESC, id DESC)? My invariant list says session_message history pagination (session_id, time_created DESC, id DESC). For parity, PG can keep ASC 3-col index (PG can scan backward) — but my hot-path invariant says "history pagination index (session_id, time_created DESC, id DESC) present" — a btree on (session_id, time_created, id) serves both directions via backward scan; mixed ASC/DESC only matters for multi-key sorts with mixed direction — here both keys flip together, so plain ASC index is equivalent. I'll spec DESC explicitly to match the invariant text and make ORDER BY ... DESC index-order-native. Keep names identical where semantics match.
- session_message_session_seq_idx UNIQUE, session_message_session_type_seq_idx, session_message_session_time_created_id_idx (DESC,DESC), session_message_time_created_idx → time_created is now timestamptz; global time index stays.
- session_input: partial index REWRITE — my invariant: partial index on (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL — note the SQLite index is (session_id, promoted_seq, delivery, admitted_seq) full index. The accepted baseline says: "session_input: partial index on (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL; promotion UPDATE includes promoted_seq IS NULL predicate; unique (session_id, promoted_seq) backstops races." So PG: CREATE INDEX session_input_session_pending_delivery_seq_idx ON session_input (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL. Keep the two unique indexes as-is: (session_id, admitted_seq) UNIQUE and (session_id, promoted_seq) UNIQUE. NOTE: unique on (session_id, promoted_seq) with NULLs — PG allows multiple NULLs, matching SQLite. Good.
- session_project_idx, session_workspace_idx, session_parent_idx.
- part_message_id_id_idx, part_session_idx.
- todo_session_idx (redundant with PK prefix (session_id, position) — keep for parity? PK (session_id, position) leading column session_id serves todo_session_idx queries; SQLite had both. In PG I'll DROP todo_session_idx as redundant — parity matrix documents it. Actually "complete parity" vs "optimized": my mandate is optimized structure; document the drop in the matrix with rationale (PK prefix covers it).
- permission_project_action_resource_idx UNIQUE.
- control_account PK (email, url).
- project_directory PK (project_id, directory).

Storage:
- event partitions: autovacuum_vacuum_scale_factor=0.01, autovacuum_analyze_scale_factor=0.005, fillfactor default 100 (append-only — no HOT needed on event; fillfactor 80 on part and session_message per baseline T3).
- part, session_message: fillfactor=80.
- session_projection_checkpoint: new table (session_id PK FK cascade, applied_seq bigint NOT NULL, time_updated timestamptz NOT NULL).
- wal_compression=on: compose command (postgres -c wal_compression=on) — NOT in migration (GUC, restart-sensitive). Document.
- synchronous_commit=off: flush-pool session-level setting (implementer sets on reserved flush connections: SET synchronous_commit = off) — NOT a migration artifact.

Extensions: CREATE EXTENSION IF NOT EXISTS pg_stat_statements; — but shared_preload_libraries must include it; probe pg_available_extensions at boot; warn-and-continue. The bootstrap statement: guarded — CREATE EXTENSION IF NOT EXISTS pg_stat_statements; wrapped in exception handler? In a migration, plain CREATE EXTENSION IF NOT EXISTS works if the .so is available (preload not required for CREATE, only for collecting stats... actually pg_stat_statements needs shared_preload_libraries to be loaded at server start; CREATE EXTENSION without preload succeeds but the view stays empty until restart with preload. Condition: attempt CREATE EXTENSION in bootstrap but the runner must tolerate failure → condition in memo: wrap in DO block with exception, log warning. I'll spec that.)

Observability queries (Duty 7):

Projection-lag gauge (per session):
```sql
SELECT es.aggregate_id AS session_id,
       es.seq - COALESCE(spc.applied_seq, -1) AS lag
FROM event_sequence es
LEFT JOIN session_projection_checkpoint spc ON spc.session_id = es.aggregate_id
WHERE es.aggregate_id LIKE 'ses_%'  -- hmm, aggregates may not all be sessions
```
Wait — aggregates: event_sequence rows exist per aggregate; sessions are aggregates (aggregate_id = session ID for session events). Is event.aggregate always a session? EventV2 durable aggregates — session events use sessionID as aggregate. Other aggregates? possibly other types. The db status --sessions panel: per-session drain owner (event_sequence.owner_id), projection backlog (gauge above), pending inputs:
```sql
SELECT si.session_id,
       COUNT(*) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'queue') AS pending_queued,
       COUNT(*) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'steer') AS pending_steer
FROM session_input si
GROUP BY si.session_id;
```
I'll write these cleanly.

Parity matrix: 19 tables, every column. Let me now also confirm event.data check at input.ts lines and check session input delivery values (steer/queue). Confirmed from grep: input.ts:258 "steer", :280 "queue".

Also T1: channel name construction — session IDs: check SessionSchema.ID prefix. Let me check quickly: packages/core/src/session/schema.ts. Not strictly needed; truncation rule handles it.

Also for Memo #2 membership evidence: projector.ts:389 shows Tool.Progress projected; Text.Delta — let me verify it exists as event type. grep "Text.Delta" found nothing in projector.ts but the grep matched `message.type === "assistant"`. Let me search for Delta in session events. Quick check.

All evidence gathered. I have:

- 19 tables fully read (drizzle sources + schema.gen.ts snapshot)
- 4 V2-semantics migrations read
- commitDurableEvent read (event.ts:205-366, 514-532)
- readAfter replay query read (event.ts:541-545)
- session_input predicates read (input.ts:136,181,257,279)
- projector tier evidence (projector.ts:374-390, publish-llm-event.ts:255-257 — Text.Delta events)
- Zero payload JSON queries in core/server src (grep empty)
- database.ts dual-backend + PRAGMA + migration apply
- migration.ts runner (journal, fresh-init path)

Now write the deliverables. This must be COMPLETE and EXACT. Structure:

PART 1 — Memos #1-#5
PART 2 — Bootstrap DDL (the signed artifact) + observability queries
PART 3 — Parity matrix (every column of 19 tables + new tables)

Let me carefully compose the parity matrix from what I read:

**workspace** (workspace.sql.ts:6-19, schema.gen.ts:8-18)
- id text PK → text PK
- type text NN → text NN
- name text NN default '' → text NN default ''
- branch text → text
- directory text → text
- extra text json → jsonb
- project_id text NN FK project.id CASCADE → same
- time_used integer NN ($default Date.now) → timestamptz NN

**data_migration** (data-migration.sql.ts:3-6)
- name text PK → text PK
- time_completed integer NN → timestamptz NN

**account_state** (account/sql.ts:16-22)
- id integer PK → integer PK (singleton)
- active_account_id text FK account.id SET NULL → text FK SET NULL
- active_org_id text → text

**account** (account/sql.ts:6-14)
- id text PK, email text NN, url text NN, access_token text NN, refresh_token text NN, token_expiry integer → timestamptz, time_created/time_updated → timestamptz NN

**control_account** (account/sql.ts:25-41) LEGACY
- email text NN, url text NN, PK(email,url); access_token NN, refresh_token NN, token_expiry → timestamptz, active integer-bool NN default false → boolean NN default false, timestamps → timestamptz NN

**credential** (credential/sql.ts:5-16)
- id text PK, integration_id text, label text NN, value text-json NN → jsonb NN, connector_id text, method_id text, active integer-bool → boolean, timestamps → timestamptz NN

**event_sequence** (event/sql.ts:4-8)
- aggregate_id text PK, seq integer NN → bigint NN, owner_id text

**event** (event/sql.ts:10-25) — T5 partitioned
- id text PK → text NN + per-partition UNIQUE(aggregate_id, id); global id uniqueness relies on ID generation (documented deviation)
- aggregate_id text NN FK event_sequence CASCADE → same
- seq integer NN → bigint NN
- type text NN
- data text-json NN → jsonb NN
- per-partition: UNIQUE(aggregate_id, seq); INDEX(aggregate_id, type, seq)

**permission** (permission/sql.ts:7-19)
- id text PK, project_id FK CASCADE NN, action NN, resource NN, timestamps → timestamptz; UNIQUE(project_id, action, resource)

**project_directory** (project/sql.ts:20-34)
- project_id FK CASCADE NN, directory text NN, type text, strategy text, time_created → timestamptz NN; PK(project_id, directory)

**project** (project/sql.ts:6-18)
- id text PK, worktree text NN (absoluteColumn), vcs, name, icon_url, icon_url_override, icon_color, timestamps → timestamptz, time_initialized → timestamptz, sandboxes text NN (JSON string array) → jsonb NN, commands text-json → jsonb

**message** (session/sql.ts:68-80)
- id text PK, session_id FK CASCADE NN, timestamps → timestamptz, data text-json NN → jsonb NN; INDEX(session_id, time_created, id)

**part** (session/sql.ts:82-98)
- id text PK, message_id FK message CASCADE NN, session_id text NN (no FK — denorm), timestamps → timestamptz, data → jsonb NN; INDEX(message_id, id); INDEX(session_id); fillfactor 80

**session_context_epoch** (session/sql.ts:168-175)
- session_id text PK FK CASCADE, baseline text NN, snapshot text-json NN → jsonb NN, baseline_seq integer NN → bigint NN

**session_input** (session/sql.ts:140-166)
- id text PK, session_id FK CASCADE NN, prompt text-json NN → jsonb NN, delivery text NN, admitted_seq integer NN → bigint NN, promoted_seq integer → bigint, time_created integer NN → timestamptz NN
- PG partial: INDEX(session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL (REWRITE of SQLite full index — key order changes! SQLite: (session_id, promoted_seq, delivery, admitted_seq); PG partial: (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL)
- UNIQUE(session_id, admitted_seq); UNIQUE(session_id, promoted_seq)

**session_message** (session/sql.ts:119-138)
- id text PK, session_id FK CASCADE NN, type text NN, seq integer NN → bigint NN, timestamps → timestamptz, data → jsonb NN
- UNIQUE(session_id, seq); INDEX(session_id, type, seq); INDEX(session_id, time_created DESC, id DESC); INDEX(time_created); fillfactor 80

**session** (session/sql.ts:22-66)
- id text PK, project_id FK CASCADE NN, workspace_id text, parent_id text, slug NN, directory NN, path, title NN, version NN, share_url, summary_additions/deletions/files integer → bigint, summary_diffs → jsonb, metadata → jsonb, cost real NN default 0 → double precision, tokens_* integer NN default 0 → bigint ×5, revert → jsonb, permission → jsonb, agent text, model → jsonb, timestamps → timestamptz, time_compacting → timestamptz, time_archived → timestamptz
- INDEX(project_id); INDEX(workspace_id); INDEX(parent_id)

**todo** (session/sql.ts:100-117)
- session_id FK CASCADE NN, content NN, status NN, priority NN, position integer NN, timestamps → timestamptz; PK(session_id, position); todo_session_idx DROPPED (redundant with PK prefix)

**session_share** (share/sql.ts:5-11)
- session_id text PK FK CASCADE, id text NN, secret text NN, url text NN, timestamps → timestamptz

**NEW: session_projection_checkpoint**
- session_id text PK FK session CASCADE, applied_seq bigint NN, time_updated timestamptz NN

**NEW: migration journal** — runner-owned (migration.ts:30): id text PK, time_completed → timestamptz NN (PG variant of runner; note).

Now writing memos with the fixed header. Keep them one-page-ish each but complete. Include OPTIONS >=2, invariants, durable-vs-derived, failure-modes-updated, conditions, unverified, oracle-counter-sign.

Memo #1 D1: per-process vs per-session channels.
Criteria per prompt: connection pinning requirements, fan-out cardinality at ~dozens of sessions, LISTEN connection failure blast radius (one channel vs many lost on reconnect), NOTIFY queue pressure.
- Pinning: identical — one dedicated LISTEN connection per process either way; channels multiplex over one connection. Per-process needs static single LISTEN (no bookkeeping); per-session needs dynamic LISTEN/UNLISTEN set management.
- Fan-out: per-session = exactly 1 NOTIFY per committed event, delivered only to interested listeners. Per-process broadcast = P NOTIFYs per event (P = live processes), each fanned to one listener; or requires a durable interest registry so writers know which process owns/observes which session → new durable state, more failure modes.
- Blast radius on LISTEN reconnect: both lose the single connection. Per-process: one channel to re-acquire. Per-session: all channels lost; recovery = re-LISTEN set + catch-up scan. But catch-up scan is REQUIRED in both designs (notifications lost during disconnect gap). So per-session only adds "re-acquire channel set" — cheap if the interest set is process-local state already.
- Queue pressure: per-backend notification queues; per-session minimal.
Verdict: per-session truncated channels oc_s_<id> (63-byte truncate rule), tiny payload {"s":<sessionId>,"p":<processId>} or even just sessionID; self-drop by processId; backstop poll always-on over the partial index. Conditions: payload ≤ ~200 bytes (tiny), NEVER events; listener order on reconnect: LISTEN (commit) → catch-up scan → resume; drain arbitration NOT via NOTIFY.

Memo #2 T3: async-tier membership = projection-only events (Text.Delta via publish-llm-event.ts:255-257, Tool.Progress projector.ts:389) materialized in session_message.data/part.data; sync tier = session_input admissions, promotions, epoch, event+event_sequence, structural session rows. Checkpoint table enters bootstrap. HARD FENCE restated + enforcement condition: flush batch + checkpoint update in same async tx; synchronous_commit=off only on flush pool; flush-on-read writes go through ASYNC pool too (they're projections) and the gauge must reflect them (gauge = event_sequence.seq - checkpoint.applied_seq; flush-on-read advances checkpoint → observable ✓).

Memo #3 T4: pure client concern; zero bootstrap footprint; the only interface touchpoints are readAggregate (event.ts:63) and readAfter (event.ts:541-545) already covered by replay index; seq-resume discipline uses (aggregate_id, seq) ordering. Scope OUT.

Memo #4 T5: partition IN, 16 partitions, per-partition constraints; documented deviation: no global PK on event.id; changing count later = rewrite; decision now.

Memo #5: bootstrap strategy confirmed; four migrations as DDL sections enumerated with file cites; standing rule; journal table; verification procedure (DUTY 6c) included in memo 5 or artifact. I'll put verification procedure in the artifact tail (Part 4).

FAILURE-MODES-UPDATED: I need to seed the failure-mode table (I own it). I'll create the initial table in the artifact.

Conditions numbering across memos. Also UNVERIFIED items: e.g., UNVERIFIED: session ID max length → cheapest resolve: check SessionSchema.ID generator. Let me quickly verify session ID format to be thorough — actually let me check schema.ts for ID.

All evidence is in. Quick final check on session ID shape (T1 channel truncation rule), then I produce the artifacts:

Session IDs: `"ses_" + descending()` — descending ULID-ish, so ses_ + 26 chars ≈ 30 chars. Channel "oc_s_" + 30 = 35 bytes < 63. Truncation rule still needed as a guard for future ID shapes.

Now I have everything. Time to write the full deliverable. It must be complete and exact. Let me structure:

---

PART 0 — files read (evidence base)
PART 1 — DECISION MEMOS #1–#5
PART 2 — BOOTSTRAP DDL ARTIFACT (signed)
PART 3 — PARITY MATRIX
PART 4 — VERIFICATION PROCEDURE (duty 6c) + failure-mode table seed

The DDL needs to be complete, runnable PG 17 SQL. 16 partitions × explicit DDL. Table order matters for FKs: project first, then workspace, etc. FK dependencies:
- project (no FK)
- project_directory → project
- workspace → project
- session → project
- account (no FK)
- account_state → account
- control_account (no FK)
- credential (no FK)
- event_sequence (no FK)
- event → event_sequence (partitioned)
- permission → project
- message → session
- part → message
- session_context_epoch → session
- session_input → session
- session_message → session
- session_projection_checkpoint → session (NEW)
- todo → session
- session_share → session
- data_migration (no FK)

Order in DDL: project, project_directory, workspace, session... wait session references project only. account, account_state, control_account, credential, data_migration, event_sequence, event + partitions, permission, message, part, session_context_epoch, session_input, session_message, session, session_projection_checkpoint, session_share, todo. Actually message→session means session must exist before message. Schema.gen.ts creates message BEFORE session (SQLite doesn't check FK at CREATE). PG requires the referenced table to exist. So order: project, workspace, session, message, part, todo, session_message, session_input, session_context_epoch, session_share, permission, project_directory, account, account_state, control_account, credential, data_migration, event_sequence, event+partitions, session_projection_checkpoint.

event FK: partitioned event references event_sequence(aggregate_id) — allowed in PG (unique/PK on parent event_sequence). CREATE TABLE event PARTITION BY HASH then CREATE TABLE event_pXX PARTITION OF event FOR VALUES WITH MODULUS... Each partition inherits columns; constraints/indexes created per-partition. Parent-level index creation propagates to partitions in PG 11+ (CREATE INDEX ON ONLY vs parent). Better: create indexes on the parent (partitions auto-create matching indexes). UNIQUE constraints on the parent must include partition key — UNIQUE (aggregate_id, seq) includes aggregate_id ✓ so it CAN be declared on the parent and PG will enforce per-partition and create partition indexes automatically. INDEX (aggregate_id, type, seq) parent-level propagates. UNIQUE (aggregate_id, id) includes aggregate_id ✓. So DDL: parent with UNIQUE (aggregate_id, seq), UNIQUE (aggregate_id, id), INDEX (aggregate_id, type, seq); then 16 partitions; PG auto-creates the indexes on each partition. 

Wait — do I want PRIMARY KEY on parent? PG requires PK to include partition key. I can declare PRIMARY KEY (aggregate_id, seq) on event — that makes (aggregate_id, seq) the PK. commitDurableEvent dedupe order: unique event_aggregate_seq_idx. Making it the PK is cleaner. And UNIQUE (aggregate_id, id) secondary. And the replay index. But autovacuum settings per-partition: ALTER TABLE event_pXX SET (autovacuum...) — must set per partition (reloptions don't propagate from parent? Actually partitions don't inherit reloptions from parent — set per partition. For 16 partitions that's 16 statements; fine, or use a DO loop. Migrations are raw SQL wrapped by script/migration.ts — a DO $$ loop is acceptable but explicit is better for the artifact. I'll write them explicitly — complete and exact. 16 partitions × ~4 lines. OK.

Also FK event.aggregate_id → event_sequence ON DELETE CASCADE: FK from partitioned parent is allowed (referencing side). ✓ event.ts:514-519 remove() deletes event_sequence row and relies on cascade (actually it deletes both explicitly).

jsonb defaults: session.cost double precision DEFAULT 0, tokens bigint DEFAULT 0, control_account.active boolean DEFAULT false, workspace.name text DEFAULT ''.

Timestamps: timestamptz with DEFAULT? The app supplies values via $default(() => Date.now()) — app-side defaults. PG-side DEFAULT now()? For safety: NOT NULL without server default (app always supplies — schema.sql.ts $default). But session_input.time_created also $default. Keep NO server-side defaults for timestamps except where SQLite DDL had DEFAULT (cost, tokens, name, active — those keep defaults). This preserves "app writes values" and avoids clock skew between app and DB. Document in matrix.

GIN: none (evidence: zero payload queries — grep across core+server src returned nothing outside migrations).

Extensions block:
```sql
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements unavailable (%) — continuing', SQLERRM;
END $$;
```
Plus comment that stats only populate when shared_preload_libraries includes it (compose sets it).

Observability queries (Duty 7):

Projection-lag gauge:
```sql
-- projection-lag gauge: per-session backlog of unprojected committed events
SELECT
  s.id AS session_id,
  es.seq AS committed_seq,
  COALESCE(spc.applied_seq, -1) AS applied_seq,
  es.seq - COALESCE(spc.applied_seq, -1) AS projection_lag
FROM session s
JOIN event_sequence es ON es.aggregate_id = s.id
LEFT JOIN session_projection_checkpoint spc ON spc.session_id = s.id
ORDER BY projection_lag DESC;
```
Note: aggregates for non-session aggregates excluded by join to session.

db status --sessions panel:
```sql
-- per-session panel: drain owner, projection backlog, pending inputs
SELECT
  s.id AS session_id,
  es.owner_id AS drain_owner,
  es.seq - COALESCE(spc.applied_seq, -1) AS projection_lag,
  COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'queue') AS pending_queued,
  COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL AND si.delivery = 'steer') AS pending_steer,
  MAX(si.admitted_seq) FILTER (WHERE si.promoted_seq IS NULL) AS next_pending_admitted_seq
FROM session s
LEFT JOIN event_sequence es ON es.aggregate_id = s.id
LEFT JOIN session_projection_checkpoint spc ON spc.session_id = s.id
LEFT JOIN session_input si ON si.session_id = s.id
GROUP BY s.id, es.owner_id, es.seq, spc.applied_seq
ORDER BY projection_lag DESC NULLS LAST;
```

Pending-inbox backstop poll query (T1 backstop, for reference):
```sql
SELECT session_id, id, delivery, admitted_seq
FROM session_input
WHERE promoted_seq IS NULL
ORDER BY session_id, admitted_seq
LIMIT 64;
```
(uses partial index scan)

Now the memos. Fixed header format per protocol. Then PART 4 verification procedure (duty 6c) and failure-mode table.

Effort estimates not needed (no rework). Memos need OPTIONS ≥2 each.

Let me also double-check: "todo_session_idx" drop — is it truly redundant? PK (session_id, position); index (session_id) alone — any query filtering by session_id only can use PK prefix. Yes redundant. Documented in matrix as intentional deviation.

Also "session_message_time_created_idx" (global time) — keep (time_created timestamptz; used for global recent listings presumably). Keep all others.

One more check on my invariant: "session_input: partial index on (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL" — matches accepted baseline text exactly. And "unique (session_id, promoted_seq) backstops races" ✓ both unique indexes carried.

Message table index: (session_id, time_created, id) — for PG I'll write it as (session_id, time_created DESC, id DESC) matching my hot-path invariant style for session_message; for message parity keep (session_id, time_created, id) — hmm invariant list says "session_message: history pagination index (session_id, time_created DESC, id DESC)". Only session_message specified DESC. I'll do DESC for both message and session_message for V1/V2 history paths; document in matrix (functionally equivalent, direction-native). Actually to be safe: SQLite message index is ASC (session_id, time_created, id). PG btree ASC index scanned backward = same. Either fine. I'll use DESC to match invariant text and note equivalence.

Timestamptz column names stay time_created etc. (snake_case preserved, no renames) — good for parity and the "touch every consumer once" baseline.

 bigint for seq-family: event.seq, event_sequence.seq, session_message.seq, session_input.admitted_seq/promoted_seq, session_context_epoch.baseline_seq, session_projection_checkpoint.applied_seq. Position → integer. summary_* → integer or bigint? summary_additions counts lines — could exceed 2^31 in pathological giant diffs? 2.1B lines... no. But tokens_total across a long session: 2.1B tokens — a heavy session might hit hundreds of thousands; fine for int4. But cumulative cost counters on SESSION table are per-session, small. Hmm — I'll map summary_* → integer, tokens_* → bigint (cheap insurance, model token accounting can be large with cache-write loops), cost → double precision. Actually let me be decisive and defensible: tokens_* → bigint (counters, monotonic growth, cache-write can inflate massively), summary_* → integer. OK.

account_state.id integer — singleton row (id=1). Keep integer.

Now write it all. Length will be large but must be complete. Let me write the final response now. I'll keep memo prose tight.

For memo #1 criteria comparison table — concise.

T1 payload: {"p":"<processId>","s":"<sessionID>"} — but sessionID derivable from channel name; payload only needs processId for self-drop: payload = processId string. Keep it that simple: pg_notify('oc_s_<trunc(sessionId)>', processId). Self-drop: listener compares payload to its own process tag. Tiny ✓.

Also memo 1 must state: NOTIFY emitted inside commitDurableEvent's existing transaction (event.ts:239-352 db.transaction) — after event insert, same tx. And "staggered poll backstop" over partial index — always on, staggered per session to avoid thundering herd.

Reconnect protocol (condition): on LISTEN connection drop → new connection, LISTEN all channels of interest (committed), THEN catch-up scan (readAfter / pending scan) for every interested session, then resume streaming. Notifications between LISTEN-commit and scan may double-deliver — dedupe by (aggregate_id, seq) — at-least-once, correctness-neutral.

Memo #2 conditions:
1. session_projection_checkpoint in bootstrap (DDL provided).
2. Async tier membership: ONLY projection materialization of Text.Delta + Tool.Progress (and derived message/part/session aggregate counters updated in the same projection batch). Everything else sync.
3. Batch + checkpoint same async tx (checkpoint never ahead of durable projection rows).
4. synchronous_commit=off ONLY via SET on the flush pool connections (session scope), never ALTER SYSTEM/ DATABASE.
5. HARD FENCE restated: session_input INSERT, promotion UPDATE (input.ts:131-136), session_context_epoch writes, event/event_sequence writes NEVER on flush pool — enforcement: flush pool exposes only projection-write statements (code review gate + connection tag check).
6. Flush-on-read writes via async pool AND advance checkpoint so gauge sees them; flush-on-read regression visible when gauge lag jumps after history reads.
7. fillfactor 80 on part + session_message; wal_compression via compose.

Memo #4: 16 partitions; OPTIONS: (a) no partitioning — rejected: one-way door + event is hottest append table with per-partition autovacuum payoff; (b) 32 — rejected: doubled relation overhead with zero pruning benefit at hash equality (aggregate_id = ? prunes to exactly one partition regardless); (c) 16 — accepted; (d) 8 — rejected: sooner rewrite door. Deviation documented: no global UNIQUE on event.id → per-partition UNIQUE (aggregate_id, id); cross-aggregate id collision detection (event.ts:303-315) becomes aggregate-scoped; acceptable because event IDs are generated ses-prefixed ULIDs (id.ts:8 style) and same-aggregate dupes (the replay-divergence case the check actually guards) remain enforced.

Memo #5: four DDL sections enumerated; standing rule; 20260622202450_reset_v2_session_state has NO DDL section (data reset for pre-GA users — no structural content; PG bootstrap starts empty); probe port information_schema; advisory lock 727274 via client.reserve.

OK. Writing final answer now. It will be long; that's the job. No more tool calls needed.

All evidence gathered. Producing the artifacts.

---

# EVIDENCE BASE — files opened this session

| File | What it established |
|---|---|
| `packages/core/src/database/schema.gen.ts:8-271` | Authoritative SQLite DDL snapshot: all 19 tables, all 21 indexes |
| `packages/core/src/session/sql.ts:22-175` | session, message, part, todo, session_message, session_input, session_context_epoch column definitions |
| `packages/core/src/event/sql.ts:4-24` | event, event_sequence definitions |
| `packages/core/src/account/sql.ts` (cat) | account, account_state, control_account |
| `packages/core/src/project/sql.ts:6-34` | project, project_directory |
| `packages/core/src/credential/sql.ts`, `packages/core/src/permission/sql.ts`, `packages/core/src/share/sql.ts`, `packages/core/src/control-plane/workspace.sql.ts`, `packages/core/src/data-migration.sql.ts` (cat) | remaining 5 tables |
| `packages/core/src/database/schema.sql.ts:3-9` | Timestamps helper (integer epoch-ms, app-side `$default`/`$onUpdate`) |
| `packages/core/src/database/path.ts` | custom path columns are `text` storage; `absoluteArrayColumn` = JSON string |
| `packages/core/src/database/migration.ts:18-41,43-80` | runner: fresh-init path, journal table, sqlite_master probe |
| `packages/core/src/database/migration.gen.ts:5-42` | 37 migration IDs |
| `packages/core/src/database/migration/20260603141458_session_input_inbox.ts` | inbox creation |
| `packages/core/src/database/migration/20260604172448_event_sourced_session_input.ts` | current session_input shape + 3 indexes |
| `packages/core/src/database/migration/20260605003541_add_session_context_snapshot.ts` | epoch creation (pre-simplify) |
| `packages/core/src/database/migration/20260622142730_simplify_session_context_epoch.ts` | epoch final shape (drops agent/replacement_seq/revision) |
| `packages/core/src/database/migration/20260622202450_simplify_session_input.ts` | V2 state reset (data-only, no DDL) |
| `packages/core/src/database/migration/20260323234822_events.ts` | original event/event_sequence DDL |
| `packages/core/src/event.ts:205-366, 505-545` | commitDurableEvent tx, seq assignment, event_sequence upsert (324-335), event insert (336-348), remove (514-519), readAfter replay query (541-545) |
| `packages/core/src/session/input.ts:131-136,181,257-258,279-280` | promotion UPDATE with `isNull(promoted_seq)`; pending queries; deliveries `steer`/`queue` |
| `packages/core/src/session/projector.ts:374-390` | projector event-type membership incl. Tool.Progress |
| `packages/core/src/session/runner/publish-llm-event.ts:255-257` | Text.Delta publish (high-frequency tier) |
| `packages/core/src/database/database.ts` | dual-backend path, PRAGMAs, `DatabaseMigration.apply` |
| `packages/schema/src/session-id.ts:8` | session IDs = `"ses_" + descending()` (~30 chars) |
| grep `json_extract\|->>` across `packages/core/src`, `packages/server/src` | **zero** payload-field JSON queries outside migrations → GIN stays out |

---

# PART 1 — DECISION MEMOS #1–#5

---

```
DECISION MEMO #1 — T1 WAKE BUS: CHANNEL TOPOLOGY (D1 divergence)
STATUS: APPROVED
TRIGGER: e (NOTIFY channel topology, payload shape, reconnection, listener lifecycle)
VERDICT: APPROVE
```

**OPTIONS**

- **A. Per-session truncated channels `oc_s_<trunc(session_id)>`** — one NOTIFY per committed event, on the channel named for the session the event belongs to.
- **B. Per-process channel `oc_p_<process_tag>` broadcast** — every committer NOTIFYs every live process channel.
- **C. Per-process channel + durable interest registry** — writers consult a registry mapping process→sessions to notify only the interested process.

**Comparison on the four mandated criteria:**

1. **Connection pinning.** Identical cost: channels multiplex over ONE dedicated LISTEN connection per process either way (`LISTEN oc_s_a; LISTEN oc_s_b;` on one session). A needs dynamic LISTEN/UNLISTEN set management; B/C need a static single LISTEN. Pinning is NOT a differentiator; bookkeeping is, and B wins it — but B loses everything below.
2. **Fan-out cardinality at ~dozens of sessions.** A emits exactly 1 NOTIFY per committed event delivered to interested listeners. B emits P NOTIFYs per event (P = live processes) — at N sessions × high event rates (Text.Delta) that's a P× multiplier on notification traffic with most deliveries discarded as uninteresting. C requires NEW durable state (interest registry) whose invalidation on process death is a fresh failure mode — durable-vs-derived violation for a pure wakeup concern: wakeups are derived, must not own rows.
3. **LISTEN connection failure blast radius.** Both lose the single pinned connection. B loses one channel; A loses the whole channel set — but recovery in BOTH designs must run a catch-up data scan anyway (notifications committed during the disconnect gap are unrecoverable), so the marginal cost of A is only re-issuing the LISTEN set, which is process-local state the process already holds. Blast radius is effectively equal *given catch-up is mandatory*.
4. **NOTIFY queue pressure.** A is minimal: each notification is queued only on backends listening to that channel. B multiplies per-backend queue entries by P. PG notification queues are per-backend and trigger no global bottleneck at this scale, but A is strictly smaller.

**Adjudication: A.** The Artistry baseline (per-session truncated channels) stands. B's single advantage (one static LISTEN) does not pay for P× notification multiplication; C introduces durable state for a derived concern and is rejected on durable-vs-derived grounds.

**Design pinned by this memo:**

- Channel name: `oc_s_` + session_id, truncated to 63 bytes total (`NAMEDATALEN-1`). Current IDs (`ses_` + 26-char descending ULID, `packages/schema/src/session-id.ts:8`) yield `oc_s_ses_…` ≈ 35 bytes; truncation is a guard for future ID shapes. Truncation MUST be stable and applied identically at emitter and listener (one shared helper).
- Payload: tiny string only — the emitter's process tag. Listener self-drops when payload equals its own tag. NEVER payload-bearing events (8000-byte NOTIFY limit; correctness never depends on NOTIFY).
- Emission site: inside commitDurableEvent's existing transaction (`packages/core/src/event.ts:239-352`), same tx as the event insert — transactional wakeup: no notification for rolled-back events, no wakeup before visibility.
- Listener lifecycle: one pinned LISTEN connection per process; LISTEN set = sessions with live local interest; on drop: reconnect → re-LISTEN (commit) → **catch-up scan before resume** (readAfter/pending scan per interested session) → resume. At-least-once delivery; consumers dedupe by (aggregate_id, seq).
- Poll backstop: always-on, staggered per-session polls over the partial pending index (`session_input … WHERE promoted_seq IS NULL`). NOTIFY is latency optimization only.
- Drain arbitration is NOT part of this memo: SKIP LOCKED baseline is pre-decided system-wide and untouched.

**INVARIANTS**
- "NOTIFY payload is tiny, never payload-bearing events" — pass (process tag string).
- "Correctness never depends on NOTIFY — poll backstop always-on" — pass (staggered poll over partial index mandated).
- V2 Session Core "advisory wakes drain eligible durable inbox rows" — pass (wakeup, not command; drains read the inbox).

**DURABLE-vs-DERIVED:** derived only. Wakeups carry no durable state; C rejected partly on this line.

**FAILURE-MODES-UPDATED:** yes — FM-01 (LISTEN conn drop mid-drain), FM-02 (NOTIFY storm), FM-03 (channel truncation collision) added to table (Part 4).

**CONDITIONS**
1. Shared truncation helper, single definition, used by emitter and listener; channel construction is unit-tested against the 63-byte limit.
2. Reconnect sequence LISTEN→catch-up→resume is implemented in that order and asserted in the reconnect test; notifications received between LISTEN-commit and scan end may duplicate — consumers must dedupe, not assume.
3. Backstop poll staggering is per-session jittered; no synchronized scan bursts.
4. The LISTEN connection is a dedicated pinned connection outside the general pool (baseline: dedicated pinned connections for LISTEN) — never a pooled checkout.

**UNVERIFIED**
1. UNVERIFIED: postgres-js exposes the notifier's backend PID per notification — cheapest resolve: read postgres-js docs/`PgNotification` type; if absent, the process-tag payload (chosen) makes this moot.

**ORACLE-COUNTER-SIGN:** not-required

---

```
DECISION MEMO #2 — T3 TWO-TIER COMMIT: ASYNC-TIER MEMBERSHIP + CHECKPOINT TABLE
STATUS: APPROVED
TRIGGER: b (async-tier membership), a (session_projection_checkpoint DDL)
VERDICT: APPROVE
```

**OPTIONS**

- **A. Two tiers with checkpoint-gated batch flush (baseline T3).** Sync tier commits in-tx; async tier batches projection-only writes behind `session_projection_checkpoint(session_id PK, applied_seq)`.
- **B. Single tier, all synchronous.** Simplest, no fence — but Text.Delta/Tool.Progress volumes make every token a synchronous round trip; rejected on the fast-access requirement and the observed publish path (`packages/core/src/session/runner/publish-llm-event.ts:255-257`).
- **C. Two tiers, checkpoint in a side table written by a third connection.** Introduces checkpoint-ahead-of-data windows; rejected — see HARD FENCE analysis.

**Adjudication: A**, with the fence and ordering rules below.

**Tier membership (authoritative list):**

- **SYNC tier (transactional pool, default synchronous_commit):**
  - `event` + `event_sequence` writes (`packages/core/src/event.ts:324-348`) — the log is the only truth.
  - `session_input` INSERT (admission — V2 invariant) and promotion UPDATE with `promoted_seq IS NULL` predicate (`packages/core/src/session/input.ts:131-136`).
  - `session_context_epoch` writes.
  - Structural rows: `session`, `message`, `part`, `session_message`, `todo`, `session_share` inserts and non-projection updates; `permission`, `project*`, `workspace`, account/credential tables.
- **ASYNC tier (flush pool, `SET synchronous_commit = off` session-level):**
  - Projection materialization of high-frequency events: `SessionEvent.Text.Delta`, `SessionEvent.Tool.Progress` (`packages/core/src/session/projector.ts:389` for the latter), and the derived `session_message.data`/`part.data` mutation batches plus session usage counters those projections carry in the same batch.
  - Flush-on-read writes at history entry points (projections by definition).

**Checkpoint ordering rule (rejects C):** each flush batch writes the projected rows AND advances `session_projection_checkpoint.applied_seq` in the SAME async transaction. Crash then loses both together (replay from last durable checkpoint) — never checkpoint-ahead-of-projection, never projection-ahead-of-checkpoint.

**HARD FENCE (restated, enforced):** an admitted `session_input` row or a committed epoch write flushed via the async pool is an automatic REJECT. Enforcement: the flush pool's write surface is restricted to projection statements (code-review gate at every PR touching pool usage); a session_input/epoch statement on the flush pool is a blocking review failure.

**Gauge observability:** projection-lag gauge = `event_sequence.seq − COALESCE(session_projection_checkpoint.applied_seq, −1)` per session (query in Part 2). Flush-on-read advances `applied_seq`, so a broken flush-on-read surfaces as a lag jump after history reads — the regression is visible in `db status`.

**INVARIANTS**
- "any variant where an admitted session_input or committed epoch write is ever flushed via the async pool is an automatic REJECT" — pass (membership list + fence enforcement).
- "Flush-on-read must be observable via the projection-lag gauge" — pass (checkpoint advanced by flush-on-read).
- V2 admission-before-wake — pass (admission is sync-tier by construction).

**DURABLE-vs-DERIVED:** async tier is 100% derived (projections of the event log). Checkpoint rows are derived bookkeeping — safe to lose, replayable. The durable line (event log, inbox, epoch) is exclusively sync.

**FAILURE-MODES-UPDATED:** yes — FM-04 (flush-pool crash mid-batch), FM-05 (fence breach), FM-06 (checkpoint skew).

**CONDITIONS**
1. `session_projection_checkpoint` enters the bootstrap exactly as DDL'd in Part 2.
2. `synchronous_commit = off` applied ONLY via `SET` on flush-pool connections; no `ALTER SYSTEM`/`ALTER DATABASE`.
3. Batch+checkpoint same-transaction rule is load-bearing; a PR that separates them is REJECT on sight.
4. `fillfactor = 80` on `part` and `session_message` (HOT room for `data` updates); `wal_compression = on` set via compose `command:` (GUC, not migration DDL).
5. Flush pool max connections sized separately from the session pool; documented in deploy notes.

**UNVERIFIED**
1. UNVERIFIED: HOT-update rate actually achieved on `session_message.data` at fillfactor 80 — cheapest resolve: `pg_stat_user_tables.idx_upd_hot_pct` observation on staging after 1 week; tune then.

**ORACLE-COUNTER-SIGN:** not-required

---

```
DECISION MEMO #3 — T4 CLIENT-SIDE PROJECTION: BOOTSTRAP FOOTPRINT
STATUS: APPROVED
TRIGGER: (none of a-e; adjudication required by TASK 1)
VERDICT: APPROVE (scoped OUT of bootstrap)
```

**OPTIONS**

- **A. Pure client concern; zero bootstrap footprint.**
- **B. Server-side durable cursor table for client resume points.** New durable state for a derived concern; the durable()/memory() adapters + seq-resume discipline already carry resume; rejected on durable-vs-derived.

**Adjudication: A.** T4's only DB touchpoints are reads: `readAggregate` (`packages/core/src/event.ts:63`) and `readAfter` (`packages/core/src/event.ts:541-545` — `WHERE aggregate_id = ? AND seq > ? ORDER BY seq ASC`). Both are already covered by the replay index mandated by the hot-path invariants (Part 2). No table, no column, no GIN, no migration section. Compaction bounds memory client-side; nothing server-side.

**INVARIANTS** — event replay index covers (aggregate_id, seq) ordering — pass (Part 2 DDL).

**DURABLE-vs-DERIVED:** untouched; B rejected for touching it.

**FAILURE-MODES-UPDATED:** no.

**CONDITIONS** — none.

**UNVERIFIED** — none.

**ORACLE-COUNTER-SIGN:** not-required

---

```
DECISION MEMO #4 — T5 HASH-PARTITIONED EVENT LOG: IN, 16 PARTITIONS
STATUS: APPROVED
TRIGGER: a (DDL change to event), c (enters bootstrap)
VERDICT: APPROVE
```

**OPTIONS**

- **A. No partitioning.** Simplest catalog; but the one-way door means converting later requires rewriting the hottest, largest table under load.
- **B. HASH (aggregate_id), 32 partitions.**
- **C. HASH (aggregate_id), 16 partitions.**
- **D. HASH (aggregate_id), 8 partitions.**

**Adjudication: C.**

- **Partitioning itself: IN.** `event` is the hottest append table (every durable event, including per-token Text.Delta events, inserts here via `packages/core/src/event.ts:336-348`). Partitioning buys parallel vacuum/analyze, smaller per-partition indexes, and per-partition autovacuum tuning (0.01/0.005 mandated by baseline). The one-way door argues for deciding now, correctly: retrofit = full rewrite.
- **Count: 16, not 32.** Hash partitioning prunes `aggregate_id = ?` (the `readAfter` predicate, `event.ts:546`) to exactly ONE partition regardless of count — more partitions never improve the hot query. More partitions only shrink per-partition size and add vacuum fan-out, at linear relation/index/planning overhead. 32 is cargo cult from deployments far above staging/beta; 8 under-provisions the growth path into clustering where the rewrite door bites hardest. 16 is the defensible middle, recorded as final.
- **Constraint shape (per-partition, declared on parent so PG propagates):**
  - `PRIMARY KEY (aggregate_id, seq)` — includes the partition key; replaces `event_aggregate_seq_idx` uniqueness, preserves exact-seq commit (T2 accepted).
  - `UNIQUE (aggregate_id, id)` — preserves event-ID dedupe within an aggregate.
  - `INDEX (aggregate_id, type, seq)` — replay/type-filter path.
- **Documented deviation (accepted):** SQLite's global `event.id` PK (`packages/core/src/event/sql.ts:13`) becomes impossible under declarative partitioning. Cross-aggregate id collision detection (`packages/core/src/event.ts:303-315`) becomes aggregate-scoped. Acceptable: event IDs are generated ULID-shaped strings (collision ~2^-104 scale), and the case that check actually guards — same-aggregate replay divergence — remains fully enforced by `UNIQUE (aggregate_id, id)` + `PRIMARY KEY (aggregate_id, seq)`.
- FK `event.aggregate_id → event_sequence(aggregate_id) ON DELETE CASCADE` works from a partitioned table (`remove()` path, `event.ts:514-519`).

**INVARIANTS**
- "event: (aggregate_id, seq) unique; per-session ordering intact; replay index covers (aggregate_id, seq) [+] type/id or per-partition equivalent" — pass (PK on parent propagates per-partition; INDEX (aggregate_id, type, seq) propagates; id covered by UNIQUE (aggregate_id, id)).
- Exact-seq event commit via FOR UPDATE on event_sequence (T2) — pass (event_sequence untouched, plain table).

**DURABLE-vs-DERIVED:** durable line (the log); structure-only change, semantics preserved.

**FAILURE-MODES-UPDATED:** yes — FM-07 (repartition rewrite), FM-08 (cross-aggregate id collision undetected).

**CONDITIONS**
1. Partition count is FIXED at 16; changing it after data load is a rewrite — treat as one-way door.
2. Deviation (no global `event.id` uniqueness) recorded in the parity matrix (Part 3) and accepted explicitly here.
3. Partition naming `event_p00..event_p15`, MODULUS 16, REMAINDER 0..15.

**UNVERIFIED**
1. UNVERIFIED: planner picks single-partition prune for `aggregate_id = ? AND seq > ?` — cheapest resolve: `EXPLAIN` the readAfter query on the scratch PG during Part 4 verification; assert "partitions considered: 1".

**ORACLE-COUNTER-SIGN:** not-required

---

```
DECISION MEMO #5 — BOOTSTRAP STRATEGY: SINGLE 0000_init
STATUS: APPROVED
TRIGGER: c (migration cut)
VERDICT: APPROVE
```

**OPTIONS**

- **A. Single fresh PG bootstrap `0000_init`** generated from `schema.gen.ts` + PG overlay (baseline).
- **B. Port the 37 TS migrations.** Rejected by baseline; also incoherent — they encode SQLite history (PRAGMA foreign_keys, __new_ table reshuffles) irrelevant to a fresh PG.
- **C. Bootstrap + supplemental PG deltas.** Violates the standing rule (every PG-only structure lives in the bootstrap); drifts immediately.

**Adjudication: A.**

- One migration file is the one truth of the PG schema. Full DDL in Part 2 is the signed source; the implementer generates `0000_init` from it via drizzle-kit dialect=postgresql, then regenerates `migration.gen.ts`/`schema.gen.ts` — never hand-edited.
- **The four V2-semantics migrations re-expressed as DDL sections in the bootstrap** (they encode current behavior, not history):
  1. `20260603141458_session_input_inbox` → superseded by (2); contributes nothing structural beyond it.
  2. `20260604172448_event_sourced_session_input` → current `session_input` column set + the three inbox indexes (one REWRITTEN as the PG partial index per hot-path invariant — column order `(session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL`, replacing SQLite's full `(session_id, promoted_seq, delivery, admitted_seq)`).
  3. `20260605003541_add_session_context_snapshot` (+ `20260622142730_simplify_session_context_epoch` which only drops columns) → final-shape `session_context_epoch` DDL.
  4. `20260622202450_simplify_session_input` — data-only reset for pre-GA users; **no DDL section**; PG bootstrap starts empty, so it is intentionally omitted and recorded here.
- Runner (implementer ports `migration.ts`): probe `information_schema.tables` for `'session'`; fresh → run `0000_init` + create journal; `pg_advisory_lock(727274)` via `client.reserve`, released in finalizer (never pooled checkout); journal inserts `0000_init` only; `INSERT OR IGNORE` → `onConflictDoNothing()`. Advisory lock doubles as boot readiness barrier.
- Standing rule: every PG-only structure (partial index, checkpoint table, partitions, fillfactor, autovacuum per-table, extension statement) lives in `0000_init` — never as a delta over SQLite history. Future schema changes are new numbered PG migrations after `0000_init`.

**INVARIANTS** — all hot-path items in Part 2 DDL; pass list in Part 2 tail.

**DURABLE-vs-DERIVED:** unchanged; bootstrap materializes both lines exactly as designed.

**FAILURE-MODES-UPDATED:** yes — FM-09 (concurrent boot migration race → advisory lock), FM-10 (probe false-negative on empty non-session schema).

**CONDITIONS**
1. Bootstrap is emitted from my Part 2 DDL verbatim (names, order, settings); any divergence at review is a REJECT until re-blessed.
2. Verification procedure (Part 4) runs on the compose `db` service before merge of the bootstrap PR.

**UNVERIFIED**
1. UNVERIFIED: drizzle-kit emits `PARTITION BY` + per-partition DDL from a schema definition — cheapest resolve: spike; if not, partitions are raw SQL statements inside the migration `up(tx)` (allowed — migrations wrap raw SQL via `script/migration.ts`).

**ORACLE-COUNTER-SIGN:** not-required

---

# PART 2 — THE OPTIMIZED PG SCHEMA (signed artifact)

Complete bootstrap DDL, PG 17. This text is the source the implementer commits as `0000_init` (drizzle-kit generates; raw-SQL partition/fillfactor sections are permitted inside `up(tx)` per Memo #5 Condition 1). Table order respects FK dependencies (unlike `schema.gen.ts`, which relies on SQLite's non-checking DDL).

```sql
-- =====================================================================
-- opencode-pg 0000_init — single fresh PostgreSQL bootstrap
-- Signed: Athena (DB key), this session. Source of truth for PG schema.
-- Types: timestamptz everywhere SQLite had epoch-ms integers.
--        jsonb everywhere SQLite had text-mode JSON. No GIN (zero
--        payload-field queries observed in core/server src).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS (pg_stat_statements only — baseline)
-- Stats populate only when shared_preload_libraries includes it
-- (set in compose command); CREATE must tolerate absence (warn-continue)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements unavailable (%) - continuing without it', SQLERRM;
END $$;

-- ---------------------------------------------------------------------
-- 1. PROJECT
-- ---------------------------------------------------------------------
CREATE TABLE "project" (
  "id" text PRIMARY KEY,
  "worktree" text NOT NULL,
  "vcs" text,
  "name" text,
  "icon_url" text,
  "icon_url_override" text,
  "icon_color" text,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "time_initialized" timestamptz,
  "sandboxes" jsonb NOT NULL,
  "commands" jsonb
);

CREATE TABLE "project_directory" (
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "directory" text NOT NULL,
  "type" text,
  "strategy" text,
  "time_created" timestamptz NOT NULL,
  CONSTRAINT "project_directory_pk" PRIMARY KEY ("project_id", "directory")
);

-- ---------------------------------------------------------------------
-- 2. WORKSPACE
-- ---------------------------------------------------------------------
CREATE TABLE "workspace" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "branch" text,
  "directory" text,
  "extra" jsonb,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "time_used" timestamptz NOT NULL
);

-- ---------------------------------------------------------------------
-- 3. SESSION (+ children)
-- ---------------------------------------------------------------------
CREATE TABLE "session" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "workspace_id" text,
  "parent_id" text,
  "slug" text NOT NULL,
  "directory" text NOT NULL,
  "path" text,
  "title" text NOT NULL,
  "version" text NOT NULL,
  "share_url" text,
  "summary_additions" integer,
  "summary_deletions" integer,
  "summary_files" integer,
  "summary_diffs" jsonb,
  "metadata" jsonb,
  "cost" double precision NOT NULL DEFAULT 0,
  "tokens_input" bigint NOT NULL DEFAULT 0,
  "tokens_output" bigint NOT NULL DEFAULT 0,
  "tokens_reasoning" bigint NOT NULL DEFAULT 0,
  "tokens_cache_read" bigint NOT NULL DEFAULT 0,
  "tokens_cache_write" bigint NOT NULL DEFAULT 0,
  "revert" jsonb,
  "permission" jsonb,
  "agent" text,
  "model" jsonb,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "time_compacting" timestamptz,
  "time_archived" timestamptz
);
CREATE INDEX "session_project_idx" ON "session" ("project_id");
CREATE INDEX "session_workspace_idx" ON "session" ("workspace_id");
CREATE INDEX "session_parent_idx" ON "session" ("parent_id");

CREATE TABLE "message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
);
CREATE INDEX "message_session_time_created_id_idx"
  ON "message" ("session_id", "time_created" DESC, "id" DESC);

CREATE TABLE "part" (
  "id" text PRIMARY KEY,
  "message_id" text NOT NULL REFERENCES "message"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
) WITH (fillfactor = 80);
CREATE INDEX "part_message_id_id_idx" ON "part" ("message_id", "id");
CREATE INDEX "part_session_idx" ON "part" ("session_id");

CREATE TABLE "todo" (
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "status" text NOT NULL,
  "priority" text NOT NULL,
  "position" integer NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  CONSTRAINT "todo_pk" PRIMARY KEY ("session_id", "position")
);
-- "todo_session_idx" intentionally NOT created: redundant —
-- PK ("session_id","position") leading column serves session_id lookups.

CREATE TABLE "session_message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "seq" bigint NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
) WITH (fillfactor = 80);
CREATE UNIQUE INDEX "session_message_session_seq_idx" ON "session_message" ("session_id", "seq");
CREATE INDEX "session_message_session_type_seq_idx" ON "session_message" ("session_id", "type", "seq");
-- history pagination index (hot-path invariant; DESC-native for
-- ORDER BY time_created DESC, id DESC page walks)
CREATE INDEX "session_message_session_time_created_id_idx"
  ON "session_message" ("session_id", "time_created" DESC, "id" DESC);
CREATE INDEX "session_message_time_created_idx" ON "session_message" ("time_created");

-- V2-semantics DDL section (Memo #5):
-- re-expresses 20260603141458 + 20260604172448 (current shape + indexes).
-- Partial index REWRITES SQLite's full (session_id, promoted_seq,
-- delivery, admitted_seq) index: pending scans hit the partial index only.
CREATE TABLE "session_input" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "prompt" jsonb NOT NULL,
  "delivery" text NOT NULL,
  "admitted_seq" bigint NOT NULL,
  "promoted_seq" bigint,
  "time_created" timestamptz NOT NULL
);
CREATE INDEX "session_input_session_pending_delivery_seq_idx"
  ON "session_input" ("session_id", "delivery", "admitted_seq")
  WHERE "promoted_seq" IS NULL;
CREATE UNIQUE INDEX "session_input_session_admitted_seq_idx"
  ON "session_input" ("session_id", "admitted_seq");
-- backstops promotion races; PG (like SQLite) allows multiple NULLs
CREATE UNIQUE INDEX "session_input_session_promoted_seq_idx"
  ON "session_input" ("session_id", "promoted_seq");

-- V2-semantics DDL section (Memo #5):
-- re-expresses 20260605003541 + 20260622142730 (final shape).
CREATE TABLE "session_context_epoch" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "baseline" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "baseline_seq" bigint NOT NULL
);

CREATE TABLE "session_share" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "id" text NOT NULL,
  "secret" text NOT NULL,
  "url" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);

-- T3 (Memo #2): async-tier flush checkpoint. Derived bookkeeping —
-- batch + checkpoint advance share ONE async transaction (HARD rule).
CREATE TABLE "session_projection_checkpoint" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "applied_seq" bigint NOT NULL,
  "time_updated" timestamptz NOT NULL
);

-- ---------------------------------------------------------------------
-- 4. PERMISSION
-- ---------------------------------------------------------------------
CREATE TABLE "permission" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "permission_project_action_resource_idx"
  ON "permission" ("project_id", "action", "resource");

-- ---------------------------------------------------------------------
-- 5. ACCOUNT / CREDENTIAL
-- ---------------------------------------------------------------------
CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" timestamptz,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);

CREATE TABLE "account_state" (
  "id" integer PRIMARY KEY,
  "active_account_id" text REFERENCES "account"("id") ON DELETE SET NULL,
  "active_org_id" text
);

-- LEGACY
CREATE TABLE "control_account" (
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" timestamptz,
  "active" boolean NOT NULL DEFAULT false,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  CONSTRAINT "control_account_pk" PRIMARY KEY ("email", "url")
);

CREATE TABLE "credential" (
  "id" text PRIMARY KEY,
  "integration_id" text,
  "label" text NOT NULL,
  "value" jsonb NOT NULL,
  "connector_id" text,
  "method_id" text,
  "active" boolean,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);

-- data_migration: INTENTIONALLY OMITTED (Memo #6, this session) — zero
-- consumers (grep: only definition + generated snapshot + creating migration
-- 20260511000411); fresh bootstrap has no legacy data-migration state.
-- Reintroduce via a numbered PG migration >= 0001 when a runner ships.
-- dump/restore skip-lists this table (Task 2).

-- ---------------------------------------------------------------------
-- 6. EVENT LOG — T5 (Memo #4): HASH (aggregate_id) × 16 partitions
--    PK (aggregate_id, seq) and UNIQUE (aggregate_id, id) include the
--    partition key and propagate to every partition.
--    DEVIATION (accepted, Memo #4): no GLOBAL uniqueness on event.id;
--    per-aggregate dedupe preserved via UNIQUE (aggregate_id, id).
-- ---------------------------------------------------------------------
CREATE TABLE "event_sequence" (
  "aggregate_id" text PRIMARY KEY,
  "seq" bigint NOT NULL,
  "owner_id" text
);

CREATE TABLE "event" (
  "id" text NOT NULL,
  "aggregate_id" text NOT NULL REFERENCES "event_sequence"("aggregate_id") ON DELETE CASCADE,
  "seq" bigint NOT NULL,
  "type" text NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "event_pk" PRIMARY KEY ("aggregate_id", "seq"),
  CONSTRAINT "event_aggregate_id_id_idx" UNIQUE ("aggregate_id", "id")
) PARTITION BY HASH ("aggregate_id");

CREATE INDEX "event_aggregate_type_seq_idx" ON "event" ("aggregate_id", "type", "seq");

CREATE TABLE "event_p00" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE "event_p01" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE "event_p02" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE "event_p03" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE "event_p04" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE "event_p05" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE "event_p06" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE "event_p07" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE "event_p08" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE "event_p09" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE "event_p10" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE "event_p11" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE "event_p12" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE "event_p13" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE "event_p14" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE "event_p15" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 15);

-- Per-partition autovacuum tuning (reloptions do NOT inherit from parent).
-- Append-only log: aggressive early vacuum keeps bloat out of the
-- per-partition indexes between analysis cycles.
ALTER TABLE "event_p00" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p01" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p02" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p03" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p04" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p05" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p06" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p07" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p08" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p09" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p10" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p11" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p12" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p13" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p14" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
ALTER TABLE "event_p15" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);

-- ---------------------------------------------------------------------
-- 7. NOTES (NOT migration DDL — deploy-owned, baseline)
--   - wal_compression=on            → compose command:
--       postgres -c wal_compression=on -c shared_preload_libraries=pg_stat_statements
--   - synchronous_commit=off        → SET on flush-pool connections only (Memo #2)
--   - journal table "migration"     → runner-owned (PG port of migration.ts:30),
--       id text PRIMARY KEY, time_completed timestamptz NOT NULL
--   - No GIN anywhere: zero payload-field JSON queries observed in
--     packages/core/src + packages/server/src (grep this session).
-- ---------------------------------------------------------------------
```

## Observability surfaces (DUTY 7)

```sql
-- (a) PROJECTION-LAG GAUGE — per-session committed-vs-applied backlog.
--     Flush-on-read advances applied_seq, so a broken flush-on-read
--     surfaces here (Memo #2 Condition 5).
SELECT
  s.id                        AS session_id,
  es.seq                      AS committed_seq,
  COALESCE(spc.applied_seq, -1) AS applied_seq,
  es.seq - COALESCE(spc.applied_seq, -1) AS projection_lag
FROM "session" s
JOIN "event_sequence" es ON es.aggregate_id = s.id
LEFT JOIN session_projection_checkpoint spc ON spc.session_id = s.id
ORDER BY projection_lag DESC;

-- (b) db status --sessions PANEL — drain owner, projection backlog,
--     pending inputs (uses the partial pending index per session).
SELECT
  s.id                        AS session_id,
  es.owner_id                 AS drain_owner,
  es.seq - COALESCE(spc.applied_seq, -1)            AS projection_lag,
  COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL
                         AND si.delivery = 'queue') AS pending_queued,
  COUNT(si.id) FILTER (WHERE si.promoted_seq IS NULL
                         AND si.delivery = 'steer') AS pending_steer,
  MAX(si.admitted_seq) FILTER (WHERE si.promoted_seq IS NULL)
                                                    AS next_pending_admitted_seq
FROM "session" s
LEFT JOIN "event_sequence" es ON es.aggregate_id = s.id
LEFT JOIN session_projection_checkpoint spc ON spc.session_id = s.id
LEFT JOIN "session_input" si ON si.session_id = s.id
GROUP BY s.id, es.owner_id, es.seq, spc.applied_seq
ORDER BY projection_lag DESC NULLS LAST;

-- (c) BACKSTOP POLL seed (T1) — staggered per-session follow-ups;
--     one cheap partial-index-only scan:
SELECT session_id, id, delivery, admitted_seq
FROM "session_input"
WHERE promoted_seq IS NULL
ORDER BY session_id, admitted_seq
LIMIT 64;
```

**Hot-path invariant pass/fail (this artifact):**
- event `(aggregate_id, seq)` unique — **pass** (PK, parent-declared, propagates per-partition).
- Per-session ordering / replay contiguity — **pass** (`readAfter` predicate `aggregate_id=? AND seq>? ORDER BY seq` served by PK; `event_aggregate_type_seq_idx` propagates; id covered by `UNIQUE (aggregate_id, id)` — per-partition equivalent per invariant).
- session_input partial pending index — **pass** (rewritten per baseline: `(session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL`); promotion `promoted_seq IS NULL` predicate is application-side, already present at `packages/core/src/session/input.ts:136`; `UNIQUE (session_id, promoted_seq)` backstop — **pass**.
- session_message history pagination — **pass** (`(session_id, time_created DESC, id DESC)`).
- NOTIFY tiny payloads / reconnect catch-up — **pass by memo** (Memo #1; code review item).
- Migration advisory lock via `client.reserve` — **pass by memo** (Memo #5; code review item at runner PR).

---

# PART 3 — TYPE/CONSTRAINT PARITY MATRIX (complete, 19 tables + 2 new)

Legend — PG type | constraint. `ts` = SQLite source type. Deviations are **bold** and justified. All `time_*` epoch-ms integers → `timestamptz` with NO server-side default (app supplies via `$default`/`$onUpdate`, `packages/core/src/database/schema.sql.ts:4-9`) — one touch-per-consumer, no dual clock sources.

**project** (`packages/core/src/project/sql.ts:6-18`)
| column | SQLite | PG |
|---|---|---|
| id | text PK | text PRIMARY KEY |
| worktree | text NN (abs) | text NOT NULL |
| vcs / name / icon_url / icon_url_override / icon_color | text | text |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| time_initialized | int | timestamptz |
| sandboxes | text NN (JSON array) | **jsonb NOT NULL** (array of strings) |
| commands | text json | jsonb |

**project_directory** (`project/sql.ts:20-34`)
| project_id | text NN FK→project CASCADE | text NOT NULL REFERENCES … CASCADE |
| directory | text NN | text NOT NULL |
| type / strategy | text | text |
| time_created | int NN | timestamptz NOT NULL |
| — | PK(project_id, directory) | PRIMARY KEY ("project_id","directory") |

**workspace** (`control-plane/workspace.sql.ts:6-19`)
| id | text PK | text PRIMARY KEY |
| type | text NN | text NOT NULL |
| name | text NN DEFAULT '' | text NOT NULL DEFAULT '' |
| branch / directory | text | text |
| extra | text json | jsonb |
| project_id | text NN FK CASCADE | text NOT NULL REFERENCES … CASCADE |
| time_used | int NN | timestamptz NOT NULL |

**session** (`session/sql.ts:22-66`)
| id | text PK | text PRIMARY KEY |
| project_id | text NN FK→project CASCADE | text NOT NULL REFERENCES … CASCADE |
| workspace_id / parent_id | text (no FK in SQLite) | text (no FK — unchanged) |
| slug / directory(NN) / path / title / version | text (NN per source) | text (NOT NULL preserved) |
| share_url | text | text |
| summary_additions / summary_deletions / summary_files | int | integer |
| summary_diffs | text json | jsonb |
| metadata | text json | jsonb (no GIN — none observed) |
| cost | real NN DEFAULT 0 | double precision NOT NULL DEFAULT 0 |
| tokens_input/output/reasoning/cache_read/cache_write | int NN DEFAULT 0 | **bigint NOT NULL DEFAULT 0** (monotonic counters, cheap insurance) |
| revert / permission / model | text json | jsonb |
| agent | text | text |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| time_compacting / time_archived | int | timestamptz |
| indexes | project_idx, workspace_idx, parent_idx | same three |

**message** (`session/sql.ts:68-80`)
| id | text PK | text PRIMARY KEY |
| session_id | text NN FK→session CASCADE | text NOT NULL REFERENCES … CASCADE |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| data | text json NN | jsonb NOT NULL |
| index | (session_id, time_created, id) | **(session_id, time_created DESC, id DESC)** — equivalent service, direction-native |

**part** (`session/sql.ts:82-98`)
| id | text PK | text PRIMARY KEY |
| message_id | text NN FK→message CASCADE | text NOT NULL REFERENCES … CASCADE |
| session_id | text NN (**no FK** — denormalized in SQLite too) | text NOT NULL, no FK |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| data | text json NN | jsonb NOT NULL |
| storage | — | **WITH (fillfactor=80)** (T3 HOT room) |
| indexes | (message_id,id), (session_id) | same two |

**todo** (`session/sql.ts:100-117`)
| session_id | text NN FK CASCADE | text NOT NULL REFERENCES … CASCADE |
| content / status / priority | text NN | text NOT NULL |
| position | int NN | integer NOT NULL |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| — | PK(session_id, position); todo_session_idx | PK same; **todo_session_idx DROPPED** — redundant (PK prefix) |

**session_message** (`session/sql.ts:119-138`)
| id | text PK | text PRIMARY KEY |
| session_id | text NN FK CASCADE | text NOT NULL REFERENCES … CASCADE |
| type | text NN | text NOT NULL |
| seq | int NN | bigint NOT NULL |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| data | text json NN | jsonb NOT NULL |
| storage | — | **WITH (fillfactor=80)** |
| unique (session_id, seq) | ✓ | ✓ |
| index (session_id, type, seq) | ✓ | ✓ |
| index (session_id, time_created, id) | ✓ | **(session_id, time_created DESC, id DESC)** |
| index (time_created) | ✓ | ✓ (timestamptz) |

**session_input** (`session/sql.ts:140-166`; V2 migrations above)
| id | text PK | text PRIMARY KEY |
| session_id | text NN FK CASCADE | text NOT NULL REFERENCES … CASCADE |
| prompt | text json NN | jsonb NOT NULL |
| delivery | text NN ('steer'\|'queue') | text NOT NULL |
| admitted_seq | int NN | bigint NOT NULL |
| promoted_seq | int | bigint |
| time_created | int NN | timestamptz NOT NULL |
| pending idx | full (session_id, promoted_seq, delivery, admitted_seq) | **PARTIAL (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL** — baseline-mandated rewrite |
| unique (session_id, admitted_seq) | ✓ | ✓ |
| unique (session_id, promoted_seq) | ✓ | ✓ (multiple NULLs allowed, matches SQLite) |

**session_context_epoch** (`session/sql.ts:168-175`; final shape per `20260622142730`)
| session_id | text PK FK CASCADE | text PRIMARY KEY REFERENCES … CASCADE |
| baseline | text NN | text NOT NULL |
| snapshot | text json NN | jsonb NOT NULL |
| baseline_seq | int NN | bigint NOT NULL |

**session_share** (`share/sql.ts:5-11`)
| session_id | text PK FK CASCADE | text PRIMARY KEY REFERENCES … CASCADE |
| id / secret / url | text NN | text NOT NULL |
| time_created / time_updated | int NN | timestamptz NOT NULL |

**permission** (`permission/sql.ts:7-19`)
| id | text PK | text PRIMARY KEY |
| project_id | text NN FK CASCADE | text NOT NULL REFERENCES … CASCADE |
| action / resource | text NN | text NOT NULL |
| time_created / time_updated | int NN | timestamptz NOT NULL |
| unique (project_id, action, resource) | ✓ | ✓ |

**account** (`account/sql.ts:6-14`)
| id | text PK | text PRIMARY KEY |
| email / url / access_token / refresh_token | text NN | text NOT NULL |
| token_expiry | int | timestamptz |
| time_created / time_updated | int NN | timestamptz NOT NULL |

**account_state** (`account/sql.ts:16-22`)
| id | int PK | integer PRIMARY KEY (singleton) |
| active_account_id | text FK→account SET NULL | text REFERENCES … SET NULL |
| active_org_id | text | text |

**control_account (LEGACY)** (`account/sql.ts:25-41`)
| email / url | text NN, PK(email,url) | text NOT NULL, PRIMARY KEY(email,url) |
| access_token / refresh_token | text NN | text NOT NULL |
| token_expiry | int | timestamptz |
| active | int-bool NN DEFAULT false | **boolean NOT NULL DEFAULT false** |
| time_created / time_updated | int NN | timestamptz NOT NULL |

**credential** (`credential/sql.ts:5-16`)
| id | text PK | text PRIMARY KEY |
| integration_id / connector_id / method_id | text | text |
| label | text NN | text NOT NULL |
| value | text json NN | jsonb NOT NULL |
| active | int-bool | **boolean** |
| time_created / time_updated | int NN | timestamptz NOT NULL |

**data_migration** (`data-migration.sql.ts:3-6`) — **AMENDED by Memo #6: NOT materialized in PG**
| name | text PK | — (omitted from 0000_init; zero consumers; fresh PG has no legacy state) |
| time_completed | int NN | — (reintroduce via numbered migration when a runner ships; dump/restore skip-list) |

**event_sequence** (`event/sql.ts:4-8`)
| aggregate_id | text PK | text PRIMARY KEY |
| seq | int NN | bigint NOT NULL |
| owner_id | text | text |

**event** (`event/sql.ts:10-25`) — **partitioned (Memo #4)**
| id | text PK (global) | text NOT NULL; **no global PK — per-partition UNIQUE (aggregate_id, id)** |
| aggregate_id | text NN FK→event_sequence CASCADE | text NOT NULL REFERENCES … CASCADE |
| seq | int NN | bigint NOT NULL |
| type | text NN | text NOT NULL |
| data | text json NN | jsonb NOT NULL |
| unique (aggregate_id, seq) | idx | **PRIMARY KEY (aggregate_id, seq)** (parent-declared, propagates) |
| index (aggregate_id, type, seq) | idx | same (parent-declared, propagates) |
| storage | — | HASH ×16 partitions; per-partition autovacuum 0.01/0.005 |

**NEW session_projection_checkpoint** (Memo #2)
| session_id | — | text PRIMARY KEY REFERENCES session ON DELETE CASCADE |
| applied_seq | — | bigint NOT NULL |
| time_updated | — | timestamptz NOT NULL |

**migration journal (runner-owned, not in bootstrap)** — id text PK; time_completed int NN → timestamptz NOT NULL (PG runner port of `migration.ts:30`).

**PARITY RULES — cross-dialect behavioral invariants (ATHENA-VERIFIED 2026-08-20, Memo #17; doc copy embedded at `packages/core/test/dialect-matrix.test.ts:18-26`; discharges Memo #15 Cond 7 + Memo #16 Cond 3):**

1. **B1 — checkpoint FK asymmetry.** `session_projection_checkpoint.session_id` carries `REFERENCES session(id) ON DELETE CASCADE` in PG (`0000_init.sql:206` — the FK line, verified) and NO FK in SQLite. Accepted (Memo #15 B1): SQLite event-path tests use `ses_`-shaped aggregates without session rows; PG-side deletes cascade-clean; SQLite orphans are benign derived bookkeeping. VERIFIED live BOTH dialects by me this session (SQLite: orphan checkpoint insert persists; PG: FK-rejects the same insert, exit-observed + rollback-confirmed no row persisted).
2. **B3 — `ses_` guard invariant.** All durable aggregates are sessions; the in-tx checkpoint write (SQLite branch), `scheduleFlush`, `flush`, and `lagGauge` are `startsWith("ses_")`-guarded (flush.ts:95 lagGauge, :197 flush; event.ts in-tx write + scheduleFlush sites). Any future non-session durable aggregate must NOT expect checkpointing, and the guard must not be silently widened. VERIFIED live both dialects (matrix Surface 5: non-`ses_` aggregate → no checkpoint row either dialect).
3. **Memo #16 — `*.delta` live-only rule.** `Text.Delta` and `Reasoning.Delta` are live-only BY DESIGN: never durable, never projected, never flushed; `Text.Ended`/`Reasoning.Ended` are the replayable full-value boundaries; the async tier is Tool.Progress ONLY. VERIFIED at source this session: ruling comments on both Delta definitions (schema/session-event.ts), registrations absent (projector.ts:459-465 = Tool.Progress only), grep-guard bans re-introduction (7/7 my run).

---

# PART 4 — VERIFICATION PROCEDURE (DUTY 6c) + FAILURE-MODE TABLE SEED

**Procedure (compose `db` service, bash available):**
1. `docker compose up db` → from repo: `docker compose exec db psql -U opencode -d opencode -f /dev/stdin < 0000_init.sql` (or run `opencode db migrate` against it once runner lands).
2. Catalog diff — for each of the 19+2 tables: `\d "<table>"` captured to files; diff column names/order/types against Part 3 (order-insensitive; types per matrix). Assert: 0 unexpected columns, 0 missing constraints.
3. Index inventory: `\di` — assert the exact index set of Part 2 (incl. `todo_session_idx` ABSENT, partial predicate text on `session_input_session_pending_delivery_seq_idx` via `\d session_input`).
4. Partition checks: `SELECT count(*) FROM pg_inherits WHERE inhparent='event'::regclass;` = 16; `\d event_p07` shows propagated PK/unique/indexes; Memo #4 UNVERIFIED item: `EXPLAIN SELECT … FROM event WHERE aggregate_id='ses_x' AND seq > 0 ORDER BY seq;` — assert "partitions considered: 1".
5. Constraint spot-fires: duplicate `(aggregate_id, seq)` insert → must fail; `session_input` second NULL-promoted row per session → must SUCCEED (multi-NULL unique); delete `session` row → children cascade (message/part/session_message/session_input/session_context_epoch/session_share/todo/checkpoint).
6. Round-trip: promote a scratch SQLite DB through the dump/restore path, then run (a) gauge and (b) panel queries — must return without error and lag consistent.
7. Produce the checklist file even where tooling blocks a step — checklist rows carry pass/fail/UNABLE.

**Memo #6 addendum (B4/B5/dead-tables verification steps):**
8. Epoch double-initialize race: open two psql sessions; run the initialize `INSERT … ON CONFLICT (session_id) DO NOTHING` + read-back for the same session concurrently → exactly one row; both callers return the winner's `baseline_seq`.
9. Epoch monotonic guard: write baseline_seq=40, then run the guarded replace with baseline_seq=25 → 0 rows affected; read-back returns 40.
10. Aggregate serialization spot-fire (validates T2 port): two concurrent `commitDurableEvent` transactions for the SAME session (psql session A holds the tx open after the event_sequence select; B attempts the same) → B blocks on FOR UPDATE; after both commit, `session.cost` equals the sum of part usages (no negative drift).
11. Usage-batching equivalence: after N interleaved PartUpdated events, `SELECT cost, tokens_* FROM session` equals the sum over `part` rows' usage — cross-check query.
12. Dead-table check: `SELECT to_regclass('data_migration')` IS NULL; `SELECT to_regclass('credential')` IS NOT NULL.

**Failure-mode table (seeded this session; I own updates from here):**

| ID | failure | guard | memo |
|---|---|---|---|
| FM-01 | LISTEN conn drop mid-stream loses wakeups | LISTEN→catch-up→resume; always-on backstop poll | #1 |
| FM-02 | NOTIFY storm floods listener queues | tiny payloads; per-session channels (no P× fan-out) | #1 |
| FM-03 | channel-name truncation collision (>63B IDs) | shared truncation helper + test | #1 |
| FM-04 | flush-pool crash mid-batch | batch+checkpoint same async tx; replay from checkpoint | #2 |
| FM-05 | fence breach (inbox/epoch via async pool) | flush-pool write surface restriction; REJECT on review | #2 |
| FM-06 | checkpoint skew vs projection rows | same-tx rule (Condition 3) | #2 |
| FM-07 | repartition demand post-data | count fixed at 16; documented one-way door | #4 |
| FM-08 | cross-aggregate event.id collision undetected | ULID entropy; per-aggregate UNIQUE retained | #4 |
| FM-09 | concurrent boots race migration | pg_advisory_lock(727274) via client.reserve | #5 |
| FM-10 | probe false-negative on non-empty DB | probe checks 'session' table; die on non-empty foreign schema | #5 |
| FM-11 | model-resolution throw pre-persistence → orphan empty subagent session | pre-validate resolution before durable writes; halt persists error (B2); tool error surfaced (B3) | #6 |
| FM-12 | halt error memory-only → replay drops error state | persist via durable MessageUpdated (idempotent upsert); replay converges | #6 |
| FM-13 | epoch insert TOCTOU under multi-process resume | INSERT … ON CONFLICT DO NOTHING + read-back winner | #6 |
| FM-14 | epoch replace stale/lost update | monotonic guard `baseline_seq <= new` + RETURNING; conservative-lower recording | #6 |
| FM-15 | usage double-decrement via out-of-tx projector execution | aggregate serialization (T2 FOR UPDATE) + fence extension: usage-bearing projections sync-tier only | #6 |
| FM-16 | restore of SQLite dump carries data_migration rows into PG | dump/restore skip-list (table intentionally absent) | #6 |
| FM-17 | deferred-constraint COMMIT failure handled via SQLite-template explicit ROLLBACK | PG auto-terminates the tx; follow-up ROLLBACK is warning-only no-op (verified live, PG 17.11); automated test owed — Memo #8 Condition 1 — **RESOLVED Memo #19 (Step 9 D1)**: automated tests landed and verified (packages/core/test/database-pg.test.ts:371-539 — DEFERRABLE INITIALLY DEFERRED duplicate insert SUCCEEDS in-tx, COMMIT fails 23505 with the constraint name, connection remains usable, nothing persisted; NON-deferred control proves the in-tx success is the divergent behavior; 14/14 exit 0 under live PG) | #8/#19 |
| FM-18 | effect-drizzle-pg suite silently no-ops when `TEST_DATABASE_URL` unset | Step 7 CI matrix must export `TEST_DATABASE_URL`; a 0-test run counts as failure — **scope extended by Memo #9 to the packages/core PG suite (`test/database-pg.test.ts`)** — **Memo #17: CI LANDED (`.github/workflows/pg-test.yml`): TEST_DATABASE_URL exported, zero-test=fail AND failing-test=fail (exit code preserved via set +e/$?/set -e), bounded 30s health gate with explicit failure; negative control proven by my own run (dead-port URL → 5/5 PG tests fail with connect errors; no silent no-op path)** | #8/#9 |
| FM-19 | postgres-js reserved connections leak: `acquirer` never releases; `transactionAcquirer` wires release to a detached `Scope.make()` nobody closes → pool exhaustion deadlock after `max` statements (RUNTIME-PROVEN, Memo #9 §3: stmt 9/12 stalled >30s at max=8) | release must ride the provided/ambient scope (`sqlite.bun.ts:123-130` pattern) or acquirer returns the pooled base connection (postgres-js pools internally); regression test = >poolMax statements + transactions on ONE layer — **RESOLVED Memo #10: Option A landed (`pg.bun.ts:188,201-214`), ambient-scope contract verified against effect-smol source, 10/10 suite incl. pool-lifecycle regressions on live PG 17** | #9/#10 |
| FM-20 | session-level GUCs (`statement_timeout`, `idle_in_transaction_session_timeout`) SET once on one pooled checkout → timeouts illusory on all other connections | apply per-connection at construction of each reserved/pooled connection (or startup parameters); never one-shot `client.unsafe("SET …")` on the shared client — **PARTIAL Memo #10: one-shot removed, reserved connections carry SETs (`pg.bun.ts:155-173`); pooled half open → Memo #10 Condition 4 (URL `?options=` passthrough VERIFIED live: `SHOW statement_timeout` = 1234ms)** — **RESOLVED Memo #14: startup-packet params landed via postgres-js `connection:{}` (`pg.bun.ts:259-266`); BOTH GUCs proven on pooled connections (SHOW = 12345ms / 23456ms); reserved SETs remain belt-and-braces (`pg.bun.ts:155-173`)** | #9/#10 |
| FM-21 | `Database.Schema` namespace seam: PG branch currently provides the SQLITE namespace (`database.ts` sqliteSchemaLayer on both branches) — first consumer under PG would receive SQLite table objects against a PG client | no consumer adopts `Database.Schema` until the PG namespace exists and the PG branch provides it; Step 7 grep-guard — **SEAM DEFUSED Memo #10: PG branch provides PG namespace (`database.ts:88,93`); zero consumers confirmed; grep-guard still owed (Step 7)** — **SCOPE CORRECTED + RUNTIME ANNOTATION Memo #19**: "zero consumers" was TRUE ONLY of packages/core — my Step 4 review (Memo #11, PART 9 Surface 2) covered the 13 core consumers + namespace infra, ALL packages/core. The APP layer (message-v2.ts, session.ts, project.ts + 16 direct SQLite table-object imports across packages/opencode/src) was NEVER in my reviews; session/sql.ts defines sqliteTable objects UNCONDITIONALLY → app-layer imports are SQLite-bound at module scope and emit invalid queries under PG (Oracle end-gate RUNTIME proof; corroborated `EffectDrizzleQueryError: select ... from "message"`, step9-evidence D2 gap). FM-21 is RUNTIME, not type-level: packages/opencode typecheck exit 0 does NOT make the app run under PG — it does not, beyond packages/core. Became known to me at Oracle's end-gate (2026-08-20). RULING: accepted for STAGING; **BLOCKING-FOR-BETA (Oracle Condition C)** — rewire packages/opencode table imports to `Database.Schema` + add the packages/opencode PG CI leg; carries D2's PG anchor-bug leg (same tests, shipping dialect) — **CLOSED Memo #20 (END-TO-END)**: app layer rewired to the Database.Schema service seam (storage/db-schema.ts provider; 17 rewired sites across 16 files — my reconciliation grep counts 17 files referencing DatabaseSchema; commit 4cc9120443); storage/schema.ts DELETED — the unconditional-sqliteTable second source of app-layer table-truth is GONE; both anchors EXECUTED under live PG (23/23 + 17/17 across the CI leg's two suites) and independently reproduced by me during the council review — the D2 PG gap (step9-evidence :209) is closed by the exact Memo #19 Ruling 3 mechanism (same tests, shipping dialect, zero new test-authoring owed); the mechanical walker I conditioned on LANDED (e1a1f4e241: grep-guard.test.ts :224-258 bans static runtime `@opencode-ai/core/**/sql` + `**/sql.pg` imports across packages/opencode/src/**, `import type` allowed — Memo #17 Cond 3 convention; 9/9 green incl. my run) — instance (4) of the class cannot return silently; the packages/opencode PG CI leg landed (pg-test.yml :108+: DATABASE_URL=TEST_DATABASE_URL, zero-test/failing-test discipline, --timeout=30000 per FM-38). Oracle Condition C DISCHARGED | #9/#10/#19/#20 |
| FM-22 | migration script failure releases the reserved connection with an aborted open tx → poisoned pooled connection; every later statement on it fails 25P02 "current transaction is aborted" (RUNTIME-PROVEN Memo #10 §9.4: follow-up SELECT on same max=1 layer failed 25P02 after failed 0001; static root cause: `Effect.try({try: () => conn.executeRaw("ROLLBACK")})` succeeds with the UNEXECUTED effect — effect-smol `try_` = `succeed(evaluate())`, internal/effect.ts:976-992) | actually execute the ROLLBACK: `yield* Effect.ignore(conn.executeRaw("ROLLBACK", []))` (FM-17 warning-only semantics); Memo #10 Condition 1 — **RESOLVED Memo #11**: fix at migration.pg.ts:129; regression test packages/core/test/database-pg.test.ts:218-283 (max=1 layer, failed apply asserted, same-layer follow-up SELECT, journal-clean asserts) | #10, #11 |
| FM-23 | packaged runtime missing `.opencode/db-migrations/` (migrationsDir resolves via `import.meta.url` tree, `migration.pg.ts:44-47`) → boot dies on ENOENT with unclear cause | Step 8 Dockerfile COPY of the directory + dir-exists precheck with actionable error; Memo #10 Condition 5; embedding REJECTED (second-copy drift vs Memo #7 Condition 1 byte-identity) — **Memo #18: PARTIAL. COPY half LANDED AND PROVEN** (Dockerfile :92 build-stage staging COPY + :128 runtime COPY to `/.opencode/db-migrations/`; compiled-binary proof: journal row `0000_init | 2026-08-20 01:03:33` applied under pg_advisory_lock(727274); 8/8 containers stable). **Precheck half RESOLVED Memo #19** (Memo #18 Cond 1 discharged: migration.pg.ts precheck guards BOTH read paths — readFile AND loadNumberedMigrations (:78/:214); actionable error per spec; DOUBLE-VERIFIED against stash blobs pre-restore AND on disk post-restore, zero drift). **ANNOTATION (bunfs divergence, empirically proven Wave 3):** a Bun-compiled binary resolves migrationsDir() from import.meta.url to the REAL-filesystem root `/.opencode/db-migrations/`, NOT a bunfs virtual path — Wave 1's embedding theory was wrong; the dead-theory comments are now CORRECTED as landed (Dockerfile :7-15/:89-91 and pg-deploy.mdx :116-119 + the :15 PART-citation fix document the proven staging-COPY→runtime-COPY mechanism — Memo #18 Conds 2-3 discharged, verified on disk). sha256 freeze holds on the restored tree: 818ee1a9…422fb3 identical across live file, .bak, and the grep-guard constant. **FM-23 CLOSED END-TO-END (Memo #10 Cond 5 chain complete)** | #10/#18/#19 |
| FM-24 | epoch-millis NUMBER written to PG `timestamp({mode:"date"})` column: RC2 `PgTimestamp.mapToDriverValue = (v) => typeof v === "string" ? v : v.toISOString()` (pg-core/columns/timestamp.cjs) throws on numbers — EVERY rewired consumer write throws at query build (projector.ts:72-75, :174, :257, :288, :311/:406/:415/:473/:482/:520, :324-330, :384; input.ts:120, :177). RUNTIME-PROVEN (H-1 smoke, 4 tests, Memo #11 U-1 CONFIRMED BROKEN; loud failure — nothing persists) | **T-A (Memo #12)**: epoch-millis custom column in schema.sql.pg.ts — numbers both directions, `toDriver` accepts number/Date/string; zero consumer churn; storage stays timestamptz (signed DDL unchanged) | #11/#12 |
| FM-25 | vendored bridge mapper shims predate RC2's codec layer: local `orderSelectedFields` (drizzle-utils.ts:38-50) emits `{path,field}` only — drops `codec`/`arrayDimensions` — and local `mapResultRow` (:64-115) calls `mapFromDriverValue(rawValue)` without the codec step. RC2 keeps bigint decode OUT of the column (`PgBigInt53` has no `mapFromDriverValue`; base is `noop`, column.cjs) and IN the registry (`genericPgCodecs["bigint:number"].normalize = Number`, pg-core/codecs.cjs; applied by RC2 utils.cjs `mapResultRow`/`makeJitQueryMapper`). Result: bigint columns read back as STRINGS through select AND `.returning()` on both jit and non-jit paths (jit ON by default, driver.ts:61) — `session_message.seq`, `session_input.admitted_seq` runtime-proven; `SessionInput.find` decode fails on the string shape | **B-A (Memo #12)**: restore RC2 parity in `internal/drizzle-utils.ts` (attach `codec: codecs?.get(field,"normalize")` + `arrayDimensions`; decode `codec(rawValue, arrayDimensions)` before `mapFromDriverValue`) and thread a drizzle-exported codecs registry through select.ts:259 / insert.ts:256 / update.ts:316 / delete.ts:175; regression on both jit paths — **LANDED+VERIFIED Memo #13** (my run 15/15 bridge, 6/6 bigint-codec incl. jit on/off; residual: delete `.returning()` case uncovered, fold into FM-26 regression) | #12/#13 |
| FM-26 | vendored insert builders ported the SQLite wrapper's onConflict method shape — prefix-in-method (` on conflict …` fragments pushed into an onConflict ARRAY; effect-drizzle-sqlite insert.ts:261-270) — into the PG dialect contract, where RC2's `PgInsertConfig.onConflict` is a scalar SQL (insert.d.ts:23) and `PgDialect.buildInsertQuery` ITSELF prepends ` on conflict ${onConflict}` (pg-core/dialect.cjs:283; dialect instance = RC2's own, driver.ts:56) → every PG `.onConflictDoNothing()`/`.onConflictDoUpdate()` emitted `on conflict on conflict …` = INVALID SQL. SQLite unaffected (array-join dialect adds no prefix, sqlite dialect.cjs:247; config type `SQL[]`, insert.d.ts:24) — which is why SQLite suites never caught it. Blast radius (grep, 9 sites/7 core files): event.ts:334 (durable event dedup upsert — the EVENT LOG path), projector.ts:280,331,385, input.ts:122, context-epoch.ts:157, session.ts:226, directories.ts:74-81, permission/saved.ts:69 — every PG upsert dead on arrival. Found while proving Memo #12 Cond 3(a); landed out-of-scope before ruling | **RC2 alignment (Memo #13, retroactively APPROVED)**: builder methods store the CLAUSE BODY only (insert.ts:260-267 DoNothing, :269-286 DoUpdate — matches RC2 insert.cjs:99-105/:138-146); dialect owns the prefix. Proven by direct toSQL() execution: `insert … on conflict do nothing` / `on conflict ("t"."id") do nothing` / `on conflict ("t"."id") do update set …` — single prefix, parenthesized targets (sql.cjs:105-113 array interpolation). Accepted divergence: qualified target `("t"."id")` vs RC2's unqualified `("id")` — both valid PG conflict targets. Guard owed: Memo #13 Condition 2 (toSQL single-prefix asserts + live upsert; pg.test.ts has ZERO onConflict coverage today) — **GUARDED Memo #14: on-conflict.test.ts 8/8 (toSQL ×3, live round-trips ×2, delete `.returning()` bigint jit on/off ×2); my run 22/22 bridge suite; target rendering now RC2-identical UNQUALIFIED `("col")` (PORT-NOTES #12) — Ruling 3's accepted cosmetic divergence eliminated by implementer, improvement accepted** | #13 |
| FM-27 | wake bus RECEIVE side unwired (Step 5b-1): `Wake.ListenerLayer`/`backstopPoll`/`pendingSessions` have ZERO consumers (grep: only `Wake.notifyInTransaction` at event.ts:378). Emission-only — under PG, a remotely-admitted `session_input` wakes NOBODY: no LISTEN consumer, no staggered backstop running, cross-process wake latency UNBOUNDED. Same-process wakes still work via local EventV2 pubsub (event.ts:384-390). Compounding defect in the dead primitive: `ensureListening` (wake.ts:112-132) DISCARDS `native.listen()`'s unlisten handle — `unsubscribe` (wake.ts:147-158) deletes the Map entry but never UNLISTENs server-side → LISTEN set grows monotonically per process; re-subscribe duplicates callbacks against shutdown PubSubs | wire the receive side in a NAMED step before Step 8 (SessionExecution/session-watch subscribe-unsubscribe, always-on staggered backstop, reconnect catch-up consumer); keep + use the unlisten handle (Memo #1 bounded-cardinality + Cond 4 pinned-connection rules) — Memo #14 Condition 5 — **RESOLVED Memo #15**: receive side wired (`wake.ts` receiverNode + `withDrain`; `session/execution/local.ts:33-44` drain wrap, process-global/session-ID based, no layer takes a Session ID); unlisten handle retained+called (wake.ts:163-169, 197-204); backstop per-drain 1500ms+jitter (wake.ts:225-228, 323); reconnect via postgres-js onlisten → wake → inbox rescan, PROVEN by pg_terminate_backend test (wake-receive-pg.test.ts:326-397; resolves Memo #14 UNVERIFIED 2); 7/7 twice. Residuals (advisory, Memo #15 Conds 3-5): subscribe/unlisten race leaks a LISTEN slot when the handle resolves after entry deletion; import-failure `subscribe` dies instead of degrading to backstop-only; dead `pendingSessions` + `schema: any` remain | #14/#15 |
| FM-28 | PG test dialect-key conflation + vacuous setup (wake-pg.test.ts, RUNTIME-PROVEN Memo #14): (a) `isPg` keys on `process.env.DATABASE_URL` (database.ts:41,49) but tests gate/branch on `TEST_DATABASE_URL` → in the test process `isPg === false`: `notifyInTransaction` no-ops (both NOTIFY tests fail on null payload) and EVERY isPg conditional (event.ts:268-270, input.ts:289-291,318-320) runs its SQLite branch against a PG database — production PG paths unexercised; (b) `setupSession`/`insertPendingInput` are `async` fns that `await` Drizzle Effects — Effects are NOT thenable (proven: `await effect` returns the Effect object) → inserts never execute, positive data asserts run against EMPTY tables (vacuous passes; 5 pass / 6 fail in my run) | rewrite per Memo #14 Condition 1: compose Effects, never async-await them; run PG tests with `DATABASE_URL=TEST_DATABASE_URL` (or inject the dialect flag); assert non-vacuity (row counts > 0 before asserting); FM-18 discipline extended: a vacuously-passing PG suite counts as failure. **INSTANCE LEDGER (Memo #17, 3 static-freeze instances → escalated to mechanical guard):** (1) wake-pg original (Memo #14, runtime-proven); (2) dialect-matrix original — static core imports froze isPg=false before the PG leg set DATABASE_URL, all 5 PG tests failed at the sanity assert, never touching the DB (verifier's discriminating run; fixed via import-type + dynamic-import bindings, verified by me at source + live 10/10); (3) `session-pg-roundtrip.test.ts` — LATENT, FOUND BY ATHENA (Memo #17): static `import { SessionInput } from "@opencode-ai/core/session/input"` → input.ts:8 runtime `../database/lock` → lock.ts:3 runtime `isPg` VALUE import from `./database` → database.ts evaluates at static-hoist time with DATABASE_URL unset → **isPg frozen FALSE for the whole suite while connected to PG**; passes because the file has NO isPg sanity assert and its exercised paths degrade silently (Lock identity fallback instead of FOR UPDATE/SKIP LOCKED on the admit path). ESCALATION: per-file discipline insufficient at three instances — mechanical denylist guard ordered (Memo #17 Cond 3) — **INSTANCE LEDGER CLOSED Memo #20 (fourth instance, NEW subclass: env-truth)**: the council found pg-test.yml's SQLite leg exporting `DATABASE_URL: ""` — empty string ≠ undefined → `isPg` (keyed `!== undefined`) read TRUE while layer dispatch (truthiness) ran SQLite: the two checks DISAGREED on the "SQLite" leg (CI-only; production never exports empty-string — but this is exactly the single-source-dialect-truth erosion FM-28 names). TWO-LAYER fix (e1a1f4e241): (1) the empty-string env keys DELETED from the workflow (absent-key semantics verified — no job-level env exists, unset is unset); (2) database.ts:42 normalizes `process.env.DATABASE_URL || undefined` AT THE SINGLE SOURCE, with the comment that isPg and layer dispatch can never disagree — the fix is TOTAL, not CI-scoped (any future empty-string exporter gets SQLite-by-absence consistently everywhere). Class closed with mechanical prevention: import-freeze subclass → Memo #17 Cond 3 walker; env-truth subclass → single-source normalization + absent-key CI | #14/#17/#20 |
| FM-29 | SKIP LOCKED decorative (Step 5b-1 as landed): `promoteSteers`/`promoteNextQueued` pending-SELECTs (input.ts:282-292,316-321) run through the BASE client at llm.ts:193-196 with NO wrapping `db.transaction` — each SELECT is an autocommit statement on a pooled connection (`pg.bun.ts:188` acquirer); row locks release at statement end, BEFORE `publish()` → commitDurableEvent's separate tx. Decision #5's arbitration is NOT in force. No demonstrated race TODAY: double-promotion is stopped by the `promoted_seq IS NULL` predicate (input.ts:150), the unique (session_id, promoted_seq) backstop, T2 serialization, and V2 process-local drains (SessionRunCoordinator joins same-session resumes) | claim-then-promote in ONE tx (bridge nested savepoints, Step 1-verified): SELECT FOR UPDATE SKIP LOCKED + per-event promotion via nested savepoints (LifecycleConflict → savepoint rollback, batch continues), batch commits atomically; lock order session_input rows BEFORE event_sequence (non-drain publishers take only event_sequence → no cycle). Alternative = Oracle re-scope of decision #5 (advisory-only under process-local drains) — Athena does not relax locked decisions — Memo #14 Condition 3 — **RESOLVED Memo #15 per Oracle's FINAL ruling (Option A adopted; decision #5 preserved verbatim)**: both promotion fns wrap claim-then-promote in ONE `db.transaction` (input.ts:306-332, 347-368) with `Lock.forUpdateSkipLocked` INSIDE the tx (:327, :363); per-event promotion via nested savepoints both bridges (`effect_pg_${id}` effect-pg/session.ts:145,168,171; `effect_sql_${id}` effect-sqlite/session.ts:145,165,168); LifecycleConflict → savepoint rollback → batch continues (publish, input.ts:244-279, Effect.exit + Cause.findDefect, actual promoted count); lock order session_input→event_sequence documented inline (input.ts:289-305). **ORACLE ANNOTATION (load-bearing):** locked decision #9 deploys N containers with ZERO session affinity (`SessionExecution.local.ts:10-11` reserves the placement seam) — cross-process same-session drains are the DEFAULT state, so the pre-fix unique backstop converted that race into a CRASHED drain, not graceful degradation; post-fix the loser's SKIP LOCKED claims 0 rows and exits cleanly (proven, wake-pg concurrent test asserts BOTH Exit.isSuccess). Regression: deterministic mid-batch conflict via pre-inserted session_message → sp2 skipped, sp1+sp3 promoted | #14/#15 |
| FM-30 | flush-tier projector key mismatch (Step 5b-2, STATICALLY PROVEN Memo #15): `runProjectors` looks up `projectors.get(row.type)` (event.ts:720) with the VERSIONED DB string (e.g. `session.next.prompt.admitted.1`; versionedType at schema/event.ts:94-96, stored at event.ts:382), but `events.project()` registers under the UNVERSIONED `definition.type` (event.ts:689-694). Every lookup misses → `?? []` → ZERO projectors run. Consequences: (a) async tier VACUOUS under PG — Text.Delta/Tool.Progress projections NEVER execute (skipped in sync tx at event.ts:359, never run by flush); (b) checkpoint advances anyway (flush.ts:152) = checkpoint-AHEAD-of-projection — the exact class Memo #2's same-tx rule forbids; (c) lag gauge masked (reads 0 after "flush"); (d) flush-pg 7/7 green BECAUSE of the defect — tests assert checkpoint arithmetic only, never projected rows (FM-18/FM-28 vacuity class, flush-tier instance) | fix = lookup by `definition.type` (resolved from `Durable.get(row.type)`) AND skip non-async-tier rows (`Flush.isAsyncTier(definition.type)`) — see FM-31 for why the filter is load-bearing; regression asserting PROJECTION OUTCOMES (session_message/part rows materialized from Text.Delta/Tool.Progress through the flush), not checkpoint arithmetic — Memo #15 Condition 1/2 | #15 |
| FM-31 | flush re-projection storm (LATENT — activates the moment FM-30's key is fixed without a filter): `flush` reads ALL events > checkpoint (flush.ts:138-144, no type filter) and `runProjectors` would re-run SYNC-tier projectors over events already projected in their commit txs. `Event.Created` re-run → `Effect.die(new SessionAlreadyProjected())` (projector.ts:285, onConflictDoNothing returning nothing); `PromptAdmitted` re-run → LifecycleConflict dies (input.ts:112, :127). Flush fiber dies permanently → checkpoint frozen → EVERY `SessionHistory.load` dies via flush-on-read defect propagation (history.ts:91-95 `yield* Flush.flush` — the defect crosses into the READ path) → PG history unreadable for any real session | async-tier-only filter in runProjectors (sync-tier events were projected in-tx; the checkpoint marks flush-tier progress over ALL events, projecting only ASYNC_TIER_TYPES); flush-on-read should degrade (log + read stale-with-lag-visible) rather than die on flush defects | #15 |
| FM-32 | `Flush.scheduleFlush` = `Effect.runFork(flush(...))` (flush.ts:159-166) with NO supervision, no defect logging, no retry. A dead flush fiber is invisible except via the lag gauge — which FM-30 currently pins to 0 (masked). Post-fix this becomes the ONLY silent-failure surface of the async tier | supervise the fork (log defect with sessionID; lag gauge is the observable); consider fenced retry (bounded) | #15 |
| FM-33 | concurrent same-session flushes unserialized: `flushSemaphore` (flush.ts:33-34) is GLOBAL (4 permits across all sessions), not per-session; the flush has no per-session claim, so two concurrent flushes of one session both read the same checkpoint and interleave read-modify-write projectors (SessionMessageUpdater getCurrentAssistant → append → overwrite). Full-row overwrite makes the common case last-write-wins-identical, but a read landing between A's write and B's write duplicates appended delta text. Crash-window variant (no same-tx wrapper today, Memo #2 Cond 3 violation): partial projections durable + checkpoint unadvanced → replay re-applies appended deltas | per-session claim: read the checkpoint row `FOR UPDATE` at flush start (Lock.forUpdate; no cycle — flush takes no session_input/event_sequence locks) + batch+checkpoint in ONE db.transaction (Memo #2 Cond 3 restores crash atomicity: both lost together → replay applies once) | #15 |
| FM-34 | dead Text.Delta registrations + false async-tier membership comments (Memo #16, STATICALLY PROVEN): `events.project(Text.Delta, ...)` + `Flush.registerAsyncTierType(Text.Delta.type)` were inert under BOTH dialects (live-only definition → notify-only routing → never enters the log); three comment sites claimed a deferral that cannot occur — belief-reality divergence at the FM-30 failure class. [Row appended Memo #17 — Memo #16's "FM-34 appended" claim was not executed in this table at the time; record repaired] | removal per Memo #16 ruling (a) + comment corrections + grep-guard ban on re-introduction — **RESOLVED Memo #17 (verified at source by me): registrations absent (projector.ts:459-465 = Tool.Progress only, ruling comment), comments corrected (flush.ts:19-20/:40; schema/session-event.ts BOTH Delta definitions), guard test green 7/7 (my run)** | #16/#17 |
| FM-35 | test-code double-cast fabricates dialect parity that never executes (incident-discovered, latent): the matrix's original PG leg miscast SQLite table objects `as unknown as typeof PgTable` — a type-system lie invisible while the leg was dead (gated off by the FM-28 static-import freeze); it would have produced nonsense cross-dialect queries the moment the leg first executed | REAL dialect imports in PG legs (`*.sql.pg` tables — never cross-dialect table casts); a double-cast in a test is acceptable ONLY when the leg is provably executed (isPg sanity assert + row-count non-vacuity + negative control). **RESOLVED same incident + verified by me: matrix now imports event/session/project `sql.pg` tables (dialect-matrix.test.ts:122-127, :210-215); my negative control (dead port) → 5/5 PG tests fail, no silent no-op; residual `db as unknown as DbShape` casts (:667/:669/:674/:789) are test-scope, executed-for-real, accepted** | #17 |
| FM-36 | asserted-but-never-executed artifact verification (Step 8 Wave 1, incident-proven): the image build was declared complete/"300s timeout" while it actually failed DETERMINISTICALLY at step 2/23 in ~30s — the image was never buildable at first landing (COPY of nonexistent manifests; invalid `2>/dev/null \|\| true` syntax); the bunfs-embedding claim was likewise asserted, not observed. Belief-reality divergence class (FM-30/FM-35 family) on the BUILD/DEPLOY surface — caught only when Wave 2 actually executed the build | an artifact claim (build success, boot, migration apply) counts as evidence ONLY with an executed exit-0 run in the reporting session; a declared "timeout" on a ~30s deterministic failure = misdiagnosis red flag; compiled-artifact behavior (path resolution, libc linkage) is verified by RUNNING the compiled artifact, never by source-tree reasoning — **NAMED Memo #18 (Wave 2/3 incident chain; guard standard applied to all future Step 9 evidence)** — **CLASS EXTENDED Memo #19 (stale-environment evidence)**: typechecks re-executed on the restored tree exited 0 only after a node_modules frozen-install repair (the stale install resolved 9 DISTINCT drizzle-orm build hashes; the source tree was always correct) — evidence is valid only from an install provably resolving the current tree; verify the ENVIRONMENT, not just the command | #18/#19 |
| FM-37 | uncommitted-artifact loss, SECOND INSTANCE (2026-08-20, documented Memo #19 §19.1): the ENTIRE Step 1-9 corpus (108 files — these memos, the evidence ledger, migrations/bootstrap, the Dockerfile, the vendored effect-drizzle-pg, all PG sources) existed ONLY in stash@{0} ("pre-existing athena work — stashed before feat/fallback-models", created 13:27 for an unrelated effort that never materialized; working tree found CLEAN on dev) — one `git stash drop` from annihilation. WORSE than instance (1) the same day: `.opencode/db-migrations/` missing from the tree (untracked, never committed), recovered from `.bak` with sha256 verification (step9-evidence note 4; the instance Oracle's end-gate cited) — instance 1 had a backup; instance 2's "backup" WAS the hazard itself. Recovered via `git stash apply`; stash RETAINED as safety copy; 81 modified files on disk; Memo #18 Condition closures double-verified (stash blobs pre-restore + disk post-restore, zero drift) | commit the corpus NOW — Oracle Condition D (0000_init.sql + migrations + all Step 8/9 artifacts) ELEVATED by Memo #19 from blocking-for-PR-merge to IMMEDIATE, before any further work; standing discipline: never stash/branch-switch while uncommitted DB-domain work exists; commit at every green gate; retain the stash until the commit series merges, then clear manually — **NAMED Memo #19** — **THIRD EXPOSURE Memo #20 (lost-track-of-a-process extension)**: an ORPHANED council probe (left running ~98% CPU from Friday, untracked) pegged the machine; under load-46 contention task.test.ts read 36.5s — FALSE timeout readings attributed to the code under test; after the kill (PID 34661) the gates re-ran green (dialect-matrix 10/10 in 4.47s). Lessons: machine-load is an EVIDENCE-VALIDITY variable (the FM-36 environment-evidence class now covers stale installs AND contended machines); probes are ARTIFACTS — PID-tracked and cleaned like files, or they corrupt every timing measurement taken after them. Corpus since COMMITTED on dev (10c4d4e73b/8b67364f5a/5e1b40819a + 4cc9120443/e1a1f4e241/66410986ad); working tree clean; the annihilation exposure is retired | #19/#20 |
| FM-38 | implicit timeout budgets on container-backed test legs (council-incident, NAMED Memo #20): bun test's default 5000ms produced 16/23 FALSE failures in the opencode-PG leg — ephemeral-container PG latency (cold pool, first-query planning, LISTEN setup) legitimately exceeds 5s with zero defect in the code under test; a healthy tree reads as regressed (inverse of FM-30's vacuous green: real code, false red) | timeout budgets must be EXPLICIT for container-backed test legs — pg-test.yml opencode-PG leg runs `bun test --timeout=30000` behind a LOAD-BEARING comment ("bun default 5000ms → 16/23 timeout-failures (council probe); never drop this flag", commit 4cc9120443); new container-backed suites inherit the flag + comment; any leg-wide timeout change requires FM-36 executed-evidence measured under verified machine load (FM-37 instance 3) | #20 |
| FM-39 | env-gated module load crashes dialect no-op tests instead of skipping them (pre-existing, NAMED Memo #21): the wake-pg suite's SQLite no-op tests CRASH when TEST_DATABASE_URL is unset because the Wake module's PG import path is env-gated at module scope — an unset required env should SKIP a no-op leg, never crash it (mirror of pg-test.yml's job-level env discipline, missing at the suite level); dev-worktree proof (2026-08-31) shows the crash IDENTICAL on dev — present before the upstream merge, not merge-caused, not merge-worsened; the V3/V4/V5a adjudication (PRE-EXISTING via dev-worktree / FLAKY-UNDER-LOAD via isolation passes) already absorbed its failures | test-design defect, backlog fix: gate the no-op leg at the SUITE boundary on env presence (skip-when-unset); non-blocking for the upstream merge (the merge neither introduced nor worsened it); any future "crash on unset env" sighting reclassifies to this row | #21 |

**VERDICT: APPROVE**

Recording instruction for the implementer: append Part 1 memos verbatim to `.opencode/db-decision-memos.md`, commit Part 2 as `0000_init` (regenerating `schema.gen.ts`/`migration.gen.ts`), and attach Part 3 as the blessed parity matrix beside it. The two code-review gates that remain live at PR time: Memo #1 Conditions 1–2 (listener implementation) and the runner advisory-lock path from Memo #5 — both are review checklist items, not open design questions.

---

# PART 5 — DECISION MEMO #6 (AMENDMENTS: anchor-bug batch B1–B5, dead tables, deferrals)

Session 2 (fresh). Every file:line below was opened and read this session; the subagent investigation's claims were treated as leads and re-verified on disk before ruling. Evidence base for this memo:

| File | What it established |
|---|---|
| `packages/opencode/src/tool/task.ts:136-212` | child session created before prompt (`:156-172`); parent's model passed (`:181-184`); `metadata.sessionId` recorded (`:185-195`); `ops.prompt` invoked with explicit model (`:200-212`) |
| `packages/opencode/src/session/prompt.ts:144-148,594-653,635-646,960-1070` | `ops().prompt` wires to v1 `prompt` (`:144-148`); `currentModel` last resort `provider.defaultModel().pipe(Effect.orDie)` (`:614-633`, throw site `:632`); model resolution inside `createUserMessage` BEFORE persistence (`:646` vs `:1046-1047`); `prompt()` calls `createUserMessage` first (`:1052-1057`) |
| `packages/opencode/src/session/session.ts:631-633` | v1 `updateMessage` PUBLISHES durable `SessionV1.Event.MessageUpdated` — not a bare table write |
| `packages/opencode/src/session/processor.ts:560-625` | halt sets `ctx.assistantMessage.error` in memory + ephemeral publish, never persists (`:599-625`); interrupt path DOES persist via `session.updateMessage` (`:595-596`) — existing precedent |
| `packages/tui/src/context/data.tsx:425-432` | TUI sidebar reads v2 `sdk.client.v2.session.messages` (context for B1; app-layer) |
| `packages/core/src/session.ts:207-262` | `ProjectTable` insert `.onConflictDoNothing()` OUTSIDE the event tx (`:213-218`); `events.publish(Created)` follows (`:241-242`) |
| `packages/core/src/session/context-epoch.ts:40-174` | `insert` (`:52,87` → def `:122-139`), `replace` (`:68` → def `:141-159`) are bare writes outside any event tx; `advance` already runs INSIDE via the `{ commit }` hook (`:72-76,161-174`); `baselineSeq` from `EventV2.latestSequence` (`:67,127`) |
| `packages/core/src/event.ts:230-369` | durable-event tx: seq select `:243-248`, replay early-return `:262-289` (projectors + commit hook SKIPPED on replay), id check `:303-315`, projectors in-tx `:320-322`, commit hook in-tx `:323`, seq upsert `:324-335`, event insert `:336-348` |
| `packages/core/src/session/projector.ts:78-110,190-234,255-354` | `applyUsage` is already an atomic delta UPDATE (`:96-108`); PartUpdated SELECT-previous → upsert → TWO applyUsage (`:312-330`); MessageRemoved per-part applyUsage loop (`:276-294`); Created projector inserts SessionTable in-tx (`:215-233`) |
| `packages/core/src/data-migration.sql.ts:1-6` + repo-wide grep | `data_migration`: zero consumers (definition + generated snapshot + creating migration only) |
| `packages/core/src/credential/sql.ts:1-14`, `credential.ts:56-132` (grep), `integration.ts:200-259`, `plugin/host.ts:9,109,136-163` (grep), 4 test files | `credential` is NOT dead: full CRUD service; `integration.ts:221-224` `locationLayer` hard-yields `Credential.Service`; dual-dialect test matrix exercises it |
| `packages/schema/src/v1/session.ts:327-355,453-488,502-507,571-676` | `User.model` REQUIRED (`:347-351`); `Assistant.modelID/providerID` REQUIRED (`:462-463`); durable options `{aggregate: "sessionID", version: 1}` on Created/Updated/Deleted/MessageUpdated/MessageRemoved/PartUpdated/PartRemoved (`:502-507,571-629`); `Error` has NO durable options → ephemeral (`:651-657`) |

---

```
DECISION MEMO #6 — AMENDMENTS: B1-B5 ANCHOR-BUG BATCH, DEAD TABLES, DEFERRALS
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: b (concurrency-semantics fix shapes B4/B5), c (0000_init consequence:
         dead-table ruling amends the signed bootstrap), d (dual-backend parity
         divergence: epoch/usage guards behave identically on SQLite), plus
         explicit call by orchestrator (B1-B3 DB-semantics rulings).
VERDICT: APPROVE-WITH-CONDITIONS
```

## B1 — subagent user message durable before model resolution (DB-semantics ruling)

**VERDICT(B1): APPROVE-WITH-CONDITIONS**

**Fence question (asked by orchestrator): does persist-before-resolve violate the Memo #2 HARD FENCE? NO.** The fence governs TIER/POOL membership — "an admitted session_input or committed epoch write … flushed via the async pool is an automatic REJECT." The v1 user-message write is a durable `SessionV1.Event.MessageUpdated` publish (`packages/opencode/src/session/session.ts:631-633`) plus its MessageTable/PartTable structural projections — both SYNC-tier items by Memo #2 membership. Reordering two sync-tier operations touches no fence. What WOULD breach the fence or the durable line: (i) "solving" B1 with a bare `MessageTable` insert bypassing the event, or (ii) queueing the write on the async flush pool. Both are REJECT-on-sight.

**OPTIONS**
- **A. Reorder: persist user message before model resolution** (`createUserMessage` persist at `prompt.ts:1046` moved ahead of resolution at `:646`). BLOCKED as stated: `User.model` is schema-REQUIRED (`packages/schema/src/v1/session.ts:347-351`) — a pre-resolution persist is either schema-invalid or persists a placeholder model, and a placeholder is a lie in the durable line (replay would resurrect a bogus model forever). Viable ONLY as A′: reorder + make `User.model` optional — a wire-contract/SDK-surface change that loosens the durable fact. That is Oracle's call, not mine; my DB verdict on A′: permissible (optional fields decode-compatibly; the projector upsert tolerates absence since `message.data` is jsonb) but strictly worse than C.
- **B. Failure tombstone on catch**: persist on the failure path only. Same schema blocker as A when NO model resolved at all (`NoProvidersError`/`NoModelsError` — there is no truthful model to record); when a requested model exists but died later, B2's persisted assistant error already covers it. A tombstone event type that carries no model would be new durable vocabulary for a non-fact — rejected on durable-line purity.
- **C. Pre-validate model resolution; fail the task tool cleanly** (resolution chain `input.model ?? ag.model ?? currentModel` evaluated before any durable message write; failure → ephemeral `Session.Event.Error` + tool-part error state). Tool parts require no model (`Part` union, `schema/src/v1/session.ts:357-370`) — the failure IS recordable as a durable PartUpdated on the parent without schema changes. No orphan half-facts; the child Session row (`task.ts:156-172`) remains the only residue, now explained by a visible parent tool error (needs B3).

**Adjudication: C** (DB-semantics ranking; the app-layer mechanics are Oracle's). Durable facts must be complete and true at commit; "attempted but unresolvable" belongs in the parent's tool-part error state, not in a model-less user message.

**Projector/replay hazard ruling (both dialects):** any early persistence MUST ride the same durable `MessageUpdated` publish path — then replay converges by upsert (`projector.ts:262-274`) in both SQLite and PG, and exact-retry overwrite semantics are unchanged. A bare row write is invisible to `replayAll` → replay would re-create the empty-transcript bug under replay. The V2 invariant "SessionV2.prompt admits one durable session_input before wake" is NOT touched by B1 (this is the v1 path; TaskTool injects no session_input). If pre-validation is later added to the V2 runner, it must run AFTER admission, never replace it.

**INVARIANTS**
- Memo #2 HARD FENCE — pass (write stays sync-tier; fence is about pool membership, not intra-sync ordering).
- "The log is the only truth, everything else is derived" — C passes; A-placeholder and B-new-event fail it; A′ passes weakly.
- V2 admission-before-wake — untouched (v1 path).

**DURABLE-vs-DERIVED:** durable line (event + structural rows); ruling constrains WHAT may become durable, not just when.

**CONDITIONS**
1. B1.1: Any pre-resolution or failure-path persistence must flow through durable `SessionV1.Event.MessageUpdated` (or PartUpdated for tool-error state) — never a bare MessageTable/PartTable write, never the async pool.
2. B1.2: If Oracle selects A′ (reorder + optional `User.model`), that wire-contract change requires Oracle's counter-sign and SDK regeneration; `part`/`message` jsonb columns need no change.
3. B1.3: Pre-validation in the V2 runner path, if ever added, executes after session_input admission (V2 invariant), never instead of it.

**Effort:** Short (Oracle's domain).

---

## B2 — halt persists assistantMessage.error via updateMessage

**VERDICT(B2): APPROVE-WITH-CONDITIONS**

**OPTIONS**
- **A. Persist via `session.updateMessage` (event-publishing) in halt**, mirroring the interrupt path at `processor.ts:595-596`.
- **B. Persist via bare MessageTable write.** REJECT — bypasses the event log; replay would drop the error state (the exact defect class being fixed), and diverges from every other message mutation.

**Double-event analysis (requested):** today halt publishes `SessionV1.Event.Error`, which carries NO durable options (`packages/schema/src/v1/session.ts:651-657`) → ephemeral bus only. Persisting via `updateMessage` adds durable `MessageUpdated` — a different definition on a different channel; there is no duplicate. Replay today DROPS the error (memory-only); after the fix, replay converges on the error state via the MessageUpdated upsert (`projector.ts:262-274`) — the fix strictly improves replay fidelity. `MessageUpdated` projection touches no usage counters (`applyUsage` fires only on PartUpdated/PartRemoved, `projector.ts:96-110,325-328`) — no cost side-effects. Idempotent under re-halt (upsert).

**INVARIANTS** — durable line strengthened (error state becomes a fact); no invariant regression.

**DURABLE-vs-DERIVED:** moves error state from memory (neither) into the durable line, correctly via the log.

**CONDITIONS**
1. B2.1: Persist before `status.set(idle)` so idle-transition subscribers observe the persisted error.
2. B2.2: Keep exactly one ephemeral `Session.Event.Error` publish per halt; do not add a durable error event type.

**Effort:** Quick.

---

## B3 — runTask checks result.info.error

**VERDICT(B3): APPROVE**

Confirmed: reads already-persisted result state; zero DB interaction. Note only: B3's signal exists once B2 lands (ordering B2 → B3 for the implementer).

---

## B4 — transaction gaps: ProjectTable upsert + context-epoch writes (★ my domain)

**VERDICT(B4): APPROVE-WITH-CONDITIONS**

Verified geometry: the durable-event tx (`event.ts:239-352`) runs projectors in-tx (`:320-322`) and the `{ commit }` hook in-tx (`:323`); the Created projector inserts the Session row in-tx (`projector.ts:215-233`), so the FK `session.project_id → project.id` requires the project row committed BEFORE the publish — moving the upsert inside the tx would place it AFTER projectors (no pre-projector hook exists) → FK violation. The replay path returns early (`event.ts:262-282`) — projectors and commit hooks do NOT re-run on replayed identical events, so in-tx side-writes are single-execution and replay-convergent by construction.

**OPTIONS — ProjectTable upsert (`packages/core/src/session.ts:213-218`)**
- **A. Leave as-is** (idempotent `.onConflictDoNothing()` autocommit before the event tx). Crash window leaves an orphan project row — benign: project rows are directory-keyed registry rows shared across sessions, not garbage; retry no-ops. Concurrent same-project creates resolve via ON CONFLICT on both dialects.
- **B. Wrap `create()` in one outer transaction** (savepoint nesting under the vendored bridge). Atomic create, but holds an outer tx across the event tx for purely cosmetic benefit (no orphan *garbage* exists) and adds bridge-complexity risk on the hottest entry path.
- **C. Move upsert into the event tx.** Impossible without a pre-projector hook; FK fails.

**Adjudication: A** — with the benign window documented.

**OPTIONS — epoch `insert` (`context-epoch.ts:85-87,122-139`)**
- **A. `INSERT … ON CONFLICT (session_id) DO NOTHING` + read-back via `find()`; return the READ-BACK row's baseline_seq.** Idempotent under the real race (two processes resuming one session post-crash — unreachable today under in-process Semaphore(1), reachable under PG multi-process); first-writer-wins is semantically correct (both compute from the same pre-event state). Identical drizzle code both dialects.
- **B. Keep exists()+insert.** TOCTOU → second inserter dies on PK violation (`Effect.orDie`) — a crash-looping resume under PG. REJECT.
- **C. Advisory lock per session.** REJECT — same reasoning as rejected drain election (process-local doctrine).

**Adjudication: A.**

**OPTIONS — epoch `replace` (`context-epoch.ts:67-68,141-159`)**
- **A. Monotonic guarded UPDATE**: `SET baseline=…, snapshot=…, baseline_seq=:new WHERE session_id=:id AND baseline_seq <= :new` + `.returning()`; 0 rows ⇒ a newer epoch won — re-read and proceed. Single-statement atomic under both dialects; no isolation dependency; no locks. Stale `latestSequence` reads (`:67`) can only ever record a CONSERVATIVE (lower) baseline_seq — safe by the epoch's meaning ("valid through seq N"); the guard makes lost-update-overwrite impossible.
- **B. SELECT FOR UPDATE then update.** PG-only syntax, extra round trip, redundant once same-aggregate event commits serialize on event_sequence (T2); SQLite has no equivalent. REJECT.
- **C. Fold replace into a commit hook behind a synthetic durable event.** Pollutes the log with a non-fact to buy serialization. REJECT — durable-line purity (the reconcile branch already uses the hook correctly at `:72-76` because a real event accompanies it).

**Adjudication: A.** `advance()` (`:161-174`) already runs in-tx via the commit hook and is aggregate-serialized under T2 — leave unchanged.

**INVARIANTS**
- Memo #2 fence — pass: epoch writes remain sync-tier bare statements on the transactional pool; guards change statement shape, not tier.
- V2 "Session History selection plus Context Epoch persistence Session-owned" — pass (ownership untouched; only atomicity hardened).
- Replay idempotency — pass (in-tx side-writes skip on replay early-return; guarded/idempotent forms are safe even if re-executed by a future backfill).

**DURABLE-vs-DERIVED:** epoch table is durable (sync tier); fix keeps it durable while removing TOCTOU — no line blurring.

**CONDITIONS**
1. B4.1: `insert()` → onConflictDoNothing + read-back; the RETURNED baseline_seq must come from the read-back row, never the local computation.
2. B4.2: `replace()` → guarded `baseline_seq <= :new` predicate + returning; 0-rows is a re-read-and-continue path, not an error.
3. B4.3: ProjectTable upsert stays outside the event tx with onConflictDoNothing (NOT DoUpdate — never clobber); the benign orphan window is documented in code comment.
4. B4.4: No new pre-projector hook, no synthetic durable events, no session-scoped advisory locks.

**Effort:** Short. **Verification:** Part 4 addendum steps 8-9.

---

## B5 — usage/cost race + N+1 in projectors (★ my domain)

**VERDICT(B5): APPROVE-WITH-CONDITIONS**

**Race scoping (corrects the investigation's premise):** the SELECT-previous at `projector.ts:318` runs INSIDE commitDurableEvent's transaction (`event.ts:320-322`). All PartUpdated/MessageRemoved/PartRemoved events for a part carry that session's aggregate; under the accepted design (T2/Memo framework), concurrent commits for the SAME aggregate serialize on the event_sequence row (FOR UPDATE). Therefore the READ COMMITTED stale-previous interleaving CANNOT occur through the durable-event path once the PG port lands — same-aggregate writers never interleave between `:318` and `:324`. The race is real only through (i) pre-port multi-process SQLite (already on the fixed-by-PG list) or (ii) any projector execution OUTSIDE the aggregate-serialized tx. Guarding (ii) is a fence matter, not a locking matter.

**OPTIONS — previous-read atomicity**
- **A. Rely on aggregate serialization + fence extension.** Cost: none beyond review discipline. The async tier (Memo #2) projects only Text.Delta/Tool.Progress, which carry no usage (usage lives on StepFinish parts, `schema/src/v1/session.ts:240-256`); extend the fence so it STAYS that way.
- **B. FOR UPDATE on the `:318` SELECT.** PG-only syntax guarding a race the serialization already excludes; dialect-divergent code. REJECT.
- **C. Single-statement CTE read-old/upsert-new.** Portable-awkward, complex, defends nothing A doesn't. REJECT.

**Adjudication: A.**

**OPTIONS — N+1 batching (`:96-110` per-part loops at `:284-287`; two applyUsage per PartUpdated at `:327-328`)**
- **A. Consolidate deltas in JS, one applyUsage per event:** PartUpdated emits ONE statement with `next − previous` (skip when equal; keep two statements only on the anomalous `previous.session_id ≠ next.session_id` cross-session case); MessageRemoved sums the selected rows' usage and emits ONE statement with sign −1. `applyUsage` already IS the atomic `SET cost = cost + Δ` form (`:96-108`) — keep it; batch its inputs.
- **B. RETURNING-based read-old-write-new per statement.** More round trips than A, no added correctness. REJECT.
- **C. Recompute session totals from parts on every event.** O(parts) writes on the hottest path. REJECT.

**Adjudication: A** — per-event statement count drops from O(parts) to 1; arithmetic is order-independent, so SQLite (serialized) and PG (aggregate-serialized) both converge identically.

**INVARIANTS**
- Memo #2 async-tier membership — pass, extended: usage-bearing projections (any part carrying StepFinish/usage data) NEVER on the flush pool; fence violation is REJECT on review.
- Event log as truth — pass: session.cost/tokens remain derived, batched deltas remain replay-equivalent.

**DURABLE-vs-DERIVED:** derived line only (projections of the log); fix preserves derivability.

**CONDITIONS**
1. B5.1: Batch per-event usage deltas per OPTIONS-A shapes; add the cross-session anomaly split for PartUpdated.
2. B5.2: Fence extension recorded: usage-bearing projections are sync-tier only; any PR moving StepFinish-part projection to the async pool is REJECT on sight.
3. B5.3: No FOR UPDATE, no CTE upserts in the projectors (aggregate serialization is the correctness mechanism; Part 4 step 10 verifies it is actually taken).

**Effort:** Short. **Verification:** Part 4 addendum steps 10-11.

---

## B6 — dead tables (★ my domain; amends the signed 0000_init / parity matrix)

**VERDICT(B6): APPROVE-WITH-CONDITIONS**

**OPTIONS — `data_migration` (`data-migration.sql.ts:3-6`)**
- **A. Omit from PG 0000_init.** Zero consumers verified by grep this session (definition + `schema.gen.ts:21` + `migration.gen.ts:24` + creating migration `20260511000411` only). Fresh bootstrap has no legacy data-migration state to record — the table's entire purpose is void in a fresh PG. Standing rule (Memo #5) permits clean reintroduction via a numbered migration when a runner ships. Parity matrix row amended; DDL block above replaced with the omission note.
- **B. Keep for forward-compat.** Dead catalog surface; matrix implies a consumer that does not exist. REJECT — parity is for live behavior, not archaeology.
- **C. Keep with dormant comment.** Same cost as B. REJECT.

**Adjudication: A.**

**OPTIONS — `credential` (`credential/sql.ts:5-14`)**
- **A. Keep in 0000_init.** The investigation's "dead" call is OVERTURNED on file evidence: `Credential.Service` is full CRUD on the table (`credential.ts:56-132`); `integration.ts:221-224` — the Integration `locationLayer` — hard-yields `Credential.Service`; `plugin/host.ts:9,109,136-163` uses the Credential module; four test files exercise it, and the DIALECT=sqlite|pg matrix (plan Step 7) fails without the table. Zero-consumers-in-`packages/opencode` (if accurate for the CLI surface) does not make a core-wired table dead. Upstream #40920 intent supports this.
- **B. Omit + strip Credential.Service from PG builds.** Cascading core surgery for zero benefit; breaks integration tests. REJECT.

**Adjudication: A.**

**CONDITIONS**
1. B6.1: `data_migration` stays omitted; reintroduction ONLY via numbered PG migration ≥ 0001 when a data-migration runner is implemented (standing rule).
2. B6.2: Task 2 dump/restore design carries a skip-list containing `data_migration` (FM-16).
3. B6.3: Part 2/Part 3 amendments (applied this session) are the new signed surface; any 0000_init divergence from them at review is REJECT until re-blessed.

**Effort:** Quick (artifacts already amended by me).

---

## B7 — deferrals confirmation

**VERDICT(B7): APPROVE**

- v1/v2 read-path unification: defer CONFIRMED — app-layer; my schema already serves both tables; no DB structure blocks it.
- project identity "global" catch-all (#37096/#39773): defer CONFIRMED — project rows are registry rows; when designed it lands as numbered migrations.
- event-log retention: defer CONFIRMED (existing trigger: >10M rows). Memo #4's 16-partition layout is retention-friendly (detach/drop partitions later) — already recorded.
- session search ILIKE: defer CONFIRMED, with one recorded caveat: unanchored `ILIKE '%…%'` at scale needs trigram indexing and pg_trgm is REJECTED cargo cult per baseline — when search enters scope it requires either an Oracle-approved baseline amendment or a design that avoids unanchored ILIKE (e.g., an explicit tsvector column as a numbered migration). Flag recorded; no action now.

---

**INVARIANTS (memo-level):** all hot-path items untouched structurally; B4/B5 preserve every previously-passed invariant; no GIN, no partitioning change, no index change introduced by this memo.

**FAILURE-MODES-UPDATED:** yes — FM-11..FM-16 appended to the Part 4 table.

**CONDITIONS (consolidated):** B1.1-B1.3, B2.1-B2.2, B4.1-B4.4, B5.1-B5.3, B6.1-B6.3.

**UNVERIFIED**
1. UNVERIFIED: `provider.defaultModel()` throw type is exactly NoProvidersError/NoModelsError — cheapest resolve: open `packages/opencode/src/provider/provider.ts` defaultModel at B1 implementation time; ruling does not depend on the type (any pre-persist throw is covered).
2. UNVERIFIED: upstream PR #40920 credential intent (cited by investigation, not opened) — irrelevant to ruling; decision rests on in-repo consumers.

**ORACLE-COUNTER-SIGN:** required-B1 app-layer mechanics only (option choice A′/B/C; A′ additionally changes a wire contract). B2/B3 app-layer mechanics proceed under my conditions; B4/B5/B6/B7 are mine alone.

**VERDICT: APPROVE-WITH-CONDITIONS**

---

# PART 6 — TASK 2: MIGRATION ARTIFACT + SCRATCH VERIFICATION

Session 3 (Athena, Task 2 per plan v2). Artifact authored, executed, and verified on a real scratch PostgreSQL this session; every result below is from that run (host transcript, condensed). Re-grounded on PART 2 (amended), PART 3, PART 4 (incl. addendum 8–12), PART 5 before authoring.

## 6.1 — Artifact

**File:** `.opencode/db-migrations/0000_init.sql` — the blessed executable form of PART 2 as amended by Memo #6 B6 (`data_migration` omitted, `credential` kept).

- Statements are the signed PART 2 DDL **verbatim**. Executability deltas ONLY (sanctioned by the Task 2 spec, "formatting for executability fine; semantics identical"): `IF NOT EXISTS` qualifiers on tables/indexes, and a file header documenting the runner contract. **Semantic deviations from the signed surface: NONE** (B6.3).
- Runner contract encoded in header: the file contains **no `BEGIN`/`COMMIT` and no advisory-lock statement** — `pg_advisory_lock(727274)` is held RUNNER-SIDE via `client.reserve` + finalizer (Memo #5). Single-transaction executability proven below.
- Statement census: **35 CREATE TABLE** (18 non-partition tables + `event` parent + 16 partitions; = 19 SQLite tables − `data_migration` + `session_projection_checkpoint` + parent + 16), **15 CREATE INDEX** (one partial), **16 ALTER TABLE** (per-partition autovacuum), **1 DO block** (guarded `pg_stat_statements`). The Task 2 brief's "38 CREATE TABLEs" matches no signed count; the signed surface governs.
- Idempotency form: `IF NOT EXISTS` per object; `CREATE EXTENSION IF NOT EXISTS` inside exception-guarded DO block; `ALTER TABLE … SET` re-entrant.

## 6.2 — Environment

`postgres:17-alpine` (PostgreSQL 17.11, x86_64-linux-musl), container `athena-scratch-pg`, host port 56714, flags mirroring signed §7 compose command: `postgres -c wal_compression=on -c shared_preload_libraries=pg_stat_statements` (verified live: `wal_compression=pglz`, `shared_preload_libraries=pg_stat_statements`). All heavy commands `nice -n 10`. Container removed after verification (`containers_remaining: 0`).

## 6.3 — Idempotency + transaction-contract proofs

| run | target | mode | result |
|---|---|---|---|
| 1 | `opencode` (fresh) | `psql -f`, ON_ERROR_STOP=1 | exit 0 |
| 2 | `opencode` (re-run) | same | exit 0, **51 "already exists, skipping" notices** (35 tables + 15 indexes + 1 extension), 0 errors |
| 3 | `opencode_tx_test` (fresh) | `psql -1` (**single transaction** — runner contract) | exit 0; 35 CREATE TABLE / 15 CREATE INDEX / 16 ALTER TABLE / 1 DO; no errors/warnings |

## 6.4 — Part 4 steps 1–7 (adapted: scratch container stands in for compose `db` service)

| step | check | result |
|---|---|---|
| 1 | service up, bootstrap applied | **PASS** (runs 1–3 above) |
| 2 | catalog vs PART 3: tables=35, unexpected=NONE; per-table column-count mismatches=**0**; NOT NULL total=**104**; type distribution = timestamptz 31 / jsonb 15 / bigint 12 / double precision 1 / boolean 2 / integer 5 / text 75 (= 141 columns; arithmetic matches DDL: 33 `timestamptz` greps = 31 columns + 2 comment lines) | **PASS** |
| 2 (FK graph) | `pg_constraint`: **13 CASCADE + 1 SET NULL** (`account_state`) declared + 16 mechanical clones of the event FK on partitions — exactly the signed graph. NOTE: `information_schema.referential_constraints` shows CASCADE=45 (view artifact of partition cloning); catalog is authoritative; the runner's `information_schema.tables` probe is unaffected | **PASS** |
| 3 | index inventory: non-partition indexes **35** (incl. 3 partitioned indexes on `event` parent); partition indexes **48 = 16×3**; `todo_session_idx` present=**0**; partial predicate exact: `(session_id, delivery, admitted_seq) WHERE (promoted_seq IS NULL)`; unique backstops present (`admitted_seq`, `promoted_seq`); fillfactor=80 on `part` + `session_message` = true/true; autovacuum 0.01/0.005 on **16/16** partitions | **PASS** |
| 4 | partitions: `pg_inherits` children of `event` = **16**; `\d event_p07` shows `PRIMARY KEY (aggregate_id, seq)`, `UNIQUE (aggregate_id, id)`, `btree (aggregate_id, type, seq)`, FK clone `ON DELETE CASCADE`; **EXPLAIN** `… WHERE aggregate_id='ses_test' AND seq > 0 ORDER BY seq` → single `Index Scan using event_p15_pkey`, Index Cond `(aggregate_id = ? AND seq > 0)`, no Append, no Sort; unique partitions referenced = **1** → **"partitions considered: 1" assert SATISFIED** (PG text output names the surviving partition rather than printing a count; assert operationalized as exactly-one-partition-in-plan). **Closes Memo #4 UNVERIFIED #1 with evidence.** Catalog naming detail: partition clone indexes get PG-derived names (`event_p07_aggregate_id_id_key`); the parent constraint name is the signed `event_aggregate_id_id_idx` — mechanical, not a divergence | **PASS** |
| 5 | spot-fires: duplicate `(ses_test,1)` insert → `ERROR 23505 event_p15_pkey` (per-partition PK enforced); two `promoted_seq IS NULL` rows coexist (**multi-NULL unique**); second promotion to same `promoted_seq=1` → `ERROR 23505 session_input_session_promoted_seq_idx` (**backstop fires**); `DELETE session` → all 8 child surfaces = 0 rows left (**cascade graph verified**). Note: the two promotion UPDATEs ran in one psql `-c` string = one implicit tx, so the violation also rolled back the first promotion — standard PG atomicity; app shape is one promotion statement per call (input.ts), backstop proof unaffected | **PASS** |
| 6 | observability queries (gauge, panel, backstop poll) executed error-free with consistent lags (see 6.6). Full SQLite→PG dump/restore round-trip: **UNABLE** — the dump/restore CLI is plan Step 6 (not yet implemented); Part 4 step 7 permits UNABLE rows. Structural prerequisite (skip-list target `data_migration` absent) verified in step 12 | **PASS (queries) / UNABLE (round-trip, deferred to Step 6 PR)** |
| 7 | this section is the checklist | **PASS** |

## 6.5 — Part 4 addendum steps 8–12 (B4/B5/dead tables)

| step | check | result |
|---|---|---|
| 8 | epoch double-initialize race (two concurrent psql tx: `INSERT … ON CONFLICT (session_id) DO NOTHING` + read-back): clean race on `ses_race2` — A: `INSERT 0 1`, read-back 11; B: `INSERT 0 0`, **blocked 1995 ms** on A's uncommitted insert, read-back **11** (winner's value, not B's local 22); exactly 1 row, 1 distinct baseline_seq. First attempt aborted pre-timing left a committed A-row on `ses_race` — retry converged idempotently on the same winner (bonus: retry-idempotence of the B4.1 shape). **B4.1 semantics + FM-13 verified** | **PASS** |
| 9 | monotonic guarded replace (from 11): `… SET baseline_seq=40 WHERE baseline_seq <= 40 RETURNING` → 1 row (40); `… SET baseline_seq=25 WHERE baseline_seq <= 25 RETURNING` → **0 rows**; read-back = 40/b40 (stale write did not land; 0-rows = re-read-and-continue path). **B4.2 + FM-14 verified** | **PASS** |
| 10 | aggregate serialization: A holds `SELECT … FOR UPDATE` on `event_sequence(ses_test)` (seq=2), inserts seq=3, sleeps 2s, commits; B (0.3s later) **blocked — B's locked read returned seq=3 only after A's commit** (elapsed 2720 ms incl. docker exec startup), then wrote seq=4. Final: `event_sequence.seq=4`; events for `ses_test`: count=4, distinct seq=4, contiguous 1..4=true. **Exact-seq commit serialized by FOR UPDATE on event_sequence — B5.3's correctness mechanism + FM-15 precondition verified** | **PASS** |
| 11 | usage-batching arithmetic: 3 PartUpdated-shaped single-statement deltas → session cost 4.75 = Σ part cost 4.75; one MessageRemoved-shaped **summed** single statement (sign −1) + part delete → 4.0 = 4.0; cross-check booleans `cost_equiv=true, tokens_equiv=true`. Deltas commute (additive), order-independent under both dialects. **B5.1 equivalence verified** | **PASS** |
| 12 | `to_regclass('data_migration') IS NULL` = true; `to_regclass('credential') IS NOT NULL` = true. **B6.1/B6.2 + FM-16 (schema side) verified** | **PASS** |

## 6.6 — Observability smoke (Part 2 §observability, verbatim queries)

- **(a) gauge:** `ses_test` committed 4 / applied −1 / lag 5; `ses_usage` committed 5 / applied 3 / lag 2 — matches fixtures exactly.
- **(b) `--sessions` panel:** drain owner (`ses_usage` → `proc_1`), lags, `pending_queued=1`/`pending_steer=1` on `ses_test`, `next_pending_admitted_seq=2`; NULL-lag sessions (`ses_race`, `ses_race2`) sort `NULLS LAST`. No errors.
- **(c) backstop poll:** returned the 2 pending rows via the partial index shape (`si_a` steer/1, `si_b` queue/2).
- **pg_stat_statements:** live under preload, 219 rows captured during verification.

## 6.7 — Failure-mode cross-references exercised

FM-04/FM-06 (checkpoint table present; same-tx rule is app-side, structure verified), FM-07 (16 partitions, fixed), FM-13 (step 8), FM-14 (step 9), FM-15 (steps 10–11), FM-16 (step 12, schema side). No table updates required — all guards held; FM-16's dump/restore half lands with plan Step 6.

## 6.8 — Decision memo

```
DECISION MEMO #7 — TASK 2 MIGRATION CUT: BLESSED EXECUTABLE 0000_init
STATUS: APPROVED
TRIGGER: c (migration cut)
VERDICT: APPROVE
```

**OPTIONS**
- **A. Blessed raw-SQL artifact in `.opencode/db-migrations/0000_init.sql` (authored by me, verified on scratch PG this session), implementer's generated 0000_init must be diff-equivalent to it.** Chosen: the signed surface stays single-sourced; verification is against exactly what will ship.
- **B. Implementer generates 0000_init directly from schema definitions with no blessed intermediate.** Rejected: Memo #5 Condition 1 ("emitted from Part 2 verbatim; divergence is REJECT until re-blessed") loses its reference point; drift would be undetectable at review.
- **C. Ship the raw-SQL file itself as the runtime migration.** Rejected as the final state: drizzle-kit regeneration of `schema.gen.ts`/`migration.gen.ts` is the baseline toolchain (Memo #5); raw SQL remains permitted inside `up(tx)` for partition/autovacuum/fillfactor sections.

**INVARIANTS**
- event `(aggregate_id, seq)` unique per partition; ordering intact; replay index per-partition equivalent — pass (step 4: PK + propagated indexes + single-partition ordered index scan).
- session_input partial pending index exact shape; promotion `promoted_seq IS NULL` predicate app-side (input.ts); `UNIQUE (session_id, promoted_seq)` backstop — pass (step 3, step 5).
- session_message history pagination index `(session_id, time_created DESC, id DESC)` — pass (step 3).
- Migration apply via `pg_advisory_lock(727274)` runner-side, `client.reserve` + finalizer — pass by construction (file carries no lock; single-tx executability proven, run 3). Runner implementation remains a live review item at the Step 3 PR (Memo #5).

**DURABLE-vs-DERIVED:** structure only; materializes both lines exactly as signed (durable: event log/inbox/epoch/structural; derived: session_message/part projections + checkpoint).

**FAILURE-MODES-UPDATED:** no — 6.7 cross-references only; no new failure modes observed.

**CONDITIONS**
1. The implementer's committed `0000_init` (plan Step 3) must be statement-equivalent to this artifact; any divergence is REJECT until re-blessed (B6.3 discipline, restated for the generated form). Partition/autovacuum/fillfactor sections may remain raw SQL inside `up(tx)` per Memo #5 Condition 1.
2. The runner must execute it inside one transaction while holding `pg_advisory_lock(727274)` via `client.reserve` (proven tx-safe by run 3).
3. Part 4 step 6 round-trip re-runs on the compose `db` service at the Step 6 PR (dump/restore CLI), closing the UNABLE row and FM-16's operational half.

**UNVERIFIED**
1. UNVERIFIED: drizzle-kit emits `PARTITION BY` DDL natively (Memo #5 UNVERIFIED #1, still open) — cheapest resolve: Step 3 spike; raw-SQL sections are the sanctioned fallback and are already blessed here.

**ORACLE-COUNTER-SIGN:** not-required (DB-domain artifact authoring; no baseline change, no new dependency).

**VERDICT: APPROVE**

---

# PART 7 — MID-FLIGHT REVIEW #1: VENDORED `effect-drizzle-pg` PORT (PLAN STEP 1)

Session 4 (Athena, mid-flight review #1 per Duty 1). Surface: `packages/effect-drizzle-pg/**` vs `packages/effect-drizzle-sqlite/**`. `packages/core` NOT reviewed (Step 2 in flight, per instruction). Every file cited below was opened this session.

## 7.1 — Evidence base (all commands `nice -n 10`)

- **Untouched-source proof:** `git status --porcelain` shows no entry under `packages/effect-drizzle-sqlite/`; `git diff --stat` on the dir is empty. Plan's "SQLite untouched" constraint: **PASS**. Working-tree changes are exactly: `bun.lock`, root `package.json` (one catalog line, §7.3 #8), the new package, `.opencode/` artifacts.
- **Structural 1:1:** `diff -rq` of the two `src/` trees shows ONLY the rename mapping (`effect-sqlite`→`effect-pg`, `sqlite-core`→`pg-core`, `sqlite.ts`→`pg.ts`); no modules added or dropped. Token-renamed diffs of `driver.ts`, `migrator.ts`, `utils.ts`, `up-migrations/{pg,sqlite}.ts`, `up-migrations/effect-{pg,sqlite}.ts` are line-for-line identical modulo documented deviations.
- **Typecheck:** `bun run typecheck` (tsgo) in `packages/effect-drizzle-pg` — exit 0.
- **Live tests:** scratch `postgres:17-alpine` (PG 17.11), container `athena-mfr1-pg`, port 56715 — `TEST_DATABASE_URL=… bun test`: **9/9 pass, 0 fail** (4.76s). Container removed after evidence capture; `containers_remaining: 0`.
- **Empirical deferred-constraint sequence** (the §7.3 #3 hot spot), exact bridge statement order via psql: `BEGIN` ok → dup insert **succeeds** (constraint deferred) → `COMMIT` → **ERROR 23505** → bridge's follow-up `ROLLBACK` → **WARNING "there is no transaction in progress"** (success status, no error) → `select` on same connection works, table empty (rolled back).
- **Empirical multi-mode BEGIN:** `begin isolation level serializable read only` and `begin isolation level repeatable read read write not deferrable` — both **accepted** by PG 17 (space-join valid; no commas required in practice). Matches upstream RC2's own convention (`getTransactionConfigSQL` joins with a space — `node_modules/drizzle-orm/pg-core/effect/session.js:99-105`, `pg-core/async/session.js:125-131`).

## 7.2 — Hot-path invariants (bridge scope; core table invariants N/A — no schema here)

| invariant | result | evidence |
|---|---|---|
| Bridge generic over `effect/unstable/sql/SqlClient` (locked #2) | PASS | `effect-pg/session.ts:103-108` (`client.unsafe`); grep of `src/` finds `@effect/sql-pg` only in doc comments; zero driver imports |
| Nested tx = savepoints; nesting depth via `transactionService` tuple | PASS | `effect-pg/session.ts:139-150` (id 0=BEGIN, else `savepoint effect_pg_${id}`); live test 5 |
| tx begin/commit/rollback error paths | PASS | live tests 3,4,6,7 + §7.1 empirical deferred-commit sequence; failure path re-fails with the ORIGINAL commit error (`session.ts:161-166`) |
| No PRAGMAs in PG paths | PASS | grep clean; only matches are a comparison comment (`session.ts:193`) and `utils.ts`'s shared version-map `sqlite:` key (verbatim shared registry; PG path reads `.pg` — `pg.ts:124-125`) |
| Statement compiler hooks | PASS | stock `PgDialect`; `sqlToQuery` at `pg-core/effect/insert.ts:294`, `select.ts:257-258`; `buildBegin` verified valid (§7.1) |
| Migration apply single-tx, advisory lock runner-side | PASS | `pg-core/effect/session.ts:494-507` wraps statements+journal inserts in one `session.transaction`; no lock statement in bridge (correct division — lock is Step 3 runner work per Memo #5) |

## 7.3 — PORT-NOTES deviation adjudication (all ten)

| # | deviation | ruling | basis |
|---|---|---|---|
| 1 | `PgEffectSelectBase` extends concrete `PgSelectBase`; constructor replicates `from()` setup | **ACCEPT** | replication at `pg-core/effect/select.ts:210-240` does exactly what RC2's `from()` does (config.table/fields, isPartialSelect, tableName, joinsNotNullableMap, usedTables); live tests exercise select/where/get through it. PORT-NOTES cites "lines 38-66" — stale cite, actual is 210-240 → Condition 2 |
| 2 | keep SQLite-style `executeMethod` vocabulary + local `PreparedQueryConfig` intersection | **ACCEPT** | `pg-core/effect/session.ts:34-51`; keeps the SqlClient bridge dialect-generic (invariant above); intersection is additive typing over `PgPreparedQueryConfig`, no runtime shape |
| 3 | deferred-constraint commit-failure handler kept 1:1 (explicit ROLLBACK after failed COMMIT) | **ACCEPT — analysis verified** | empirical §7.1: PG terminates the tx at failed COMMIT; follow-up ROLLBACK = warning-only no-op; original error propagates; connection reusable. Wording nuance → Condition 2; automated test owed → Condition 1 |
| 4 | `buildBegin` PG syntax (isolation/accessMode/deferrable) | **ACCEPT** | space-joined multi-mode BEGIN empirically valid on PG 17; matches upstream RC2 convention |
| 5 | journal table PG types | **ACCEPT** | `pg-core/effect/session.ts:455-463`: `id BIGINT … IDENTITY`, `created_at bigint`, `applied_at timestamptz` — decision #3 conformant; read-back/millis stringification identical to SQLite path (`up-migrations/pg.ts:48-50` vs `sqlite.ts:59-61`) |
| 6 | `information_schema` probes with `current_schema()` filter | **ACCEPT** | `up-migrations/pg.ts:114-122`; parameterized; single-search-path semantics mirror SQLite's single-db model |
| 7 | `PgView` in count builder | **ACCEPT** | trivial type mapping, `count.ts` mirrors |
| 8 | `@effect/sql-pg` devDep 4.0.0-beta.83, tests only | **ACCEPT** | catalog pin matches effect line (root `package.json:36`); runtime stays generic (grep proof); rationale for beta line over 0.x (different SqlClient tag) is correct — `0.x` depends on `@effect/sql/SqlClient`, incompatible with `effect/unstable/sql/SqlClient` |
| 9 | `withReplicas` `any` casts inherited | **ACCEPT** | `pg-core/effect/db.ts:244-293` mirrors SQLite's; confined to one helper; upstream pattern |
| 10 | `$withCache` return-type delta | **ACCEPT** | upstream RC2 delta; wrapper override (`select.ts:272-280`) identical in behavior to SQLite wrapper's |

## 7.4 — Findings outside PORT-NOTES

- **No orderBy/limit on PG UPDATE/DELETE builders** (SQLite-only feature, `update.ts` token-diff shows exactly the two removed methods): **ACCEPT** — PG lacks the SQL feature; keeping them would emit SQL PG rejects; misuse fails at COMPILE time under PG (good failure mode); grep of `packages/core/src` finds **zero** consumers chaining `.orderBy`/`.limit` onto update/delete. Bounded-mutation call sites must use WHERE-subquery patterns (Condition 5).
- **`examples/` directory not ported** (sqlite pkg has `examples/basic.ts`): trivial omission, additive-only policy satisfied; no action.
- **Test env-gating:** all 9 tests `return` early when `TEST_DATABASE_URL` unset (`test/pg.test.ts:18,43,…`) — correct for local dev, but a CI run that forgets the var reports 9/9 green with 0 assertions → FM-18 + Condition 3.
- **PG suite replaces SQLite's BEGIN-lock test** (`sqlite.test.ts:102-131`) with "preserves failed transaction statement errors" (`pg.test.ts:166-182`) — reasonable dialect adaptation; PG assertion is weaker (presence-only) — non-blocking note.

## 7.5 — Decision memo

```
DECISION MEMO #8 — MID-FLIGHT REVIEW #1: effect-drizzle-pg PORT (PLAN STEP 1)
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: b | d
VERDICT: APPROVE-WITH-CONDITIONS
```

*(Brief said "MEMO #7"; PART 6.8 already holds DECISION MEMO #7 (Task 2 cut). Series continues at #8 — no renumbering of signed history.)*

**OPTIONS** (at each adjudication point; full table §7.3):
- Deferred-constraint handler — A) keep SQLite 1:1 structure with PG-semantics comment (CHOSEN: verified harmless + belt-and-braces for pool recycling); B) drop the explicit ROLLBACK on PG (REJECTED: breaks 1:1 mandate for zero gain); C) log-and-continue on rollback failure (REJECTED: `Effect.catch(() => Effect.void)` already equivalent, less code).
- onConflict form — A) single-SQL chunk per upstream `PgInsertConfig` (CHOSEN: type-safe, live-tested, `insert.ts:260-286`); B) port SQLite's array form (REJECTED: fights upstream pg-core typing, would fail typecheck).
- UPDATE/DELETE orderBy|limit — A) omit on PG (CHOSEN: PG lacks the feature; compile-time failure on misuse; zero current consumers); B) emulate via ctid/WHERE-subquery codegen (REJECTED: silent re-architecture the SQLite twin doesn't have).
- Test SqlClient — A) `@effect/sql-pg` devDep (CHOSEN: catalog-aligned, runtime untouched); B) hand-rolled mock client (REJECTED: reimplements a driver to test a driver); C) defer tests to core Step 2 (REJECTED: violates plan Step 1 test-matrix requirement).

**INVARIANTS:** §7.2 table — all PASS; core table invariants (event/session_input/session_message/NOTIFY/advisory-lock) not applicable at this layer; migration apply single-tx shape PASS with lock correctly deferred to the Step 3 runner.

**DURABLE-vs-DERIVED:** untouched — bridge layer only; no schema, no tables, no event semantics.

**FAILURE-MODES-UPDATED:** yes — FM-17 (deferred-constraint commit path, verified live, test owed) and FM-18 (suite no-ops without TEST_DATABASE_URL) appended to the PART 4 table.

**CONDITIONS**
1. Before the Step 9 gate: automated test for the commit-time deferred-constraint failure path — `UNIQUE … DEFERRABLE INITIALLY DEFERRED`, duplicate insert succeeds in-tx, COMMIT must fail with the constraint error, connection must remain usable, nothing persisted. Only path where PG/SQLite semantics genuinely diverge; currently verified manually only (§7.1).
2. PORT-NOTES corrections (docs only): #1 cite → `select.ts:210-240`; #3 wording → "PG terminates the tx at failed COMMIT; ROLLBACK is a warning-only no-op" (empirical); record under #4 that space-joined multi-mode BEGIN is valid on PG 17 (this memo's evidence).
3. Step 7 CI matrix must export `TEST_DATABASE_URL` for this package and treat a 0-test run as failure (FM-18).
4. Oracle visibility at Step 9: `@effect/sql-pg` is a new dependency node (devDep only, catalog 4.0.0-beta.83, test-scoped). No counter-sign required now.
5. Carry-forward to Step 2: PG compile-time absence of UPDATE/DELETE `.orderBy`/`.limit` is an accepted dialect boundary; bounded mutations in core must use WHERE-subquery shapes, never the SQLite-only builder methods.

**UNVERIFIED**
1. UNVERIFIED: `PgEffectSelectBase` constructor replication is field-complete vs upstream `PgSelectBase.from()` — cheapest resolve: line-compare against RC2 `pg-core/query-builders/select.js` `from()`; NOTE: live 9/9 (select/where/get/joins through `usedTables`) is strong indirect closure; do the compare only if a join-related select bug ever appears.
2. UNVERIFIED: `information_schema` `table_name` matching is case-sensitive for quoted mixed-case identifiers — out of scope: the only probed table is lowercase `__drizzle_migrations` (`up-migrations/pg.ts:114-122`).

**ORACLE-COUNTER-SIGN:** not-required (vendored port is DB-domain work under locked decision #2; no baseline change, no runtime dependency, no V2 semantics; Condition 4 gives Oracle visibility on the devDep at his Step 9 pass).

**VERDICT: APPROVE-WITH-CONDITIONS**

---

# PART 8 — MID-FLIGHT REVIEW #2: STEP 2 (PG SCHEMA SIBLINGS + DATABASE LAYER + DUAL DISPATCH)

Session 5 (Athena, Step 2 DB-domain review per Duty 1). Scope per brief: `pg.ts`, `pg.bun.ts`, `pg.node.ts`, `path.pg.ts`, `schema.pg.ts`, `schema.sql.pg.ts`, `database.ts` diff, the 8 domain `*.sql.pg.ts` siblings, `packages/core/package.json`, `test/database-pg.test.ts` (as-read state), migration seam contract-check only — `migration.pg.ts` formalization + `drizzle.config.ts` are Step 3 mid-flight (files changed on disk at 16:10/16:12 DURING this review; full review next round). Every file:line below opened this session.

## 8.1 — Evidence base

| Source | What it established |
|---|---|
| `git status --porcelain` + `git diff --stat HEAD` | Working tree changes: `bun.lock`, root+core `package.json`, `database.ts`, 16 new files. **`sqlite.bun.ts`/`sqlite.node.ts`/`migration.ts`/`path.ts`/`schema.sql.ts`/all `*.sql.ts` NOT modified — SQLite path untouched ✓** |
| `git diff HEAD -- …/database.ts` | SQLite init block byte-identical (PRAGMAs WAL/NORMAL/busy_timeout/foreign_keys + `DatabaseMigration.apply`), renames only (`makeDatabase`→`makeSqliteDatabase`, `layer`→`sqliteLayerInit`) + additive `sqliteSchemaLayer` provision; `layerFromPath` under `DATABASE_URL` returns PG layer (intended dispatch, decision #8); missing trailing newline (trivia) |
| `packages/core/src/database/pg.bun.ts:137-157` | acquirer = `native.reserve()` with NO release path; transactionAcquirer wires `reserved.release()` to a detached `Scope.make()` (line 147) nobody closes |
| effect-smol `unstable/sql/SqlClient.ts:111-113,141-147,154-167,284` | `Connection.Acquirer = Effect<Connection, SqlError, Scope>` (`SqlConnection.ts:72`); statements run acquirer under `Effect.scoped` (`Statement.ts:1314`); `makeWithTransaction` provides its own scope to the transactionAcquirer and closes it at tx end (line 284); `client.reserve` = transactionAcquirer (line 177) |
| effect-smol `Scope.ts:251` | `Scope.make()` returns a detached `Closeable` — no ambient attachment; sqlite sibling reads the AMBIENT scope instead (`sqlite.bun.ts:123-130`) |
| **Runtime probe (scratch `postgres:17-alpine`, port 56716)** | ONE layer, POOL_MAX=8, 12 trivial `SELECT`s: statements 1-8 OK (27-91ms), statement 9 stalled → 30s watchdog. **Leak runtime-proven.** Container removed (`containers_remaining: 0`) |
| `bun typecheck` (packages/core, `nice -n 10`) | exit 0 (tsgo --noEmit) |
| `packages/core/test/database-pg.test.ts` (66-line as-read state) | 3 tests, each early-returns without `TEST_DATABASE_URL` (FM-18); each `run()` builds a FRESH layer — which is exactly why the leak is invisible to the suite |
| `TEST_DATABASE_URL=… bun test test/database-pg.test.ts` | 0 pass / 7 fail (5000ms timeouts) — file on disk is the Step 3 mid-flight rewrite (journal/race tests), NOT the 3-test version read; failures belong to Step 3's in-flight state, out of scope |
| `migration.pg.ts` post-16:10 grep (contract check only) | lock still via `client.reserve` (line 87) + `pg_advisory_lock` on reserved conn (88), single BEGIN/COMMIT tx (103/106), artifact must not contain BEGIN/COMMIT (98) — PART 6 runner contract intact at seam |
| postgres-js 3.4.7 types (`node_modules/.bun/postgres@3.4.7/.../types/index.d.ts`) | no top-level `options` (libpq startup params) or `onconnect` key in `Options` — GUC fix must ride per-connection `SET` (or URL `?options=`, unverified) |

## 8.2 — Schema parity vs PART 2/PART 3 (amended, B6)

Per-table result (column-by-column vs the signed matrix; DDL truth = blessed `.opencode/db-migrations/0000_init.sql`, live-verified in PART 6):

| table | verdict | notes |
|---|---|---|
| event_sequence | **PASS** | text PK, bigint seq, owner_id (`event/sql.pg.ts:4-8`) |
| event | **PASS** | PK (aggregate_id, seq) + UNIQUE (aggregate_id, id) + (aggregate_id, type, seq) on parent (`event/sql.pg.ts:28-32`); Memo #4 deviation documented in-file (lines 10-16) |
| session | **PASS** | all 30 cols incl. bigint tokens, double precision cost, jsonb set (`session/sql.pg.ts:33-77`) |
| message / part / todo | **PASS** | todo_session_idx correctly ABSENT with matrix-citing comment (`session/sql.pg.ts:125-126`) |
| session_message | **PASS** | 4 indexes incl. both uniques; see ASC note below |
| session_input | **PASS** | partial index predicate EXACT `(session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL` (`session/sql.pg.ts:170-172`); both unique backstops (173-174) |
| session_context_epoch / session_share | **PASS** | exact |
| project / project_directory / workspace / account / account_state / control_account / credential / permission | **PASS** | sandboxes → `absoluteArrayColumn` → **jsonb** (`path.pg.ts:87`); booleans where signed; composite PKs; FK cascade graph identical |
| data_migration | **PASS (absent)** | correctly NOT materialized (B6.1) |
| session_projection_checkpoint | **GAP** | exists in blessed DDL; **no PG table object / no SchemaTables entry** — needed by Step 5 (flush pool + gauge). Non-blocking → Condition 4 |

Representation-level notes (query surface only — the runner executes the blessed artifact, not drizzle DDL):
- **ASC vs DESC**: drizzle indexes `message_session_time_created_id_idx` + `session_message_session_time_created_id_idx` are plain ASC (`session/sql.pg.ts:90,145`); signed DDL/blessed artifact say `DESC, DESC`. Btree backward scan makes them service-equivalent; artifact governs. Noted, no action.
- **`$default(false)` vs `DEFAULT false`** on `control_account.active` (`account/sql.pg.ts:33-35`): app-side default only in drizzle; blessed DDL carries the server-side default. Harmless (drizzle omits column on insert → server default fires). Noted, no action.
- **Timestamps helper** (`schema.sql.pg.ts`): timestamptz, `mode: "date"`, app-side `$default`/`$onUpdate`, NO server default — exactly the matrix rule.

**Storage-parameter + partition ruling (requested):** drizzle-orm cannot express `PARTITION BY`, fillfactor=80, per-partition autovacuum, or the extension DO block; the siblings omit them BY DESIGN and the runner executes the blessed artifact — **ACCEPTABLE**. The `event` table objects map to the PARENT; consumers emit only DML against the parent and PG routes to partitions (no runtime DDL emission path exists). Conditions 6 guards the regeneration hazard: any `drizzle-kit generate`-produced 0000 would silently drop partitions/fillfactor/autovacuum — statement-equivalence diff against the blessed artifact is mandatory (Memo #7 Condition 1 discipline), and `drizzle-kit push` is banned outright (Step 7 lint).

## 8.3 — BLOCKING: pg.bun.ts acquirers leak every reserved connection

`acquirer` (`pg.bun.ts:137-143`) runs `native.reserve()` and returns a connection over it with **no release anywhere**. Per the SqlClient contract, every non-transactional statement executes the acquirer under `Effect.scoped` (`Statement.ts:1314`) — each statement permanently holds one pool connection. `transactionAcquirer` (`pg.bun.ts:145-157`) adds `reserved.release()` as a finalizer on its own detached `Scope.make()` (line 147) — `makeWithTransaction` closes the scope IT provided (`SqlClient.ts:159-160,284`), not this one, so the finalizer never runs: every transaction and every `client.reserve` (incl. the migration seam) leaks one connection.

**Runtime proof:** single layer, `max=8` (the default, `pg.bun.ts:184`), 12 sequential `SELECT 1`-class statements → statements 1-8 pass, statement 9 stalls >30s (watchdog). A server process deadlocks on its 9th DB statement. The per-test fresh-layer construction in `database-pg.test.ts` is why the suite never sees it.

**Remediation OPTIONS:**
- **A. acquirer returns the pooled base connection (`Effect.succeed(connection)`, mirroring `sqlite.bun.ts:122`); transactionAcquirer reserves and adds the release finalizer to the AMBIENT scope (`sqlite.bun.ts:123-130` pattern).** CHOSEN — postgres-js pools simple statements internally; reservation is only required where connection pinning is semantic (transactions, `client.reserve`, future LISTEN).
- **B. Both acquirers reserve + release per acquisition (`Effect.acquireRelease` shape).** Correct but checkout-churns the pool on every statement for zero benefit. Acceptable fallback.
- **C. Status quo.** REJECTED — proven deadlock.

## 8.4 — SET statement timeouts: one-shot pooled SET is illusory

`database.ts` pgLayerInit runs `client.unsafe("SET statement_timeout = 30000")` + idle_in_transaction_session_timeout on the shared client. Session-scoped GUCs land on ONE pooled connection (after §3's fix: one per-statement checkout, then returned) — the rest of the pool runs untimed. Plan Step 2's "SET statement timeouts instead of PRAGMAs" requires per-connection application: emit the two SETs in `makeConnection(reserved)` (and for option A, once per pooled connection via a lazy flag), or startup parameters. Condition 2.

## 8.5 — Dual dispatch + dialect erasure rulings

- **SQLite untouched: VERIFIED** (§8.1). Zero diff outside `database.ts`; its SQLite branch is structurally identical.
- **`pgDb as unknown as DatabaseShape` + layer cast: type-level only, ACCEPTED.** The erasure sits at the service boundary; risk is not the cast but which TABLE objects consumers pair with the client — governed by the `Database.Schema` seam. Today the seam provides the SQLITE namespace on BOTH branches (`database.ts` sqliteSchemaLayer) with zero consumers (grep: only the three seam files reference it) — inert but a loaded footgun (FM-21). The `SchemaTables` type being declared in SQLite types (`schema.pg.ts:27-46`) forces a cast for the future PG namespace — acceptable seam; PG namespace must satisfy the same field set.

## 8.6 — Migration seam (contract check only)

As-read (pre-16:10) version: lock via `client.reserve` ✓, single BEGIN/COMMIT on the reserved conn ✓, probe `information_schema … table_name = 'session'` with `current_schema()` ✓ (Memo #8 §7.3 #6). Defects noted for the Step 3 review (NOT adjudicated here): (i) failure-path ROLLBACK is an un-executed Effect (`Effect.try({ try: () => conn.executeRaw("ROLLBACK") })` returns the effect as a value — no-op); fatal-path-only today; (ii) `Bun.file` breaks the `#pg` node map story; (iii) runtime reads `.opencode/db-migrations/0000_init.sql` — packaging hazard for containers; (iv) no journal. The 16:10 Step 3 rewrite keeps the contract essentials (grep: reserve/lock/BEGIN/COMMIT/artifact-purity all present).

## 8.7 — Test coverage verdict

The 3 as-read tests prove what they claim at the claimed level — bridge boot (SELECT 1), raw round-trip, and bootstrap-executes-with-16-partitions (the multi-statement simple-protocol path through postgres-js). They do NOT prove: probe no-op idempotence, advisory-lock mutual exclusion, or pool reuse (fresh layer per test masks §3). Step 3's in-flight rewrite is adding journal + concurrent-race tests (currently failing mid-flight — out of scope). Condition 1 converts the leak probe into the missing regression test; Condition 8 extends FM-18.

## 8.8 — Decision memo

```
DECISION MEMO #9 — STEP 2 REVIEW: PG SCHEMA SIBLINGS + DATABASE LAYER + DUAL DISPATCH
STATUS: REJECTED
TRIGGER: d | a (dual-backend dispatch lands; blessed DDL's query-surface mapping lands)
VERDICT: REJECT
```

**OPTIONS** — adjudicated at §8.2 (storage params/partitions: query-surface-only CHOSEN vs drizzle-generates REJECTED), §8.3 (remediation A/B/C), §8.5 (erasure accepted vs rejected typed-fork).

**INVARIANTS**
- event `(aggregate_id, seq)` unique per partition; ordering intact; replay index per-partition equivalent — **pass** (schema surface exact; live-verified PART 6 step 4).
- session_input partial pending index exact shape + `promoted_seq IS NULL` predicate (app-side, `input.ts`) + both unique backstops — **pass** (`session/sql.pg.ts:166-175`).
- session_message history pagination index `(session_id, time_created DESC, id DESC)` — **pass in artifact**; drizzle representation ASC (equivalent, noted).
- NOTIFY listener tiny payloads / reconnect — N/A this diff (Step 5).
- Migration apply via `pg_advisory_lock(727274)` through `client.reserve` — **pass at seam** (contract intact incl. post-16:10 rewrite); formal runner review next round.
- Pool lifecycle (`decision #12` surface) — **FAIL**: proven per-statement/per-transaction connection leak (§8.3). THE REJECT DRIVER.

**DURABLE-vs-DERIVED:** untouched — no schema semantics changed; layer plumbing only. The leak halts availability; it cannot corrupt the durable line (no partial writes — statements simply stop).

**FAILURE-MODES-UPDATED:** yes — FM-19, FM-20, FM-21 added; FM-18 scope extended to the core PG suite (PART 4 table updated this session).

**CONDITIONS**
1. **(BLOCKING)** Rewrite `pg.bun.ts` acquirers per §8.3 Option A (or B); add the regression test: ONE layer, > poolMax statements AND > poolMax transactions must complete (this session's probe becomes that test).
2. Apply `statement_timeout`/`idle_in_transaction_session_timeout` per connection (all pooled connections), not one-shot on the shared client; remove/replace the SETs in `database.ts` pgLayerInit.
3. No consumer adopts `Database.Schema` until the PG namespace exists and the PG branch provides it; add to the Step 7 grep-guard (FM-21).
4. Add `session_projection_checkpoint` PG table object + SchemaTables entry before Step 5 (flush pool + gauge consumers).
5. Wire the decision #12 pool-sizing call site (`max ≈ min(1.5× sessions, 12)`) at Step 5 integration; default-8 interim documented.
6. Shipped 0000_init remains statement-equivalent to the blessed artifact (Memo #7 Condition 1); ban `drizzle-kit push` in Step 7 lint; regeneration may never silently drop partitions/fillfactor/autovacuum.
7. Carry-over to the Step 3 review: failure-path ROLLBACK no-op fix, `Bun.file`/node-map asymmetry, `.opencode/` runtime artifact path packaging, journal-less-bootstrapped-DB handling.
8. CI: `TEST_DATABASE_URL` required for the core PG suite; 0-test run = failure (FM-18 extension).

**UNVERIFIED**
1. UNVERIFIED: postgres-js URL `?options=-c statement_timeout=…` startup-parameter passthrough — cheapest resolve: reserved connection + `SHOW statement_timeout` probe; only if the implementer picks that fix path (per-connection SET needs no verification).
2. UNVERIFIED: whether postgres-js reclaims unreleased reservations via GC eventually — did not manifest within the 30s probe window; moot after Condition 1.
3. UNVERIFIED: Step 3 `migration.pg.ts`/`drizzle.config.ts` internals (mid-flight during this review; files changed at 16:10/16:12) — next-round review owns them.

**ORACLE-COUNTER-SIGN:** not-required — DB-domain rejection on a runtime-proven defect; no baseline change, no V2 semantics. Visibility note: `postgres@3.4.7` runtime dep (`packages/core/package.json`) is the locked decision #1 driver, pin noted for Oracle's Step 9 pass.

**Effort:** Short — acquirer rewrite ≈15 lines mirroring `sqlite.bun.ts:123-130`, timeout placement, one regression test; schema surface, dispatch, and seam require zero rework.

**VERDICT: REJECT**
---

# PART 9 — MID-FLIGHT REVIEW #3: STEP 2 REWORK VERIFICATION + STEP 3 MIGRATION RUNNER FORMAL REVIEW

Session 4 (Athena, Memo #10). Re-review of the Step 2 rework against Memo #9 Conditions 1-4 + 7 (5/6/8 deferred per scoping), plus first formal review of `migration.pg.ts` + its tests. Methodology per §8.3: static read against effect-smol source, `nice -n 10 bun typecheck` (packages/core: CLEAN; packages/effect-drizzle-pg spot-check: CLEAN — LSP diagnostics in that package are indexer noise), full PG suite on ephemeral docker postgres:17 (10/10 pass, container removed), plus two adversarial probes.

## 9.1 — Condition-by-condition verification (Memo #9)

**Cond 1 — acquirer leak (THE REJECT DRIVER): PASS, verdict flips.**
- `pg.bun.ts:188` acquirer = `Effect.succeed(connection)` where `connection = makeConnection(null)` (`:139`) routes through `native.unsafe` — postgres-js pools simple statements internally. Nothing reserved ⇒ nothing leaked. `Statement.ts:1318` runs the acquirer under `Effect.scoped`; succeed closes instantly.
- `pg.bun.ts:201-214` transactionAcquirer mirrors `sqlite.bun.ts:123-130` exactly: uninterruptibleMask → `Fiber.getCurrent()!` → `Context.getUnsafe(fiber.context, Scope.Scope)` (AMBIENT scope) → `restore(reserve)` → `addFinalizer(release)` → `makeReservedConnection`. Order reserve→finalizer→SETs means a failed SET still releases.
- **Contract verified at effect-smol source (this session, not from memory):** `SqlClient.make` builds `acquireConnection: Effect.flatMap(Scope.make(), (scope) => Effect.map(Scope.provide(transactionAcquirer!, scope), …))` and the tx finalizer region runs `Effect.ensuring(effect, Scope.close(scope, exit))` after commit/rollback; `reserve: transactionAcquirer` (SqlClient.ts:161-165, 275-284, 177 in the current tree — Memo #9's cited 159-160/284 lines are the same contract). `Scope.provide` puts the scope in fiber context, so the ambient read inside the acquirer lands on exactly the scope makeWithTransaction closes. My §8.3 evidence CONFIRMED.
- Remaining leak paths audited: none. `client.reserve` = transactionAcquirer (same wiring); migration seam rides it; `executeStream` dies; export/loadExtension are sqlite-only.
- **Empirical:** 10/10 tests on live PG 17. Pool-lifecycle block (`test/database-pg.test.ts:223-288`): ONE layer at `maxConnections: 2`; 7 sequential statements (old code stalls at #3), 5 sequential `withTransaction` (old: #3), concurrent tx pair + follow-up statement (old: follow-up stalls), all under `Effect.timeout("30 seconds")` fail-fast with per-statement value assertions. Assertions are real, not cosmetic. Reserve-path leak covered by structural identity (reserve === transactionAcquirer). FM-19 CLOSED.

**Cond 2 — per-connection timeouts: PASS with a ruling on the pooled gap.**
- One-shot SETs removed from `database.ts` pgLayerInit (no `client.unsafe("SET…")` remains; comment at `database.ts:65-71`).
- `makeReservedConnection` (`pg.bun.ts:155-173`) SETs `statement_timeout` + `idle_in_transaction_session_timeout` on EVERY reserved connection, re-SET per reserve (idempotent).
- **RULING on pooled (non-reserved) statements riding un-SET connections:** acceptable as interim. `idle_in_transaction_session_timeout` only has meaning on transaction connections — which ARE reserved. `statement_timeout` on the pooled path guards against pathological plans on read-mostly short statements; the hot queries are indexed (PART 2). However — UNVERIFIED #1 from Memo #9 is now RESOLVED AFFIRMATIVELY by live probe: postgres-js URL passthrough `?options=-c%20statement_timeout=1234` → `SHOW statement_timeout` = `1234ms` on a fresh pooled connection. The complete fix is one URL segment and covers pooled + reserved. → Condition 4 (Step 5 wiring, alongside deferred Cond 5 pool sizing). REJECTED alternatives: lazy per-pooled-connection SET flag (structurally impossible under Option A — postgres-js hides pooled connections); accepting the gap permanently (unnecessary now that passthrough is verified).

**Cond 3 — PG namespace: PASS.**
- `schema-pg-namespace.ts:39-59` assembles exactly the 18 common tables + `SessionProjectionCheckpointTable`, field-by-field identical to `SchemaTables` (`schema.pg.ts:36-59`); sources are the 8 `*.sql.pg.ts` siblings (all present: event, session, project, account, credential, permission, share, control-plane/workspace).
- `as unknown as` census: PG namespace cast confined to `schema-pg-namespace.ts:61`; remaining casts are the pre-accepted §8.5 erasures (`database.ts:77,98,105`) and postgres-js thenable→Promise shims at the driver boundary (`pg.bun.ts:91,99,162,169`). No `as any`.
- `database.ts:87-88,93-98`: PG branch provides PG namespace, SQLite branch untouched. SQLite namespace (18 fields, no data_migration, no checkpoint) typechecks natively. Zero consumers of `Database.Schema` outside the three seam files (grep) — FM-21 defused at the seam; Step 7 grep-guard remains owed (standing half of Cond 3).

**Cond 4 — checkpoint table: PASS.**
- `session/sql.pg.ts:194-201` vs PART 2:981-985: `session_id` text PK `REFERENCES session(id) ON DELETE CASCADE`, `applied_seq bigint NOT NULL`, `time_updated timestamptz NOT NULL`. Exact. SchemaTables entry optional (`schema.pg.ts:55-58`), PG namespace provides it. Hot-path re-check while in the file: `session_input` partial pending index + both unique backstops intact (`sql.pg.ts:166-175`); `session_message` history pagination index intact (`:145`).

**Cond 7 — migration runner carry-overs: SPLIT. node:fs PASS; ROLLBACK FAIL (blocking).**
- `readFile`/`readdir` from `node:fs/promises` (`migration.pg.ts:34,66-79,186-189`) — both runtimes; `#pg` node map re-exports the shared `pg.bun.ts` (`pg.node.ts:1-3`). Bun.file asymmetry closed.
- **ROLLBACK is STILL a no-op, in a new disguise.** `migration.pg.ts:120-122`: `Effect.orDie(Effect.try({ try: () => conn.executeRaw("ROLLBACK", []), … }))`. effect-smol's `try_` = `suspend(() => { try { return succeed(internalCall(evaluate)) } catch … })` (internal/effect.ts:976-992) — the callback's RETURN VALUE becomes the success. `conn.executeRaw` returns a lazy Effect; `Effect.try` succeeds with that unexecuted effect and discards it. The type system cannot see this (an Effect is a legal `A`). **Runtime proof (§9.4):** failed 0001 on a max=1 layer → follow-up SELECT on the SAME layer fails `PostgresError: current transaction is aborted, commands ignored until end of transaction block` (25P02) — the reserved connection was released back to the pool poisoned. Today's only caller is boot (`Effect.orDie` → process exits, so poisoning is masked); Step 6 `opencode db migrate` makes it a live availability defect. → Condition 1 (BLOCKING). Remedy CHOSEN: `yield* Effect.ignore(conn.executeRaw("ROLLBACK", []))` (FM-17 warning-only semantics); REJECTED: `Effect.orDie(…)` on the rollback (turns benign already-aborted cases into defects); status quo (proven poisoning).

## 9.2 — Step 3 migration runner: formal review (Duty 1 + decision #7 contract)

Contract items, in order:
- **Journal shape:** `CREATE TABLE IF NOT EXISTS "migration" (id text PRIMARY KEY, time_completed timestamptz NOT NULL)` (`migration.pg.ts:132`) = PART 2:1119-1120. Runner-owned: journal appears in 0000_init.sql ONLY as a comment (line 343); no journal DDL in the blessed file. Inserts use `now()` + `ON CONFLICT DO NOTHING` (`:160-161`). PASS.
- **0000_init purity:** the `BEGIN` at file line 27 is the plpgsql `DO $$ … END $$` pg_stat_statements guard, not transaction control; header contract (no BEGIN/COMMIT, no advisory lock) intact. PASS. Note: the directory is UNTRACKED in git (`?? .opencode/db-migrations/`) → Condition 7 (commit unchanged; Memo #7 Condition 1 byte-identity governs).
- **Advisory lock via client.reserve + finalizer:** `withAdvisoryLock` (`:85-99`) — `Effect.scoped`, lock on the reserved connection, unlock in finalizer. Registration order (reserve's release first, unlock second) ⇒ LIFO close runs unlock BEFORE release — correct, the unlock rides a live connection. Never a pooled checkout. PASS.
- **Probe-under-lock ordering (race safety):** probe runs OUTSIDE the lock (`apply:217`). Race-safe by construction: (i) 0000_init is IF-NOT-EXISTS-idempotent (blessed, PART 6-verified re-executability) so a loser re-applies harmlessly; (ii) journal dedup via ON CONFLICT; (iii) the path that matters for future NON-idempotent numbered migrations — replay — reads the journal INSIDE the lock (`applyOnly:201-204`). OPTIONS: probe-outside-lock + idempotent bootstrap (CHOSEN) vs probe-under-lock (REJECTED: serializes every already-migrated boot behind the lock for zero correctness gain). PASS with semantics documented: "exactly one applies" is really "one effective apply + idempotent re-execution + exactly-one journal row".
- **Single transaction per apply:** bootstrap wraps all of 0000_init in one BEGIN/COMMIT (`executeScriptTx:112-117`); numbered = one tx each. PASS on the DDL side. **FAIL on journal atomicity:** `journalInsert` runs AFTER the tx commits (`:190-192`, `:207-208`), while the declared shape reference — SQLite `migration.ts` — journals INSIDE the transaction in BOTH paths (`migration.ts:26-38` bootstrap creates journal + inserts all ids in the schema tx; `:71-78` numbered inserts the journal row inside the per-migration tx). Crash window: numbered migration committed, journal row lost → re-applied next boot → non-idempotent migration corrupts. Not live today (no numbered migrations ship), but this is the only guard for future ones. → Condition 2 (BLOCKING). OPTIONS: journal-in-tx (CHOSEN — SQLite parity, transactional DDL makes it trivial); keep-outside + mandate idempotent numbered migrations (REJECTED — unenforceable); journal-less probe-only (REJECTED — loses `db migrate` reporting).
- **Numbered loading order:** lexical sort, `0000*` excluded (`:70-71`). PASS.
- **Journal-less-bootstrapped-DB (old seam):** session exists → replay → `ensureJournalTable` creates journal if missing → 0000_init is never in the numbered list → never re-applied; missing 0000 journal row is cosmetic (the probe, not the journal, is the bootstrap marker). HANDLED CORRECTLY.
- **`.opencode/` runtime-path packaging (FM-23):** `migrationsDir()` resolves via `import.meta.url` (`:44-47`) — correct in dev; a published/bundled layout will not contain the dir → ENOENT boot death. OPTIONS: runtime read + Step 8 COPY (CHOSEN — preserves the blessed file as the byte-identical single source); build-time embed/codegen (REJECTED — creates a second copy, drift risk against Memo #7 Condition 1); inline TS string constant (REJECTED — same drift, hand-editable). → Condition 5: COPY + dir-exists precheck with actionable error.
- **Dead try/catch trio:** `ensureJournalTable`/`readJournal`/`journalInsert` (`:130-137,144-148,158-165`) wrap `yield*` in JS try/catch — Effect failures are not JS throws, the catches are dead code; failures DO propagate (as SqlError, which is why the `Error` annotations typecheck — v4 tagged errors extend Error). Same anti-pattern class Memo #9 flagged. → Condition 3 (cleanup, same PR).

## 9.3 — Tests scrutinized

- Pool-lifecycle block: strong (§9.1 Cond 1) — one layer, small pool, value assertions, fail-fast timeouts. One structural note: no explicit >poolMax `client.reserve` test; covered by identity (reserve === transactionAcquirer, proven released via the tx tests) — acceptable, not condition-worthy.
- Runner tests (`test/database-pg.test.ts:103-214`): fresh-boot+journal, second-boot no-op (replay path with zero numbered → early return, journal intact), fake numbered migration applied+journaled, concurrent race → journal exactly 1 row + session present. Race test proves the guaranteed invariant (journal dedup + schema presence); it cannot and need not prove single-execution given idempotent-by-design bootstrap. Adequate.
- Findings: (i) tests write `0001_test_marker.sql` INTO the blessed directory (`:29-35,158-159`) with finally-rm — parallel runs/hard kills can leak a fixture that a later real boot would apply; make the migrations dir injectable (Condition 6). (ii) `resetSchema` drops schema public CASCADE — the CI note under FM-18 must say TEST_DATABASE_URL points at a DISPOSABLE database. (iii) per-test early-return without the env var remains (FM-18 standing, Step 7).

## 9.4 — Probe evidence (this session, ephemeral postgres:17, cleaned up)

| # | Probe | Result |
|---|---|---|
| P0 | Full `bun test test/database-pg.test.ts` vs TEST_DATABASE_URL | 10/10 pass, 4.39s |
| P1 | `postgres(url + "?options=-c%20statement_timeout=1234")` → `SHOW statement_timeout` | `1234ms` — URL startup-param passthrough WORKS (UNVERIFIED #1 resolved) |
| P2 | bad 0001 (stmt 1 ok, stmt 2 syntax error) via `apply` on max=1 layer → same-layer follow-up SELECT | apply fails as expected; follow-up fails **25P02 current transaction is aborted** — ROLLBACK not executed, connection released poisoned (FM-22 runtime-proven) |
| P3 | post-run catalog state | journal = {0000_init} only; pg_inherits(event) = 16; no fixture leftovers; container removed |

## 9.5 — Decision memo

```
DECISION MEMO #10 — STEP 2 REWORK VERIFICATION + STEP 3 MIGRATION RUNNER REVIEW
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: c (migration cut) | a (runner DDL surface: journal table) | d (dual-backend parity: namespace seam)
VERDICT: APPROVE-WITH-CONDITIONS

OPTIONS
- Cond 2 pooled timeouts: reserved-only SETs (interim CHOSEN) | URL ?options= startup params at Step 5 (CHOSEN complete fix, P1-verified) | lazy pooled-SET flag (REJECTED: impossible under Option A) | permanent gap (REJECTED).
- ROLLBACK remedy: Effect.ignore(executeRaw("ROLLBACK")) (CHOSEN, FM-17 semantics) | orDie the rollback (REJECTED) | status quo (REJECTED: 25P02 poisoning proven).
- Journal placement: inside apply tx, SQLite-reference parity (CHOSEN) | outside + idempotence mandate (REJECTED) | journal-less (REJECTED).
- Packaging: runtime read + Step 8 COPY (CHOSEN) | build-time embed (REJECTED: second-copy drift) | inline TS constant (REJECTED).

INVARIANTS
- Pool lifecycle (decision #12 surface; Memo #9 FAIL driver) — PASS: Option A verified statically against effect-smol SqlClient.ts:161-165/275-284/177 + Statement.ts:1318, and empirically (10/10; >poolMax statements/txs/concurrent pair on max=2).
- event (aggregate_id, seq) unique per partition; ordering; replay index — PASS (schema surface unchanged from Memo #9 pass; 16 partitions re-verified live post-suite, P3).
- session_input partial pending index + promoted_seq IS NULL predicate + both unique backstops — PASS (session/sql.pg.ts:166-175 re-read).
- session_message history pagination index — PASS (session/sql.pg.ts:145).
- Migration apply via pg_advisory_lock(727274) through client.reserve + finalizer, never pooled — PASS (migration.pg.ts:85-99; unlock-before-release order verified). Journal atomicity vs SQLite reference — FAIL → Condition 2. Failure-path ROLLBACK — FAIL → Condition 1.
- NOTIFY listener tiny payloads/reconnect — N/A (Step 5).

DURABLE-vs-DERIVED: untouched. Journal + checkpoint are runner/projection bookkeeping on the derived side; the event log remains the only truth; no consumer-side schema semantics changed.

FAILURE-MODES-UPDATED: yes — FM-19 RESOLVED, FM-20 PARTIAL, FM-21 SEAM-DEFUSED; FM-22 (poisoned pooled connection after failed migration script; runtime-proven) and FM-23 (packaged runtime missing db-migrations dir) added (PART 4 table updated this session).

CONDITIONS
1. (BLOCKING, Step 3 closure) migration.pg.ts executeScriptTx: replace the Effect.try-wrapped ROLLBACK with an actually-executed `yield* Effect.ignore(conn.executeRaw("ROLLBACK", []))`. Regression test: failed numbered migration on a max=1 layer → same-layer follow-up statement SUCCEEDS (no 25P02) and the failed migration is absent from the journal.
2. (BLOCKING, Step 3 closure) Move journalInsert INSIDE each apply transaction (pass the id into executeScriptTx; INSERT … ON CONFLICT DO NOTHING before COMMIT) for bootstrap and numbered paths — restores migration.ts:26-38/71-78 crash atomicity. ensureJournalTable may stay outside (idempotent).
3. (Same PR, non-blocking) Remove the dead JS try/catch wrappers in ensureJournalTable/readJournal/journalInsert; fix the stale header comment (migration.pg.ts:23-24 still says "via Bun.file").
4. (Step 5, with deferred Cond 5 pool sizing) Add P1-verified URL startup params (`-c statement_timeout=…`, `-c idle_in_transaction_session_timeout=…`) to the postgres-js config so pooled connections carry timeouts; reserved SETs remain belt-and-braces.
5. (Step 8) Dockerfile COPY .opencode/db-migrations to the resolved runtime path + dir-exists precheck with actionable error before readFile.
6. (Test hygiene, Step 5/6 when CLI migrate lands) Make the migrations directory injectable so runner tests stop writing fixtures into the blessed directory.
7. (Step 3 PR) Commit .opencode/db-migrations/0000_init.sql unchanged (currently untracked); Memo #7 Condition 1 byte-identity continues to govern.
Standing carry-overs unchanged: Cond 5 (pool sizing, Step 5), Cond 6 grep-guard/drizzle-kit push ban (Step 7), Cond 8 CI TEST_DATABASE_URL + 0-run=failure (Step 7; note: disposable database required — resetSchema drops schema public CASCADE).

UNVERIFIED
1. UNVERIFIED: whether the URL options mechanism applies idle_in_transaction_session_timeout identically (same startup-packet path as statement_timeout — near-certain) — cheapest resolve: rerun P1 with both params at Step 5 wiring.
2. UNVERIFIED: exact bundled-image path depth for migrationsDir() in the packaged runtime — cheapest resolve: Step 8 COPY + boot smoke (Condition 5).

ORACLE-COUNTER-SIGN: not-required — DB-domain conditions only; no baseline change, no new dependencies, no V2 semantics. Visibility: Step 2 verdict FLIPS from REJECT to APPROVED on runtime-verified evidence; Step 3 enters approved-with-conditions gated on Conditions 1-2 (one function, same effort class).

Effort: Short — two one-line-class edits + one regression test + comment cleanup.

**VERDICT: APPROVE-WITH-CONDITIONS**
```

---

DECISION MEMO #11 — STEP 3 CLOSURE (MEMO #10 COND 1-3) + STEP 4 CONSUMER REWIRE (SCHEMA NAMESPACE) REVIEW
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: c (Step 3 migration cut closure) | d (dual-backend parity: namespace seam adoption, 13 consumers)
VERDICT: APPROVE-WITH-CONDITIONS

SURFACE 1 — MEMO #10 COND 1-3 CLOSURE (all read this session; migration.pg.ts read in full, 210 lines)
- Cond 1 CLOSED — migration.pg.ts:129 `yield* Effect.ignore(conn.executeRaw("ROLLBACK", []))`: rollback EXECUTED via yield*, error ignored per the Memo #10 CHOSEN option (FM-17 warning-only semantics). Regression test read in full (packages/core/test/database-pg.test.ts:218-283) and its assertions match the Cond-1 spec, not just the name: max=1 layer (:230), apply failure asserted (:243-254), same-layer follow-up SELECT 1 succeeds (:256-263), failed id ABSENT from journal (:269-272), 0000_init row survives (:274-277). FM-22 → RESOLVED (PART 4 row updated this session).
- Cond 2 CLOSED — journal INSERT inside the apply transaction: migration.pg.ts:119-124 (journalId param, `INSERT INTO "migration" ... ON CONFLICT DO NOTHING` before COMMIT :125); bootstrap passes BOOTSTRAP_ID (:175), numbered path passes migration.id (:190). Crash between schema-apply and journal → uncommitted single tx aborts (process crash drops conn / error path takes :129) → next boot re-applies. Crash-atomicity parity with the SQLite reference (migration.ts:26-38/71-78) restored. ensureJournalTable stays outside the tx (bootstrap :174, applyOnly :186) as idempotent CREATE TABLE IF NOT EXISTS — per my Memo #10 ruling; residue (empty journal table surviving a failed bootstrap) is harmless: empty journal → re-bootstrap. The test's initJournal assert (:274-277) incidentally proves per-migration journal atomicity.
- Cond 3 CLOSED — zero JS try/catch in migration.pg.ts (full read); journalInsert dissolved into executeScriptTx as the journalId param; stale header replaced — :23-30 now documents node:fs/promises runtime loading and keeps the 0000_init.sql byte-identity mandate language. Early-return-on-success (:128) and cause-bearing failure label (:130) clean; no `else`.

SURFACE 2 — STEP 4 REWIRE (all 13 consumers + infra opened this session)
1. schema-node.ts (packages/core/src/schema-node.ts:1-14): module-scope `process.env.DATABASE_URL` (:7) selects the namespace; provides Database.Schema as a global node (:10-13). DB-domain finding: the dialect decision now lives in TWO places (database.ts:41 and schema-node.ts:7) AND the Schema service is provided twice in one layer graph (database.ts:93/97 inside resolvedLayer — whose Schema provision is invisible to dependents because database.ts:98 casts requirements away — and schema-node.ts:10 as the outward node consumers pull via deps). Values are identical today (same env, same process, both read at module scope); under any future dispatch divergence the winner becomes layer-composition-order-dependent → PG handle receiving SQLite table objects. → Condition 1 (single-source). The `namespace as unknown as InstanceType<...>` cast (:12) is redundant (both namespaces are already typed SchemaTables; database.ts:87-88 succeeds without it) — cosmetic, no action.
2. Rewire correctness — PASS. Service-yield style: session.ts:189, session/projector.ts:220, session/store.ts:33, session/todo.ts:31, credential.ts:56, permission/saved.ts:42, project/directories.ts:65, session/revert.ts:71. Schema-param style: event.ts:25/69 (latestSequence/readAggregate), session/input.ts:34+, session/context-epoch.ts:25+, session/history.ts. Grep (run this session): NO consumer imports runtime tables from ./session/sql, ./event/sql, ./project/sql, ./credential/sql, ./permission/sql, ./account/sql, ./share/sql — remaining static cross-refs are inside the sql.ts/sql.pg.ts definition files themselves (permission/sql.ts:4, share/sql.ts:2, session/sql.ts:3, control-plane/workspace.sql.ts:2 + PG siblings), which is the definition layer and correct. No consumer imports .pg.ts tables directly outside schema-pg-namespace.ts.
3. SQLite-ism greps (run this session) — claimed outcome CONFIRMED: json_extract ONLY in database/migration/20260510033149_session_usage.ts; AUTOINCREMENT ONLY in migration/20260603141458_session_input_inbox.ts (both historical, SQLite-fenced — migration.pg.ts reads only .opencode/db-migrations, never migration/); INSERT OR IGNORE / ON CONFLICT: none in runtime builders outside fences; PRAGMA: none outside database/ (SQLite branch, env-gated at database.ts:90-98).
4. drizzle.config.ts — git diff vs origin/dev is comment-only (verified). Comment states: drizzle-kit stays SQLite-only; PG truth = blessed .opencode/db-migrations/0000_init.sql executed by migration.pg.ts; wiring drizzle-kit PG generation would clobber generated SQLite artifacts. Matches my standing rule (Memo #9 Cond 6 grep-guard / drizzle-kit push ban; Memo #7 Cond 1 byte-identity).
5. Type-level leakage — ACCEPTABLE. info.ts:3/:14 (and input.ts:21, projector.ts:118, credential.ts:59) type rows as SchemaTables[...]["$inferSelect"] = SQLite row shapes; type-only, no runtime dialect effect; erasure accepted at Memo #9 §8.5. Runtime decode is cross-dialect safe where checked: DateTime.makeUnsafe accepts Date|number (effect-smol DateTime.ts:97 Input, :656 makeUnsafe), so PG mode:"date" rows and SQLite epoch-millis rows both decode. project/directories.ts:32 type-only EffectDrizzleSqlite handle = the decision #8 DatabaseShape convention.

INVARIANTS
- V2 durable admission/promotion semantics — PASS: input.ts rewire changed table-object source only; promotion UPDATE preserves isNull(promoted_seq) predicate (input.ts:145-151), pending scans keep the NULL predicate (:193-198). No runner/llm changes in the 13-file set.
- session_input partial pending index + admitted_seq + promoted_seq unique backstops — PASS, schema surface unchanged (session/sql.pg.ts:170-174 spot re-read).
- session_message history pagination index (session_id, time_created, id) — PASS (session/sql.pg.ts:145).
- event replay surface — PASS, unchanged (event/sql.pg.ts:30-31; carries Memo #10 P3 live verification; file untouched by Step 4).
- Migration apply: pg_advisory_lock(727274) via client.reserve + finalizer, never pooled — PASS (migration.pg.ts:85-99 unchanged; unlock-before-release preserved).

DURABLE-vs-DERIVED: untouched. The namespace seam changes only how derived-side consumers OBTAIN table objects; the event log remains the only truth; journal/checkpoint remain runner/projection bookkeeping.

FAILURE-MODES-UPDATED: yes — FM-22 marked RESOLVED (fix migration.pg.ts:129 + regression test database-pg.test.ts:218-283). No new FMs; H-1 below stays UNVERIFIED until demonstrated, then becomes an FM + trigger-(a) decision point.

OPTIONS
- Dialect dispatch duplication: accept duplicate env reads (REJECTED — double service provision makes drift composition-order-dependent) | single-source the decision from database.ts into schema-node.ts (CHOSEN — no cycle: database.ts does not import schema-node.ts) | fold Schema provision fully into database.ts and delete schema-node.ts (REJECTED for now — database.ts:98 erases the Schema requirement from dependents; restructuring the node is Step 5-scale churn).
- Namespace star imports (`import * as DatabaseSchema` in schema-node.ts:2-4, event.ts:9, session.ts:16, projector.ts:6, todo.ts:7, credential.ts:8, saved.ts:6, directories.ts:6, store.ts:6, revert.ts:6): block on AGENTS.md star-import ban (REJECTED — style is review-order last; zero DB-domain risk: namespace import of a leaf module, no cycles) | ignore (REJECTED — the ban is explicit) | Oracle style ruling: bless namespace-star for service seams repo-wide OR self-export conversion pass (CHOSEN → Condition 3). Precedent note: approved files already use the pattern (database.ts:7/16, project/sql.ts, fs-util.ts).
- Cond 1/2 implementation shapes: verified against the Memo #10 CHOSEN options verbatim — no re-adjudication.

CONDITIONS
1. (BLOCKING for Step 5 start, non-blocking for Step 4 merge) Single-source the dialect decision: export the module-scope DATABASE_URL resolution (database.ts:41) and consume it in schema-node.ts:7. Effort: Quick.
2. (BLOCKING for the Step 3 PR merge — Memo #10 Cond 7 carry-over, still open) Commit .opencode/db-migrations/0000_init.sql unchanged — `git status` shows the directory untracked this session. Memo #7 Cond 1 byte-identity continues to govern.
3. (Oracle style ruling, non-blocking for DB domain) Rule on namespace star imports per the OPTIONS above; if conversion: add a self-export to database/schema.pg.ts and switch the 10 consumer files to named imports.

UNVERIFIED
1. UNVERIFIED (H-1, Step 5 first verification item): epoch-millis NUMBERS written to PG timestamp({mode:"date"}) columns — session/input.ts:177 and projector.ts:126 pass DateTime.toEpochMillis(...) into time_created (PG def session/sql.pg.ts:162 mode:"date"); drizzle pg mode:"date" driver mapping expects a Date, so PG-path writes may throw at driver mapping. Pre-existing value plumbing (NOT a Step 4 regression — the rewire changed table-object source only), but it is the first concrete instance of the accepted type-erasure seam. Cheapest resolve: Step 5 PG session round-trip smoke (admit input → project → read history). If it fails, the fix touches sql.pg.ts column modes = trigger (a) → new decision memo required.
2. UNVERIFIED: PG session row round-trips generally — the 11 green PG tests cover runner/pool, not session CRUD (database-pg.test.ts:52-359). Same smoke as U-1 resolves this.
3. UNVERIFIED: double Schema provision precedence under drift — mooted by Condition 1; cheapest resolve is landing it.

ORACLE-COUNTER-SIGN: required — Condition 3 style ruling on namespace star imports (repo-wide convention, outside DB domain). All other conditions are DB-domain.

CLOSURE STATEMENT: Memo #10 Conditions 1-3 are SATISFIED in code → Step 3 code closure CONFIRMED (PR-level closure pending Condition 2 commit). Step 4 DB-domain review = APPROVE-WITH-CONDITIONS → orchestrator may advance to Step 4.5/5, gated on Condition 1 before Step 5 wiring and H-1/U-1/U-2 smoke as Step 5's first verification items.

Effort: Quick — Cond 1 is a one-file edit; Cond 2 is a git add; Cond 3 is a ruling plus an optional mechanical pass.

**VERDICT: APPROVE-WITH-CONDITIONS**

---

# PART 10 — H-1 ADJUDICATION (TIMESTAMP + BIGINT SEAMS) + B4/B5 LANDING REVIEW

Session 6 (Athena, Memo #12). Trigger (a): schema-surface divergence empirically resolved against the current shape. Every file:line below opened this session. RC2 internals verified directly in the resolved copy: `node_modules/.bun/drizzle-orm@1.0.0-rc.2+7ebb973cd090d7db/node_modules/drizzle-orm/` (hereafter "RC2 <file>").

## 10.1 — Evidence base

| Source | What it established |
|---|---|
| `packages/core/test/session-pg-roundtrip.test.ts:1-488` | H-1 smoke: 4 H-1 tests (sessionRow numbers :273-289, projectAdmitted :344-351, insertMessage/updateMessage :410-465) + control (Date writes round-trip; bigint typeof-number assert :225-229; `SessionInput.find` decode :233-245); gated on `TEST_DATABASE_URL` (FM-18 class) |
| RC2 `pg-core/columns/timestamp.cjs` | `PgTimestamp.mapToDriverValue = (value) => { if (typeof value === "string") return value; return value.toISOString() }` — a NUMBER throws. No `mapFromDriverValue` override: reads rely on the driver's own Date parsing |
| RC2 `pg-core/columns/bigint.cjs` | `PgBigInt53` (mode:"number") defines NO `mapFromDriverValue`; carries `codec = "bigint:number"` only |
| RC2 `column.cjs:6-7,60` + `pg-core/columns/common.cjs:176-186` | base `Column.mapFromDriverValue = noop` (`noop.isNoop = true`); the only wrapper is array-dimensions recursion |
| RC2 `pg-core/codecs.cjs` | codec registry: `"bigint:number": { normalize: Number, ... }` — where mode:"number" decode actually lives |
| RC2 `utils.cjs` (`mapResultRow`, `orderSelectedFields(fields, pathPrefix, codecs)`, `makeJitQueryMapper`) | RC2 decode pipeline: `decoder.mapFromDriverValue(codec ? codec(rawValue, arrayDimensions) : rawValue)`; `orderSelectedFields` attaches `codec: codecs?.get(field, "normalize")`, `arrayDimensions: field.dimensions` for Column entries; both fns + `makeJitQueryMapper` are ESM-exported (utils.js export list) |
| RC2 `codecs.cjs` (`CodecsCollection`) + `effect-postgres/codecs.cjs` (`exports.effectPgCodecs`) | the registry object shape (`get(column, type)` → `codecs[column.codec]?.[dimension-adjusted key]`) and upstream's own effect-pg codec set |
| `packages/effect-drizzle-pg/src/internal/drizzle-utils.ts:38-50, 64-115` | **THE PORT DIVERGENCE**: local `orderSelectedFields` has no `codecs` param (entries are `{path, field}` only); local `mapResultRow` calls `mapFromDriverValue(rawValue)` with no codec step |
| `packages/effect-drizzle-pg/src/pg-core/effect/select.ts:259`, `insert.ts:256`, `update.ts:316`, `delete.ts:175` | the four `orderSelectedFields` call sites (select fields + `.returning()` fields on insert/update/delete) — all codec-blind |
| `packages/effect-drizzle-pg/src/effect-pg/driver.ts:61` | `useJitMappers: jitCompatCheck(config.jit)` — JIT ON by default; the JIT path (`makeJitQueryMapper`, session.ts:172-176) is codec-blind too because the ENTRIES lack codec (the mapper itself handles codec correctly) |
| `packages/core/src/database/schema.sql.pg.ts:6-13` vs `schema.sql.ts:3-10` | root asymmetry: PG helper = `timestamp({withTimezone:true, mode:"date"})` + `$default(() => new Date())`; SQLite helper = `integer()` epoch-millis + `$default(() => Date.now())`. Consumers pass numbers (SQLite-native contract, verified: projector.ts:72-75, :174, :257, :288, :311, :324-330, :384, :406, :415, :473, :482, :520; input.ts:120, :177) |
| Timestamp switch surface (grep this session) | `schema.sql.pg.ts:7,10`; `session/sql.pg.ts:69,70,162-164,200`; `account/sql.pg.ts:12,32`; `project/sql.pg.ts:13-19,34`; `control-plane/workspace.sql.pg.ts:17`. Spread sites (`...Timestamps`): session/sql.pg.ts:68,87,102,122,139; account:13,36; credential:13; permission:17; share:12 |
| `packages/core/src/session/context-epoch.ts` (full read), `session.ts:217-226`, `projector.ts` (full read), `session/input.ts:21-28,91-120,156,177` | B4/B5 landed shapes + fromRow decode sites (admitted_seq string breaks the decode → root cause is FM-25, not the Schema) |
| `packages/core/test/session-projector.test.ts` (read + **run this session**: 12/12 pass, 1.85s, SQLite dialect) | B4.1 race test :751-791 (loser insert returns WINNER's baseline_seq 100), B4.2 guard tests :795-835 (stale 25 → stored 40 kept; fresh 50 applied), B5.1 tests :579 (consolidated delta + summed removal), :671 (cross-session split) |
| `packages/core/src/database/path.pg.ts:27-96` | the `customType` precedent (absoluteColumn/directoryColumn/pathColumn/absoluteArrayColumn) — T-A is the established in-repo pattern, not a new mechanism |

## 10.2 — Decision memo

```
DECISION MEMO #12 — H-1 FIX SHAPES: EPOCH-MILLIS TIMESTAMP COLUMNS (T-A) + BRIDGE CODEC PARITY (B-A); B4/B5 LANDING
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: a (schema-surface divergence: JS-side column value contract) | B4/B5 landing review (Step 5)
VERDICT: APPROVE-WITH-CONDITIONS
```

### SURFACE A — H-1: the timestamp seam (VERDICT(A): APPROVE — T-A)

**Diagnosis (runtime-proven, broader than Memo #11 flagged):** every rewired consumer write passes epoch-millis NUMBERS into `timestamp({mode:"date"})` columns; RC2's `mapToDriverValue` calls `toISOString()` on anything non-string → `TypeError` at query build on insert AND update. Affected sites (current tree): projector.ts:72-75 (sessionRow), :174 (updateMessage), :257 (insertMessage), :288 (WorkspaceTable `Date.now()`), :311/:406/:415/:473/:482/:520 (Session `time_updated` numbers), :324-330 (MessageUpdated), :384 (PartUpdated); input.ts:120 (projectAdmitted), :177 (projectPrompted). Nothing persists after the throw (loud failure — no mis-store; the smoke asserts this). Memo #11 U-1 closes as CONFIRMED-DEFECT.

**OPTIONS**
- **T-A. Custom PG epoch column type (CHOSEN).** One `customType` in `schema.sql.pg.ts`: storage `timestamptz`, JS-side numbers both directions, `toDriver` accepts number|Date|string. All Timestamps columns + one-off timestamp sites switch to it. ZERO consumer value-shape changes (numbers = the SQLite contract the rewired consumers were never allowed to depart); the PG namespace row types move CLOSER to the SQLite-typed `SchemaTables` (the erasure cast at schema-pg-namespace.ts:61 gets safer, not riskier). Signed DDL byte-unchanged — the column's SQL type is identical; drizzle-kit is not run against PG (drizzle.config comment, Memo #11 item 4), so no generated artifact churn either. Precedent: path.pg.ts customTypes.
- **T-B. App-side Date conversion at every call site.** REJECTED: wide churn across core (every sessionRow/messageRow/input write + every read back to numbers where Schema expects NonNegativeInt/epoch millis), violates the Step 4 rule the rewire operated under ("changed table-object source only"), and converts a one-file representation fix into a ~15-file behavioral diff with per-site regression risk. Only a wire-contract change (forcing Dates into the durable event payloads) could justify it — nobody proposes that.
- **T-C. mode:"string" + app-side ISO strings.** REJECTED: same churn class as T-B, worse fidelity (stringly-typed times leak into consumers typed as numbers), and `$default` still needs re-authoring everywhere.

**T-A exact shape (implementer follows verbatim)** — rewrite of `packages/core/src/database/schema.sql.pg.ts`:

```ts
import { customType } from "drizzle-orm/pg-core"

// H-1 fix (Memo #12, T-A): epoch-millis PG timestamp column. Storage is
// timestamptz (signed DDL unchanged; "timestamp with time zone" is the same
// PG type under its drizzle spelling). The JS-side contract is the SQLite
// one — epoch-millis NUMBERS in both directions (schema.sql.ts:3-10).
// Accepts number | Date | string on write defensively; always reads back
// as a number (postgres-js hands timestamptz back as Date).
export const epochTimestamp = customType<{
  data: number
  driverData: string
  driverOutput: Date | string
}>({
  dataType() {
    return "timestamp with time zone"
  },
  toDriver(value) {
    if (typeof value === "number") return new Date(value).toISOString()
    if (value instanceof Date) return value.toISOString()
    return value
  },
  fromDriver(value) {
    return value instanceof Date ? value.getTime() : Date.parse(value)
  },
})

export const Timestamps = {
  time_created: epochTimestamp()
    .notNull()
    .$default(() => Date.now()),
  time_updated: epochTimestamp()
    .notNull()
    .$onUpdate(() => Date.now()),
}
```

Switch surface (only explicit `timestamp(` sites; `...Timestamps` spreads pick the helper up unchanged): session/sql.pg.ts:69-70 (`time_compacting`/`time_archived` → bare `epochTimestamp()`), :162-164 (`session_input.time_created` → `epochTimestamp().notNull().$default(() => Date.now())`), :200 (checkpoint `time_updated` → `epochTimestamp().notNull()`); account/sql.pg.ts:12, :32 (`token_expiry` → `epochTimestamp()`); project/sql.pg.ts:13-19 (project Timestamps inline sites → `epochTimestamp()` + `.notNull()` + `$default(() => Date.now())` for created/updated as today, `time_initialized` bare), :34 (`project_directory.time_created`); control-plane/workspace.sql.pg.ts:17 (`time_used`).

Mechanism proof (why T-A works through BOTH bridge mapper paths without touching the bridge): the bridge's `mapResultRow` (drizzle-utils.ts:86) and RC2's JIT mapper both branch on `mapFromDriverValue.isNoop` — a customType's `mapFromDriverValue` (the `fromDriver` wrapper) is a real function → fires on every read in both paths; writes flow through the same `Param` encoder path the smoke verified statically (`sql.cjs` — `toDriver` runs where `toISOString` ran). Belt-and-braces `Date`/`string` write acceptance keeps the control-path (helper-produced) writes legal during any mixed state.

Representation-level note (Memo #9 §8.2 precedent, artifact governs): `dataType()` string `"timestamp with time zone"` ≡ blessed `0000_init` `timestamptz` (PG alias, same type OID family). No parity-matrix storage change; the matrix gains a JS-representation note only.

### SURFACE A′ — H-1 adjacent: the bigint read seam (VERDICT(A′): APPROVE — B-A)

**Diagnosis (root-caused this session, not merely observed):** RC2 moved bigint decode OUT of columns (`PgBigInt53` has no `mapFromDriverValue`; the base is `noop`) INTO a codec registry (`genericPgCodecs["bigint:number"].normalize = Number`) that RC2's own `orderSelectedFields(fields, pathPrefix, codecs)` + `mapResultRow`/`makeJitQueryMapper` apply via per-field `codec(rawValue, arrayDimensions)`. The vendored bridge's local shims predate this layer: `orderSelectedFields` (drizzle-utils.ts:38-50) drops `codec`/`arrayDimensions`, and `mapResultRow` (:64-115) calls `mapFromDriverValue(rawValue)` bare. postgres-js returns bigint as STRING → mode:"number" columns read back as strings through `select` AND `.returning()` on both jit (default, driver.ts:61) and non-jit paths. Runtime-proven: `session_message.seq`, `session_input.admitted_seq`; `SessionInput.find` fails decoding `admittedSeq` from the string shape (input.ts:21-28). Every `bigint({mode:"number"})` column is affected (session tokens ×5, session_message.seq, session_input admitted/promoted, epoch baseline_seq, checkpoint applied_seq, event/event_sequence seq).

**OPTIONS**
- **B-A. Restore RC2 parity in the bridge (CHOSEN).** Update the vendored `orderSelectedFields`/`mapResultRow` to the RC2 shapes (attach `codec: codecs?.get(field, "normalize")` + `arrayDimensions: field.dimensions`; decode `codec(rawValue, arrayDimensions)` before `mapFromDriverValue`), construct the codecs registry from drizzle's own exports, and thread it through the four call sites (select.ts:259, insert.ts:256, update.ts:316, delete.ts:175). This is a bug-fix TOWARD the package's 1:1-port mandate (its AGENTS.md: "compare with current drizzle-orm@1.0.0-rc.2 runtime" — the comparison is this memo's §10.1), on my Step 1 surface (Memo #8 domain). Fixes every codec-dependent column class (bigint:number today; numeric:number, date, and friends if ever adopted) at the root; schema files untouched.
- **B-A′. Custom `bigintNumber` column in core** (`mapFromDriverValue: Number(v)` — fires through the shims like T-A does). REJECTED as primary: papers over the bridge hole, leaves every FUTURE codec-bearing RC2 column (and any `bigint({mode:"number"})` added by numbered migrations) silently string-typed, and spreads the workaround across ~10 column sites in 4 schema files. Acceptable ONLY as a hot-fallback if B-A hits an import-blocking wall (see UNVERIFIED 1) — and then it must carry a TODO referencing FM-25.
- **B-B. Consumer-side `Number(row.x)` casts.** REJECTED: consumers are already typed to numbers (`$inferSelect` says number — the string is a runtime lie); pushing casts into every reader churns the codebase to compensate for a driver-layer defect and still misses `.returning()` sites (promotion path reads admitted rows back).

**B-A exact shape:** in `packages/effect-drizzle-pg/src/internal/drizzle-utils.ts` —

1. Build/export the registry once (import route preferred; RC2 runtime exports confirmed):
   `CodecsCollection` from `drizzle-orm/codecs` (root `codecs.cjs` exports it) + `effectPgCodecs` from `drizzle-orm/effect-postgres/codecs` (or `refineGenericPgCodecs(genericPgCodecs)` from `drizzle-orm/pg-core/codecs`); `new CodecsCollection(resolvePgTypeAlias, effectPgCodecs)`. Acceptance property the implementer must assert: `collection.get(<a bigint mode:"number" column>, "normalize")` is `Number`.
2. `orderSelectedFields(fields, pathPrefix?, codecs?)` → RC2 shape: Column entries get `codec` + `arrayDimensions: field.dimensions`; SQL/Aliased/Subquery entries stay `{path, field}`.
3. `mapResultRow` → RC2 shape: `const value = rawValue === null ? null : decoder.mapFromDriverValue(codec ? codec(rawValue, arrayDimensions) : rawValue)` (keep the existing joins-nullify logic, which already matches RC2).
4. Pass the registry at all four call sites. JIT path needs no code change: once entries carry `codec`, RC2's `makeJitQueryMapper` emits the codec call itself.

### SURFACE B — B4/B5 landing (VERDICT(B): APPROVE)

- **B4.1 PASS** — context-epoch.ts:137-163: exported `insert` runs `INSERT … .onConflictDoNothing()` (:149-158) then read-back via `find()` (:160) and returns `stored.baseline_seq` — the READ-BACK row's value, never the local computation (:162); race test asserts the loser's insert returns the winner's 100 (session-projector.test.ts:751-791). FM-13 guard holds.
- **B4.2 PASS** — :165-192: guarded `UPDATE … WHERE session_id = ? AND baseline_seq <= :new` (`lte` at :184) + `.returning()` (:185); 0-rows ⇒ `find()` re-read and continue with the stored row (:188-191) — not an error; returns the EFFECTIVE row in both branches. Tests :795-835 (stale 25 → stored 40 kept; fresh 50 → applied). FM-14 guard holds. Matches the Part 4 step-9 semantics live-proven in PART 6.
- **B4.3 PASS** — session.ts:217-226: comment documents the outside-the-tx upsert + benign orphan window; `.onConflictDoNothing()` (:226), never DoUpdate.
- **B4.4 PASS** — full read of context-epoch.ts: no pre-projector hook, no synthetic durable events, no advisory locks; `advance` still rides the commit hook (:74-78, :194-208).
- **B5.1 PASS** — projector.ts: `negateUsage`/`addUsage`/`isZeroUsage`/`usageDelta` (:91-133); PartUpdated: ONE previous read (:381), upsert (:382-387), then either the cross-session split with INDEPENDENT guards (`previous && row.session_id !== sessionID` — :394-397) or ONE `usageDelta` + ONE `applyUsage` (:399-400), skipped entirely when zero-delta (:132); MessageRemoved: rows summed in JS (:346-349), ONE `applyUsage(−1)` (:350). Per-event statement count O(parts)→1 as conditioned. Tests :579 (equivalence across parts incl. update-from-usage-bearing part) and :671 (cross-session split).
- **B5.2 PASS** — fence comment at `applyUsage` (projector.ts:135-138) verbatim to the condition (sync-tier only; async-pool PR = REJECT on sight; FM-15).
- **B5.3 PASS** — no `FOR UPDATE`, no CTE upserts in projector.ts or context-epoch.ts (grep + full read this session); aggregate serialization remains the correctness mechanism (T2, live-proven PART 6 step 10).
- **Export ruling (asked): APPROVED.** `insert`/`replace` exports from context-epoch.ts (:137, :165) follow the `SessionInput.admit` precedent — pure sync-tier statement functions with no service state; tests construct real rows. Condition: do NOT extend the export surface to `find`/`advance` internals.
- Tests: 12/12 green in my own run this session (SQLite dialect, 1.85s). The reported suite-level "71/71" includes files beyond this review's surface (see UNVERIFIED 3 — non-blocking).

### Memo #11 closure

- **U-1: RESOLVED-AS-DEFECT** — CONFIRMED BROKEN, broader than flagged (writes AND the same class at 12+ sites; plus the independent bigint/FM-25 read defect). Fix shapes ruled above (T-A + B-A). H-1 was correctly pre-registered as trigger-(a); this memo is that decision.
- **U-2: RESOLVED** — PG session rows round-trip (control test: session/session_message/session_input with Date timestamps round-trip exact epoch millis; jsonb/text round-trip). Full closure at Condition 3(a): all four H-1 tests green post-fix.
- **U-3: unaffected** — mooted by Memo #11 Condition 1 (still owed by implementer; unchanged).

**INVARIANTS**
- Durable-vs-derived — **pass**: both fixes are value-codec plumbing at the driver boundary; no table, tier, predicate, or event-semantics change. The event log remains the only truth.
- Signed DDL/bootstrap byte-identity (Memo #7 Cond 1) — **pass**: column SQL types identical (`timestamp with time zone` ≡ `timestamptz`; bigint columns untouched); no migration, no `schema.gen.ts`/`migration.gen.ts` regeneration, nothing re-cut. Parity matrix gains representation notes only.
- V2 admission/promotion semantics — **pass**: input.ts untouched by the fix (promote predicate `isNull(promoted_seq)` intact per Memo #11); B4/B5 landings preserve admission-before-wake and sync-tier membership.
- Hot-path indexes (event per-partition uniques/replay; session_input partial + backstops; session_message history pagination) — **pass, untouched** (session/sql.pg.ts:166-175, :143-146 re-read this session).
- SQLite path byte-identical — **pass by construction**: zero edits outside `*.sql.pg.ts`, `schema.sql.pg.ts`, and `packages/effect-drizzle-pg` (Condition 3c re-proves by suite).
- NOTIFY listener invariants — N/A (no listener code in this diff).

**DURABLE-vs-DERIVED:** untouched (both lines materialize exactly as signed; fixes operate below the semantic surface).

**FAILURE-MODES-UPDATED:** yes — FM-24 (timestamp number→driver throw; T-A guard) and FM-25 (bridge codec-layer omission; B-A guard) appended to the PART 4 table this session.

**CONDITIONS**
1. (BLOCKING, T-A) Implement the epoch column verbatim per §10.2 SURFACE A in `packages/core/src/database/schema.sql.pg.ts` and switch exactly the enumerated sites (session/sql.pg.ts:69-70,162-164,200; account/sql.pg.ts:12,32; project/sql.pg.ts:13-19,34; workspace.sql.pg.ts:17). `$default`/`$onUpdate` = `() => Date.now()` (SQLite parity). No edits to any SQLite file, `migration.pg.ts`, or `.opencode/db-migrations/`. Effort: Quick.
2. (BLOCKING, B-A) Restore RC2 codec parity in `packages/effect-drizzle-pg/src/internal/drizzle-utils.ts` + the four builder call sites per §10.2 SURFACE A′; registry must come from drizzle's exported codecs (acceptance: `bigint mode:"number"` → `Number`), never hand-rolled per-column casts (B-B rejected). PORT-NOTES gains a deviation-repair entry citing FM-25. Effort: Short.
3. (BLOCKING, proof) (a) full `packages/core/test/session-pg-roundtrip.test.ts` green under `TEST_DATABASE_URL` — all four H-1 tests flip PASS, control green including `typeof … === "number"` bigint asserts (:225-229) and `SessionInput.find` decode (:233-245); (b) NEW bridge tests in `packages/effect-drizzle-pg`: `bigint({mode:"number"})` round-trips as NUMBER via `select` AND via `.returning()`, each with jit enabled AND disabled (driver config `jit: false`); (c) SQLite suites green (session-projector 12/12 re-verified this session; full suite at PR); (d) `bun typecheck` in `packages/core` and `packages/effect-drizzle-pg`.
4. (Non-blocking) Parity matrix note: PG timestamp columns are timestamptz storage / epoch-millis JS representation (T-A); representation-only, artifact governs.
5. (Ruling, recorded) context-epoch `insert`/`replace` exports APPROVED (SessionInput.admit precedent); export surface frozen there.

**UNVERIFIED**
1. UNVERIFIED: `drizzle-orm/codecs` + `drizzle-orm/effect-postgres/codecs` subpaths are importable WITH type declarations from the bridge (runtime `.cjs`/`.js` + `codecs.d.ts` files confirmed on disk; package.json `exports` map not opened) — cheapest resolve: implementer import spike; fallback = build the collection from `drizzle-orm/pg-core` codec exports or a ≤10-line local `CodecsCollection.get` mirror, and only in that last resort is B-A′ acceptable as an interim.
2. UNVERIFIED: whether `makeWithDefaults` exposes a `jit` config knob for the disabled-path tests (driver.ts:61 reads `config.jit`) — cheapest resolve: read `driver.ts` config plumbing when writing Condition 3(b); if unreachable, force the non-jit path by monkey-patching nothing — instead assert via `useJitMappers` option at `make()` level (effect-pg/session.ts:32 accepts it).
3. UNVERIFIED: the implementer-reported "71/71" suite count — my verification covers the 12 in-scope projector tests (12/12 green); cheapest resolve: full suite run lands with the Condition 3(c) PR evidence.

**ORACLE-COUNTER-SIGN:** not-required — schema representation + vendored-bridge repair are DB-domain (Step 2/Step 1 surfaces, Memo #8/#9 precedent); no baseline change, no new dependency (codec imports are subpaths of the existing `drizzle-orm` pin), no V2 semantics, effort Short overall. Visibility note for Oracle's next pass: the bridge's mapper behavior changes post-Step-1-review (toward RC2 parity); B4/B5 landing approved here needs no second key.

**Effort:** Short — T-A Quick, B-A Short, tests Short.

**VERDICT: APPROVE-WITH-CONDITIONS**

# PART 11 — MEMO #12 CLOSURE + onConflict RC2-ALIGNMENT ADJUDICATION (RETROACTIVE) + DEVIATION RULINGS

Session 7 (Athena, Memo #13). Scope: Memo #12 Conditions 1-3 closure verification; retroactive adjudication of an out-of-scope bridge fix (`onConflictDoNothing`/`onConflictDoUpdate`); `toDriver` cast-deviation ruling; FM-24/FM-25 guard confirmation. **OUT of scope by instruction:** event.ts / input.ts / wake machinery (Step 5b-1 in flight — next memo). RC2 internals verified in the bridge's RESOLVED copy (re-proven this session via `require.resolve` from packages/effect-drizzle-pg): `node_modules/.bun/drizzle-orm@1.0.0-rc.2+7ebb973cd090d7db/node_modules/drizzle-orm/` (same copy as Memo #12).

## 11.1 — Evidence base (all opened/executed this session; all commands `nice -n 19`)

| Source | What it established |
|---|---|
| `packages/core/src/database/schema.sql.pg.ts:1-35` (full read) | T-A landed: `epochTimestamp` customType per §10.2 SURFACE A incl. the ruled cast deviation (:17-22); `Timestamps` helper :28-35 with `$default`/`$onUpdate` = `Date.now()` (SQLite parity) |
| `packages/core/src/session/sql.pg.ts:1-200` (full read) | switch sites :68-69 (`time_compacting`/`time_archived` bare), :161-163 (`session_input.time_created` notNull+$default), :199 (checkpoint `time_updated` notNull); spreads :67/:86/:101/:121/:138 pick the helper up; hot-path indexes INTACT — session_input partial `:169-171` (`.where(sql\`promoted_seq IS NULL\`)`) + unique backstops :172-173, session_message history pagination :144, per-session seq unique :142 |
| `packages/core/src/account/sql.pg.ts:12,:32`, `project/sql.pg.ts:14-20,:35-37`, `control-plane/workspace.sql.pg.ts:18-20` (full reads) | remaining switch sites — exactly the memo's enumeration (line numbers shifted +1 from the memo's pre-edit cites; content exact: bare `token_expiry`/`time_initialized`, notNull+$default created, notNull+$onUpdate updated, notNull+$default `time_used`/`time_created`) |
| git status (packages/core) | NO tracked `*.sql.ts` / `schema.gen.ts` / `migration.gen.ts` modified — SQLite schema surface untouched (Cond 1 constraint holds); M-files (event.ts, input.ts, session.ts, database.ts, …) belong to earlier-approved steps + the in-flight 5b-1, out of scope here |
| `packages/effect-drizzle-pg/src/internal/drizzle-utils.ts:1-152` (full read) | B-A landed: registry :31 `new CodecsCollection(resolvePgTypeAlias, effectPgCodecs)` from `drizzle-orm/codecs` + `drizzle-orm/effect-postgres/codecs` + `drizzle-orm/pg-core/codecs` (memo-sanctioned chain, fallback level 1); `orderSelectedFields` :50-72 attaches `codec`+`arrayDimensions` on Column entries, threads `codecs` through Table/nested recursion; `mapResultRow` :108-110 applies `codec(rawValue, arrayDimensions)` before `mapFromDriverValue` with the null guard; joins-nullify logic preserved (:123-136) |
| RC2 `utils.cjs:174-193` | RC2's own `orderSelectedFields`: `codec: codecs?.get(field, "normalize")` UNCONDITIONAL on Column entries — the implementation's `column.codec ?` guard (:62) is a short-circuit of the same `undefined` result for codec-less columns; output-equivalent (and non-throwing — proven by live runs through text/integer/jsonb columns) |
| `select.ts:259`, `insert.ts:256`, `update.ts:317`, `delete.ts:175` (grep + reads) | all four `orderSelectedFields` call sites thread `pgCodecs` (PORT-NOTES cites update at :317 vs memo's pre-edit :316 — off-by-one, immaterial) |
| `packages/effect-drizzle-pg/PORT-NOTES.md:131-144` | deviation-repair entry #11 present: root cause, repair per §10.2 SURFACE A′, acceptance (`get(bigint-number) === Number`, spiked), rejected alternatives (B-B, B-A′) — Cond 2 documentation requirement DISCHARGED |
| `packages/effect-drizzle-pg/test/bigint-codec.test.ts:1-120` (full read) + `pg.test.ts` (9 tests; `import * as Effect` namespace style = package test convention) | Cond 3(b) artifact: 6 tests = {select, insert `.returning()`, update `.returning()`} × {jit on/off} via `makeWithDefaults({ jit })` (resolves Memo #12 U-2); gated on `TEST_DATABASE_URL` (FM-18 class); typeof-number asserts are the true lock (BIG=2^53+1 collapses identically in both string-parse and literal — typeof catches stringness regardless) |
| RC2 `pg-core/query-builders/insert.cjs:99-146` + `insert.d.ts:23,:155-158,:188` | RC2 PG builders store the CLAUSE BODY ONLY: DoNothing no-target → ``sql`do nothing` ``; target → ``sql`(${sql.raw(escaped)})${whereSql} do nothing` ``; DoUpdate → ``sql`(${sql.raw(escaped)})${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}` ``; config type `onConflict?: SQL` (scalar) |
| RC2 `pg-core/dialect.cjs:283` | `buildInsertQuery` PREPENDS: `onConflict ? sql\` on conflict ${onConflict}\` : void 0` — the dialect owns the prefix |
| RC2 `sqlite-core/dialect.cjs:247` + `sqlite-core/query-builders/insert.d.ts:24` + `packages/effect-drizzle-sqlite/src/sqlite-core/effect/insert.ts:260-291` | the PORT-ORIGIN contract: SQLite config is `onConflict?: SQL[]` (array); dialect does `sql.join(onConflict)` with NO prefix; the SQLite wrapper's methods therefore carry the ` on conflict` prefix (:264, :270). The vendored port copied that shape into the PG scalar-config world → double prefix. SQLite genuinely unaffected (claim proven, not just reported) |
| RC2 `sql/sql.cjs:105-113` | sql-template array interpolation renders `("a", "b")` — parenthesized, comma-separated; the vendored `sql\`${config.target}\`` target rendering is output-equivalent to RC2's `(${sql.raw(...)})` and satisfies PG's mandatory-parens conflict_target grammar |
| **toSQL() proof (bun -e, no DB, this session)** | composed SQL from the LANDED builders + RC2 PgDialect: `insert into … on conflict do nothing`; `… on conflict ("m13_counters"."id") do nothing`; `… on conflict ("m13_counters"."id") do update set "n" = $3` — SINGLE prefix, valid PG, all three forms |
| **Live runs (ephemeral postgres:17, container `athena-m13-pg`, torn down after)** | bridge suite 15/15 (9 pg.test + 6 bigint-codec, TEST_DATABASE_URL); core `session-pg-roundtrip.test.ts` 4 pass / 0 fail (in-test diagnostics show bigint landing as `(Number)`); core `session-projector.test.ts` (SQLite) 12/12; `bun typecheck` in packages/effect-drizzle-pg CLEAN (`tsgo --noEmit`, zero errors) |
| onConflict blast radius (grep packages/core/src) | 9 sites / 7 files: event.ts:334 (durable event dedup upsert), projector.ts:280,331,385, input.ts:122, context-epoch.ts:157, session.ts:226, directories.ts:74-81, permission/saved.ts:69 — every PG upsert would have been invalid SQL pre-fix |
| `driver.ts:56` | dialect instance is RC2's own `new PgDialect()` — the prefix lives in RC2 code the bridge does not vendor |

## 11.2 — Memo #12 condition-by-condition closure

| Condition | Status | Evidence (this session unless noted) |
|---|---|---|
| 1 (T-A, blocking) | **CLOSED** | schema.sql.pg.ts:9-26 = §10.2 SURFACE A verbatim modulo the ruled cast (:18); all 10 enumerated sites switched (session/sql.pg.ts:68-69,161-163,199; account/sql.pg.ts:12,32; project/sql.pg.ts:14-20,35-37; workspace.sql.pg.ts:18-20); spreads pick up the helper; zero SQLite-file/migration edits (git status) |
| 2 (B-A, blocking) | **CLOSED** | drizzle-utils.ts:31,50-72,108-110 + four call sites (select.ts:259, insert.ts:256, update.ts:317, delete.ts:175); registry from drizzle exports (level-1 chain; Memo #12 U-1 RESOLVED); PORT-NOTES #11 present citing FM-25 |
| 3(a) H-1 suite | **CLOSED** | my own run: 4 pass / 0 fail under ephemeral PG 17; file = 3 H-1 tests + 1 control (report's "4/4 H-1" label counts the whole file — immaterial) |
| 3(b) bigint bridge tests | **CLOSED** | 6/6 in my own 15/15 run; jit knob reached via `makeWithDefaults({ jit })` (U-2 RESOLVED) |
| 3(c) SQLite suites | **CLOSED** for the in-scope projector file (my run 12/12); full-suite 71/71 accepted on orchestration-verified report — PR-time evidence note stands (U-3 carried) |
| 3(d) typechecks | **CLOSED** bridge (my run, clean); core accepted as reported (pre-existing test-file errors only, stash-proven) — re-check at PR |
| 4 (parity-matrix note, non-blocking) | **CARRIED to PR** — representation-only, artifact governs |
| 5 (export ruling) | recorded; no action |

Memo #12 UNVERIFIED: U-1 RESOLVED (imports landed, typecheck clean, live green); U-2 RESOLVED; U-3 carried to PR (FM-18 discipline: TEST_DATABASE_URL set, 0-test run = failure).

## 11.3 — Decision memo

```
DECISION MEMO #13 — MEMO #12 CLOSURE (CONDS 1-3) + onConflict RC2-ALIGNMENT (RETROACTIVE) + toDriver CAST + FM-24/25/26 GUARDS
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: c (every migration cut n/a; this is a condition-closure + out-of-scope-change adjudication on the Step 1/2 surfaces) — recorded under the Decision-Point Protocol as a migration-cut-adjacent review
VERDICT: APPROVE-WITH-CONDITIONS
```

### Ruling 1 — Memo #12 Conditions 1-3: DISCHARGED; Memo #12 CLOSED

Per the closure table above. The two implementation deviations from my verbatim shapes are both ruled below; everything else is exact.

### Ruling 2 — `toDriver` cast deviation (Cond 1, documented): APPROVE

`schema.sql.pg.ts:17-22`: `const v = value as number | Date | string` then the memo's branch order verbatim (number→ISO, Date→ISO, string passthrough). tsgo types the param as the declared `data: number`, so `value instanceof Date` on the narrowed type is a compile error; the single local cast restores the memo's defensive three-way acceptance without widening the public type (callers still pass numbers). Runtime-identical to the memo's shape — proven live (4/4 roundtrip incl. number-writes and number-reads-back). Accepted as a type-level accommodation, not a semantic deviation.

### Ruling 3 — onConflict RC2-alignment (out-of-scope change, retroactive adjudication): APPROVE retroactively, with conditions

**OPTIONS**
- **O-A. Retroactive approval as landed (CHOSEN).** The fix is provably RC2-aligned (body-only builder methods, dialect-owned prefix), proven by direct toSQL() execution in three forms, and P0-critical: 9 core call sites — including event.ts:334, the durable-event dedup upsert on the EVENT LOG path — emitted syntactically invalid SQL under PG pre-fix. Same 1:1-port mandate justification as B-A (package AGENTS.md: "compare with current drizzle-orm@1.0.0-rc.2 runtime" — comparison performed by me, this session, against insert.cjs:99-146 / dialect.cjs:283 / insert.d.ts:23).
- **O-B. Revert and re-land under a fresh condition.** REJECTED: pure process theater — it would reintroduce a P0 defect on 9 sites to satisfy sequencing, then land the identical bytes back.
- **O-C. Keep prefix-in-method; strip it in a vendored dialect subclass.** REJECTED: forks the dialect surface (more vendored code to maintain against RC2), contradicts the port mandate harder than the bug did, and the divergence would bite again at the next RC sync.

**Mechanism (proven, not taken from the report):** the port origin (effect-drizzle-sqlite insert.ts:261-270) pushes PREFIXED fragments into an onConflict ARRAY — correct for SQLite, whose RC2 dialect joins the array with no prefix (sqlite dialect.cjs:247; config `SQL[]`, insert.d.ts:24). The PG contract is a scalar `SQL` (insert.d.ts:23) whose RC2 dialect PREPENDS ` on conflict ` (pg-core dialect.cjs:283; the bridge uses RC2's own PgDialect, driver.ts:56). Porting the method bodies across that contract boundary produced `on conflict on conflict …` — invalid on every PG upsert. Landed fix (insert.ts:260-267 DoNothing, :269-286 DoUpdate) stores the clause body only, exactly RC2's assembly; target parenthesization comes from RC2's sql-array interpolation (sql.cjs:105-113). Accepted byte-level divergence: qualified target `("t"."id")` vs RC2's unqualified `("id")` — both valid PG conflict targets; cosmetic.

**Process note (standing):** this landed in my domain without a prior ruling. It is blessed on its merits THIS TIME because the shape is verifiably correct and the pre-fix state was a P0; had the shape been wrong, the ruling would have been REJECT-and-revert. Out-of-scope DB-domain changes come to me BEFORE landing — this approval is not a precedent.

### Ruling 4 — FM guard status

- **FM-24 (timestamp number→throw): ADEQUATE.** The roundtrip file drives the column class through real PG on three tables, hitting `$default`/`$onUpdate` and both write+read directions; the failure mode is per-column-CLASS (one customType), so class-level coverage suffices.
- **FM-25 (codec omission): ADEQUATE, one residual.** 6 tests cover {select, insert `.returning()`, update `.returning()`} × {jit on/off}; delete `.returning()` (delete.ts:175) is uncovered — same one-line threading, shared mechanism; fold a delete case into the FM-26 regression (Condition 2), non-blocking.
- **FM-26 (NEW, this memo): on-conflict double prefix.** Guard: NONE today — pg.test.ts has ZERO onConflict/toSQL coverage. Fixed pre-flight (proven), unguarded against regression → Condition 2.

**INVARIANTS**
- Durable-vs-derived — **pass**: all changes are query-emission/codec plumbing at the driver boundary; no table, tier, predicate, or event-semantics change; the event log remains the only truth (event.ts:334's upsert only becomes EXECUTABLE, its semantics unchanged).
- Signed DDL/bootstrap byte-identity — **pass**: column SQL types identical (`timestamp with time zone` ≡ `timestamptz`); no migration, no regeneration; nothing re-cut.
- V2 admission/promotion semantics — **pass**: input.ts untouched by this diff's scope; session_input partial index + backstops re-verified intact (session/sql.pg.ts:169-173).
- Hot-path indexes — **pass, untouched** (session/sql.pg.ts:142-146, 169-173 re-read this session).
- SQLite path byte-identical — **pass**: no tracked `*.sql.ts`/`schema.gen.ts`/`migration.gen.ts` modified (git status); SQLite suites green (projector 12/12 my run).
- NOTIFY listener — N/A (no listener code in this diff).

**DURABLE-vs-DERIVED:** untouched; both surfaces materialize exactly as signed.

**FAILURE-MODES-UPDATED:** yes — FM-26 appended to the PART 4 table (root cause, RC2 cites, blast radius, guard-owed status); FM-24/FM-25 rows annotated with landed+verified status.

**CONDITIONS**
1. (BLOCKING for this memo's discharge, Effort Quick) PORT-NOTES entry #12 documenting the onConflict RC2-alignment as a deviation from the SQLite-wrapper port origin: root cause (array+prefix-in-method vs scalar+dialect-prefix, with the RC2 file:line cites from FM-26), the qualified-target rendering divergence vs RC2, and a reference to Memo #13/FM-26.
2. (BLOCKING for this memo's discharge, Effort Quick) Bridge regression test for onConflict emission: `toSQL()` asserts that DoNothing(no target) / DoNothing(target) / DoUpdate(target+set) each contain EXACTLY ONE ` on conflict ` occurrence and a parenthesized conflict target where present (DB-free asserts — FM-18-safe), plus ONE live upsert round-trip under `TEST_DATABASE_URL`; fold in a delete `.returning()` bigint case to close the FM-25 residual.
3. (Non-blocking, carried) Memo #12 Condition 4 parity-matrix representation notes at PR.
4. (Standing, process) Out-of-scope DB-domain changes require a ruling BEFORE landing; this retroactive approval is not a precedent.

**UNVERIFIED**
1. UNVERIFIED: core `bun typecheck` "only pre-existing test-file errors" — implementer stash-proven, not rerun by me (heavy) — cheapest resolve: PR-time typecheck evidence alongside the 71/71 CI run.
2. UNVERIFIED: full-suite "71/71" — orchestration-verified report; cheapest resolve: PR-time CI with `TEST_DATABASE_URL` exported (FM-18).

**ORACLE-COUNTER-SIGN:** not-required — vendored-bridge repair + schema representation are DB-domain (Memo #8/#12 precedent); no baseline change, no new dependency (codec imports are subpaths of the existing drizzle-orm pin), no V2 semantics, effort Short overall. Visibility note for Oracle's next pass: the bridge insert/update builders' onConflict contract changed to RC2 body-only semantics — the Step 5b-1 implementer must NOT re-introduce prefixes if they touch these builders.

**Effort:** Conditions 1+2 ≈ Quick (one doc entry + one test file).

**VERDICT: APPROVE-WITH-CONDITIONS**

**MEMO #12: CLOSED** (Conditions 1-3 discharged and independently re-verified; Condition 4 carried to PR; Condition 5 recorded).

# PART 12 — MID-FLIGHT REVIEW #4: STEP 5b-1 (PG CONCURRENCY CORE) + MEMO #13 DISCHARGE VERIFICATION

Session 8 (Athena, Memo #14). Scope: first review of Step 5b-1 (`database/wake.ts`, `database/database.ts` isPg export, `database/pg.bun.ts` pool/params, `event.ts` T2, `session/input.ts` SKIP LOCKED, `test/wake-pg.test.ts`; adjacent llm.ts/runner/test-lib/session-create diffs read for DB-domain aspects) + Memo #13 discharge spot-check. **OUT of scope:** Step 6 CLI (packages/opencode), TUI files.

## 12.1 — Evidence base (all commands `nice -n 19`; ephemeral `postgres:17-alpine` container `athena-m14-pg`, torn down after)

| Source | What it established |
|---|---|
| `wake.ts:1-213` (full read) | channelName helper :33-37 (single definition, used by emitter :68 AND listener :116 — Memo #1 Cond 1); PROCESS_TAG :42-45; notifyInTransaction :63-75 (pg_notify via `db.run(sql.raw)`, quote-escaped, isPg no-op); ListenerService/Layers :79-163; backstop schedule+poll :177-188; pendingSessions :197-213 |
| `database.ts:40-49` | `isPg = databaseUrl !== undefined`, single-source on `process.env.DATABASE_URL`; comment documents the fork surface |
| `pg.bun.ts:139-271` | reserved-connection SETs :155-173 (Memo #9 Cond 2 belt-and-braces); pooled base acquirer :188; ambient-scope transactionAcquirer :201-214; pool max `?? 8` with decision-#12 formula documented-deferred :240-246; `connection:{statement_timeout, idle_in_transaction_session_timeout}` startup params :251-266 |
| `event.ts:214-397` (full read) | T2 `.for("update")` in-tx at :252-272 via `(q: any)` dialect pipe; event_sequence upsert :348-359; EventTable insert :360-372; **NOTIFY at :378 INSIDE the db.transaction callback (:249-382)**; local durable pubsub wake :384-390 |
| `input.ts:262-324` | promoteSteers :270-293 / promoteNextQueued :304-322 pending-SELECTs with `.for("update", {skipLocked:true})` via `(q: any)` pipes; `isNull(promoted_seq)` predicate load-bearing :276/:310 (promotion UPDATE predicate :150 intact); backstops untouched |
| `llm.ts:176-199, 386-409` | promotion calls at :193-196 run through the BASE client — **NO wrapping db.transaction** (FM-29); one llm.stream :235; `as unknown as Interface` plasters :413/:419 |
| `test/wake-pg.test.ts:1-390` (full read) | async-await-Effect setup :55-97 (proven no-op); TEST_DATABASE_URL/DATABASE_URL conflation :34/:371-377; T2 test hand-rolls `.for("update")` bypassing the isPg conditional :190-229 |
| **Effect-thenable probe (bun, this session)** | `(effect as any).then === undefined`; `await effect` returns the Effect object — setup inserts NEVER execute (FM-28b) |
| `effect-pg/session.ts:103-190` + effect-smol `SqlClient.ts:135-160, 230-265` | **tx-routing static proof**: bridge `withTransaction` provides `[reservedConn, id]` under `client.transactionService` in fiber context (:141-150); effect-smol `SqlClient.make` `getConnection` resolves `transactionService` from ambient context (SqlClient.ts:140-146) → `db.run(pg_notify)` inside a tx callback executes ON the tx connection |
| **Live probe (athena-m14-pg)** | startup params: SHOW `statement_timeout`=12345ms, `idle_in_transaction_session_timeout`=23456ms on pooled conns (Memo #10 U-1 RESOLVED); pg_notify in committed tx DELIVERED, in rolled-back tx SUPPRESSED (transactional-wakeup proof — no lost-wake window, no phantom wake) |
| **Suite reruns (my runs)** | bridge 22/22 under TEST_DATABASE_URL ✓; wake-pg **5 pass / 6 FAIL**; SQLite event.test+session-create 63/63 ✓; `bun typecheck` (core) **20 errors vs 0 at clean HEAD** (`git stash -u` baseline proof) |
| `PORT-NOTES.md:145-156`, `on-conflict.test.ts:1-152` | Memo #13 Cond 1-2 artifacts (see 12.4) |
| grep | no `pg_advisory` outside migration.pg (no drain election crept in); all durable aggregates are `sessionID` (session-event.ts:40,46; v1/session.ts:504) — notify channel always a real session channel |

## 12.2 — Surface findings

1. **Memo #1 (wake bus) — emission half CORRECT, receive half ABSENT.** In-tx NOTIFY: PASS (static routing proof + live rollback suppression). Channel/truncation math: PASS (`63 − "oc_s_"(5) = 58` budget; slice(0,58) → ≤63; IDs ASCII by schema — `SessionID = ses_ + descending()`, plus the `ses_[0-9a-f]{64}` shape; bytes==chars). Tiny payload + self-drop: primitive PASS (wake.ts:119), UNTESTED through ListenerService. **FAIL:** `ListenerLayer`/`backstopPoll`/`pendingSessions` have zero consumers (FM-27); `unsubscribe` discards `native.listen()`'s unlisten handle → server-side LISTEN set grows monotonically (Memo #1 bounded-cardinality violated in the primitive); reconnect LISTEN→catch-up→resume deferred to a consumer that does not exist; "correctness never depends on NOTIFY / backstop always-on" holds only vacuously — under PG there is currently NO wake path at all for cross-process admissions (and no backstop). Plan hole: no step after 5b-2 owns the wiring.
2. **T2 (decision #5/B5.3) — placement CORRECT, typing and coverage NOT.** In-tx, PG-only, SQLite branch unchanged (event.ts:252-272). The `q: any` cast: adjudicated MUST-CHANGE (Condition 4) — it erases row types (`row`/`latest`/`seq` → any) on the hottest write path, violates the repo no-`any` rule, and has three more copies in input.ts; precedent-conformant fix = one generic-preserving shared helper with a single internal cast (channelName discipline, Memo #1 Cond 1; toDriver cast, Memo #13 Ruling 2). Coverage: NO PG-gated test executes `commitDurableEvent` (grep: zero EventV2 refs in database-pg/session-pg-roundtrip/wake-pg).
3. **SKIP LOCKED (decision #5) — NOT IN FORCE (FM-29).** Autocommit-scoped select; locks released before the promotion writes. Correctness today rests on predicate + unique backstop + T2 + process-local drains — no demonstrated race, but the locked decision's mechanism is decorative. Fix (Condition 3): claim-then-promote in one tx via the bridge's Step-1-verified nested savepoints, lock order session_input→event_sequence; alternative is an Oracle re-scope, which I do not make.
4. **Pool + startup params (decision #12 / Memo #10 Cond 4-5) — Cond 4 DISCHARGED, Cond 5 deferred-with-cause.** Startup-packet params landed and live-proven (both GUCs, pooled connections). Pool max documented-deferred (no session-count source exists); acceptable — wire at Step 8; note the pinned LISTEN connection counts against `max`.
5. **V2 invariants — ALL PASS.** Admission-before-wake (notify rides PromptAdmitted's own commit tx — observers see only durable-admitted state); SessionExecution process-global untouched; drains process-local, no advisory election; one llm.stream (llm.ts:235); SQLite path byte-equivalent behavior confirmed by 63/63.
6. **wake-pg.test.ts — BROKEN AS EVIDENCE (FM-28).** 6/11 fail outright; the 5 passes are vacuous (empty-table asserts), pure-JS (channelName), SQLite-branch, or bypass-the-conditional (T2 raw builder). Weak assertions additionally: no self-drop test, no rollback suppression, T2 not through commitDurableEvent, "each promotes exactly its own rows" promotes nothing. Rewrite mandated (Condition 1).
7. **Memo #13 discharge — Conditions 1-2 CLOSED (verified independently).** PORT-NOTES #12 complete vs Cond 1 (root cause + RC2 cites + repair + blast radius + reference); on-conflict.test.ts = Cond 2 verbatim incl. FM-25 residual (delete `.returning()` bigint, both jit modes); my 22/22 rerun. Deviation noted and ACCEPTED: target rendering now RC2-identical unqualified `("col")` — implementer eliminated Ruling 3's accepted cosmetic divergence; within the blessed surface. **MEMO #13: CLOSED** (Cond 3 parity notes carried to PR; standing process rule stands).

## 12.3 — Memo #10 Condition 4/5 status

Cond 4 (startup params): **DISCHARGED** (pg.bun.ts:259-266; live-proven both GUCs; U-1 RESOLVED). Cond 5 (pool sizing): documented-deferred to Step 8 — carried (Condition 6 below).

## 12.4 — Decision memo

```
DECISION MEMO #14 — STEP 5b-1 (PG CONCURRENCY CORE): WAKE EMISSION + T2 PLACEMENT CORRECT; SKIP LOCKED DECORATIVE; RECEIVE SIDE UNWIRED; SUITE BROKEN
STATUS: APPROVE-WITH-CONDITIONS
TRIGGER: b (concurrency semantics: SKIP LOCKED placement, T2 cast) | e (NOTIFY topology, payload, listener lifecycle)
VERDICT: APPROVE-WITH-CONDITIONS
```

**OPTIONS**
- **O-A. APPROVE-WITH-CONDITIONS (CHOSEN).** The durable seams are correct and independently live-proven (in-tx NOTIFY with rollback suppression; T2 in-tx placement; startup params; predicate/backstops intact; V2 invariants hold). The defects — decorative SKIP LOCKED, dead listener surface, broken test suite, 20 typecheck errors, unconfined casts — are placement/coverage/quality failures, all condition-able without revert.
- **O-B. REJECT (revert Step 5b-1).** Rejected: reinstates no-design over correct-design-with-gaps; the in-tx NOTIFY and T2 are load-bearing for 5b-2 and are RIGHT; reverting also strands the Memo #10 Cond 4 discharge.
- **O-C. APPROVE as-is.** Rejected: an unverified concurrency core (no production PG path exercised by any green test) violates review Duty 3; decorative SKIP LOCKED contradicts locked decision #5; 20 typecheck errors fail the Step 9 gate today.

**INVARIANTS**
- "NOTIFY inside commitDurableEvent's transaction — no notification for rolled-back events, no wakeup before visibility" — **PASS** (event.ts:378 in tx :249-382; routing proven effect-pg/session.ts:141-150 + effect-smol SqlClient.ts:140-146; live: rollback suppression).
- "Tiny payloads, process tag only; self-drop" — **PASS** primitive (wake.ts:42-45,119); untested through ListenerService.
- "Reconnect order LISTEN → catch-up scan → resume" — **NOT MATERIALIZED** (no consumer; primitive defers catch-up to a nonexistent consumer; unlisten handle discarded).
- "Poll backstop always-on; correctness never depends on NOTIFY" — **FAIL as a system under PG**: no backstop runs anywhere; cross-process wake latency unbounded (FM-27). SQLite unaffected.
- "session_input partial index + `promoted_seq IS NULL` predicate + unique (session_id, promoted_seq) backstop" — **PASS** (input.ts:150,276,310; session/sql.pg.ts:169-173 per Memo #13 re-read, file unchanged since).
- "event (aggregate_id, seq) unique per partition; per-session ordering; replay index" — **PASS**, untouched.
- "Exact-seq commit via per-aggregate FOR UPDATE on event_sequence" — **PASS placement** (event.ts:252-272, in-tx, PG-only); **FAIL coverage** (zero PG-gated tests through commitDurableEvent).
- "SKIP LOCKED drain arbitration" — **FAIL as wired** (FM-29: autocommit-scoped; no arbitration).
- V2: admission-before-wake **PASS**; SessionExecution process-global **PASS** (untouched); drains process-local **PASS** (no advisory election, grep); one llm.stream **PASS** (llm.ts:235).

**DURABLE-vs-DERIVED:** untouched — the wake bus is pure derived wakeup carrying no durable state (Memo #1's rejection of interest-registry option C holds; nothing in this diff adds durable wake state).

**TRANSACTION SEMANTICS:** T2 lock inside the tx ✓; SKIP LOCKED locks die at autocommit statement end before the promotion writes ✗; fix ordering rule: session_input rows BEFORE event_sequence (non-drain publishers take only event_sequence → no cycle).

**FAILURE-MODES-UPDATED:** yes — FM-27 (wake receive side unwired + unlisten handle discarded), FM-28 (dialect-key conflation + vacuous async-await-Effect setup), FM-29 (SKIP LOCKED decorative) appended; FM-20 annotated RESOLVED (startup params live-proven); FM-26 annotated GUARDED.

**CONDITIONS**
1. (BLOCKING, Short) Rewrite `test/wake-pg.test.ts` (FM-28): (a) setup composes Effects — never `async` fns awaiting Effects (proven no-op); (b) PG tests run with `DATABASE_URL=$TEST_DATABASE_URL` (or an injected dialect flag) so isPg conditionals are ACTIVE; (c) rollback-suppression NOTIFY test (probe template: 12.1); (d) concurrent same-aggregate publishes through `EventV2` → contiguous seq (T2 through the REAL pipe), and two-drain promotion through `promoteSteers`/`promoteNextQueued` → exactly-once; (e) non-vacuity asserts (row counts > 0 before asserting behavior).
2. (BLOCKING, Short) `packages/core` `bun typecheck` → 0 errors. Currently 20 vs clean-HEAD 0 (`git stash -u` proof): src/event.ts:653,659,660; src/session/runner/llm.ts:358,372; 15 test-file errors. The `as unknown as Interface` plasters (llm.ts:413,419) do not discharge this.
3. (BLOCKING for Step 8/9 gates, Medium; does NOT gate 5b-2) Make SKIP LOCKED arbitrate (FM-29): claim-then-promote in ONE transaction — pending-SELECT `FOR UPDATE SKIP LOCKED` + per-event promotion via nested savepoints (LifecycleConflict → savepoint rollback, batch continues), batch commits atomically; lock order session_input→event_sequence. Alternative: Oracle re-scopes decision #5 (advisory-only under process-local drains) — a system-wide call that would supersede this condition; I do not relax locked decisions. No demonstrated race today (predicate + unique + T2 + process-local drains).
4. (BLOCKING for merge, Quick) Confine the dialect-conditional erasure: ONE shared typed helper (generic-preserving, single documented internal cast — `lockForUpdate`-shape) replacing the four `(q: any)` sites (event.ts:268-270; input.ts:289-291,318-320). Precedents: channelName single-definition (Memo #1 Cond 1), toDriver cast (Memo #13 Ruling 2 — approved ONE confined cast, not `any`-typed downstream rows).
5. (BLOCKING for Step 8, Medium — plan hole) Assign a NAMED step for the wake RECEIVE side before containers: SessionExecution/session-watch subscribe/unsubscribe, always-on staggered backstop, reconnect catch-up consumer; fix `ensureListening` to keep and use the unlisten handle (wake.ts:112-132) so `unsubscribe` actually UNLISTENs (Memo #1 bounded cardinality + Cond 4 pinned-connection rules). Until landed, PG is emission-only and cross-process wake latency is unbounded.
6. (Non-blocking, Step 8) Wire pool max = min(1.5×sessions, 12) when a session-count source exists (pg.bun.ts:240-246 documents the deferral); deploy notes must count the pinned LISTEN connection against `max` and size the flush pool separately (Memo #2 Cond 5).
7. (Non-blocking) `channelName` truncation counts UTF-16 units; PG's 63 limit is BYTES. Safe today (IDs ASCII by schema — session-id.ts). Assert ASCII in the unit test or slice by byte length when wiring the listener.

**UNVERIFIED**
1. UNVERIFIED: 5b-2 flush-pool diffs colliding with Conditions 2/4 file churn — cheapest resolve: land Conditions 1/2/4 before cutting 5b-2.
2. UNVERIFIED: postgres-js `.listen()` re-fires `onlisten` on reconnect as the comment claims (wake.ts:109-111) — cheapest resolve: kill-connection probe when wiring the listener (Condition 5).
3. UNVERIFIED: "71/71" core-suite claim from earlier steps under the CURRENT tree — cheapest resolve: PR-time full dual-dialect CI with `TEST_DATABASE_URL` exported and the FM-18/28 vacuity discipline.

**ORACLE-COUNTER-SIGN:** not-required — all findings are DB-domain (wake topology, lock placement, tests, typecheck of DB-adjacent seams); no baseline change is proposed (Condition 3 preserves decision #5; no new dependencies; no V2 semantics change; effort ≤ Medium). VISIBILITY for Oracle's next pass: (i) plan hole — wake receive-side wiring is unowned after 5b-2 (Condition 5 needs a step assignment); (ii) the orchestrator's "typecheck clean" was bridge-only — core carries 20 errors; (iii) if Oracle prefers re-scoping decision #5 over the Condition-3 tx-wrap, that verdict is FINAL and supersedes the condition.

**Step 5b-2 disposition: RELEASED.** event.ts's commit path has NO blocking defect — the NOTIFY is genuinely transactional (static + live proof) and T2 is correctly placed in-tx. Recommend landing Conditions 2 and 4 first to avoid churn on the same files 5b-2 edits.

**Effort:** Cond 1 Short · Cond 2 Short · Cond 3 Medium · Cond 4 Quick · Cond 5 Medium (own step) · Cond 6-7 trivial.

**VERDICT: APPROVE-WITH-CONDITIONS**

**MEMO #13: CLOSED** (Conditions 1-2 discharged and independently re-verified this session — PORT-NOTES #12 + on-conflict.test.ts 8/8 in my own 22/22 bridge run; Condition 3 parity notes carried to PR).

# PART 14 — CLOSURE REVIEW #5: STEP 5b CONCURRENCY ARC + STEP 6 CLI (MEMO #15)

Session 9 (Athena, Memo #15). Scope: Memo #14 Conditions 1/2/4 discharge (5b-1 closure), Step 5b-2 two-tier commit, FM-29 fix per Oracle's FINAL ruling, FM-27 receive side, Step 6 CLI re-verification, incident E record. Evidence: full reads of lock.ts, flush.ts, wake.ts (355 lines), event.ts (commitDurableEvent + runProjectors), input.ts (370 lines), projector.ts (542 lines), history.ts, execution/local.ts, llm.ts (both regions), sql.ts checkpoint table, migration/20260820000000_add_projection_checkpoint.ts, 0000_init.sql:205-209, schema/session-event.ts + schema/event.ts (versionedType), all three PG test files (wake-pg 716 lines, flush-pg 442, wake-receive-pg 424), db.ts (532, DB-domain surfaces), bridge savepoint sources (effect-pg/session.ts:145-173, effect-sqlite/session.ts:145-170); greps (q:any=0, as-any census, pendingSessions/ListenerLayer consumers, Flush.flush consumers); `bun typecheck` core AND opencode re-run by me — both exit 0.

## 14.1 — Decision memo

```
DECISION MEMO #15 — STEP 5b CLOSURE: FM-29/FM-27 RESOLVED AS RULED; MEMO #14 CONDS 1/2/4 DISCHARGED; BUT THE 5b-2 FLUSH TIER IS VACUOUS (FM-30) AND SEPARATES BATCH FROM CHECKPOINT (MEMO #2 COND 3) — REJECT THE FLUSH EXECUTION, KEEP THE STRUCTURE
STATUS: APPROVE-WITH-CONDITIONS
TRIGGER: b (concurrency semantics: FM-29/FM-27 closure) | a (session_projection_checkpoint DDL, SQLite migration) | c (migration cut 20260820000000) | e (NOTIFY listener lifecycle)
VERDICT: APPROVE-WITH-CONDITIONS
```

**PER-ITEM VERDICTS**

- **A (Memo #14 Conds 1/2/4, 5b-1 closure): APPROVE.** Cond 4: lock.ts read — single `as unknown as PgLockable<T>` cast, generic-preserving, identity under SQLite; all four sites replaced (event.ts:279; input.ts:327, :363); grep `q: any` = 0 in src. Cond 2: typecheck re-run by me, core and opencode both exit 0. Cond 1: wake-pg.test.ts read line-by-line — it IS the mandated suite: env-before-dynamic-import with hoisting documented + `expect(isPg).toBe(true)` (:236-244), rollback-suppression NOTIFY via real listener (:247-302), T2 through the real EventV2 pipe with contiguous-seq + event-table row-count non-vacuity (:306-374), exactly-once and concurrent both-succeed zero-double-promotion (:377-591), deterministic savepoint continuation via pre-inserted session_message (:601-690). **Memo #14 Conditions 1, 2, 4: DISCHARGED.**
- **B (Step 5b-2 two-tier commit): REJECT (flush execution semantics); structure carries forward.** Three grounds, all verified this session:
  1. **Memo #2 Cond 3 violation (REJECT-on-sight by my own signed rule):** flush.ts:135-154 runs `runProjectors` and `advanceCheckpoint` as SEPARATE statements with NO `db.transaction` — while event.ts:728-729 and sql.ts:178-179 both COMMENT that the checkpoint advances "in one tx" / "share ONE async transaction (HARD rule)". The code does not implement what three comments claim.
  2. **FM-30 (statically proven):** `runProjectors` looks up `projectors.get(row.type)` with the versioned DB string (event.ts:720) against a map keyed by unversioned `definition.type` (event.ts:691; versionedType at schema/event.ts:94-96, :102). Every lookup misses → the async tier NEVER projects under PG; the checkpoint advances anyway (flush.ts:152) = checkpoint-ahead-of-projection; the lag gauge is pinned to 0 by the very defect it exists to detect. flush-pg 7/7 green is an FM-18/FM-28-class vacuous pass: the tests (which DO mount SessionProjector.node and publish real session events) assert checkpoint arithmetic and never assert projected rows.
  3. **FM-31 (latent, load-bearing for the fix):** repairing the key without a filter re-runs SYNC-tier projectors over already-projected events → `SessionAlreadyProjected` die (projector.ts:285), LifecycleConflict dies (input.ts:112/:127) → flush death spiral → `SessionHistory.load` dies through flush-on-read defect propagation (history.ts:91-95) → PG history unreadable for any real session. The fix MUST filter to `Flush.isAsyncTier(definition.type)`.
  What survives and is APPROVED as landed: checkpoint table both dialects (0000_init.sql:205-209 FK CASCADE, verbatim my PART 2 DDL; SQLite migration matches sql.ts:183-189), async-tier registration seam (projector.ts:463-466), SQLite single-tier collapse with in-tx monotonic-guarded checkpoint (event.ts:396-409), flush-on-read wiring, lagGauge shape, `ses_` guards, sync-tx projector skip (event.ts:359).
- **C (FM-29, Cond 3): APPROVE — RESOLVED per Oracle's FINAL ruling (Option A; decision #5 preserved verbatim).** Verified: claim-then-promote in ONE `db.transaction` (input.ts:306-332, :347-368); `Lock.forUpdateSkipLocked` INSIDE the tx (:327, :363) so locks survive to commit; per-event promotion via nested savepoints in BOTH bridges (`effect_pg_${id}` effect-pg/session.ts:145/:168/:171; `effect_sql_${id}` effect-sqlite/session.ts:145/:165/:168 — rollback-to + release); LifecycleConflict → savepoint rollback → batch continues with ACTUAL promoted count (input.ts:244-279, Effect.exit + Cause.findDefect, all other causes re-thrown); lock order session_input→event_sequence documented inline (:289-305) citing the ruling; transactions orDie'd at source (:333, :369 — the incident-E fix placement, verified against llm.ts:176-199/:372-384: no typed-channel leak remains). FM-29 row updated with Oracle's N-container annotation (no session affinity → cross-process same-session drains are the DEFAULT state; pre-fix backstop converted that race into a crashed drain; post-fix loser claims 0 rows cleanly — proven by the both-Exit.isSuccess concurrent test).
- **D (FM-27, Cond 5 receive side): APPROVE-WITH-CONDITIONS (advisory).** Wired and tested: refcounted LISTEN, unlisten handle retained AND called (wake.ts:163-169, :197-204 — the FM-27 fix proper), per-drain 1500ms+jitter backstop + NOTIFY consumer as forkScoped with scope-finalizer unsubscribe (:311-344), reconnect via postgres-js onlisten → publish → inbox rescan — LISTEN→catch-up→resume with no gap, PROVEN by the pg_terminate_backend test (wake-receive-pg.test.ts:326-397; also resolves Memo #14 UNVERIFIED 2). V2 invariants: process-global SessionExecution, session-ID-based withDrain, no layer takes a Session ID (local.ts:12-62 verified). **FM-27: RESOLVED** (residuals → Conditions 3-5).
- **E (incident): NOTED, no action.** The gate worked as designed; the orDie placement at the transaction source (input.ts) is the correct shape and matches the commitDurableEvent precedent.
- **F (Step 6 CLI): APPROVE.** Sessions panel transcribes my PART 2 gauge verbatim (`es.seq - COALESCE(spc.applied_seq, -1)` db.ts:184; pending FILTER counts :185-186) with AR4 dimensions dialect-split; PG read-only enforced via `SET default_transaction_read_only` on a RESERVED connection (db.ts:327-347 — FM-20 lesson correctly applied: GUC rides the same connection as the query); redaction present at URL surfaces; migrate routes to the advisory-lock PG runner; `data_migration` dump skip-list satisfied by omission (B6.1 kept the table out of the PG bootstrap, so pg_dump cannot encounter it). Cosmetic note: SQLite panel prints n/a for lag where 0 would also be true (checkpoint exists under SQLite now).

**DEVIATION RULINGS (B1-B4, C1-C3, D1-D3)**

- **B1 (SQLite checkpoint without FK to session): ACCEPT.** PG keeps the FK (0000_init.sql:206); SQLite omits it so event-path tests with `ses_`-shaped aggregates and no session row don't fail the in-tx checkpoint write (event.ts:396-409 — under PG that write doesn't exist). Divergence is on a derived-bookkeeping table; PG-side deletes cascade-clean checkpoints, SQLite orphans are benign and replayable. Condition 7: one parity-matrix line documenting the asymmetry.
- **B2 (Text.Delta projector newly registered): ACCEPT.** Registration is required for the async tier to have anything to defer; under SQLite it runs in-tx (single-tier collapse) — a fidelity IMPROVEMENT (deltas previously never projected); under PG it is vacuous until FM-30 is fixed (subsumed by Item B REJECT). Evidence: SQLite suites green (event 44/44, session-projector 12/12).
- **B3 (`startsWith("ses_")` guards on checkpoint writes/flush/lagGauge): ACCEPT.** All durable aggregates are sessions (Memo #14 grep evidence: session-event.ts:40/:46; v1/session.ts:504 — reconfirmed via the Durable manifest read this session). Condition 7: document the invariant — any future non-session durable aggregate must not expect checkpointing, and the guard must not be silently widened.
- **B4 (SQLite migration mechanics): ACCEPT.** `migration/20260820000000_add_projection_checkpoint.ts` creates the table `IF NOT EXISTS` matching sql.ts:183-189 exactly; fresh DBs take it from the schema.up snapshot, existing DBs from the numbered migration — consistent with the Memo #7 runner contract; journal semantics unchanged.
- **C1 (projectPrompted session_message existence check): ACCEPT.** Mirrors projectAdmitted (input.ts:106-112); converts an uncaught PG unique-violation into a typed LifecycleConflict the savepoint machinery already handles — strictly better than the duplicate-key death it replaces. Not on the flush path (Prompted is sync-tier; post-FM-30-fix the flush never re-runs it).
- **C2 (test helper getServiceDb sharing Database.Service's SqlClient): ACCEPT — REQUIRED.** Without shared-connection discipline the FOR UPDATE locks and the projector UPDATEs live on different pooled connections → self-deadlock until statement timeout. The comment documents exactly this (wake-pg.test.ts:148-158). This is a property of the tx semantics, not test convenience.
- **C3 (SQLite per-event top-level tx → one-tx-with-savepoints): ACCEPT.** Whole-batch atomicity strictly improved; observable exactly-once semantics preserved (predicate + savepoint rollback); both bridges' savepoint paths verified at source. No new lock-order hazard under SQLite (single-writer).
- **D1 (dedicated listener postgres-js instance, max:1, idle_timeout:0): ACCEPT — with Step 8 math ruling.** One pinned connection per process, independent of pool churn, no statement-timeout GUCs (correct for a LISTEN connection). **RULING for Step 8 compose:** per-process server connections = pool_max (≤12) + 1 listener — the listener is OUTSIDE the pool max, not inside it (supersedes the Memo #14 Cond 6 phrasing "count against max"); N=8 containers → ≤104 against max_connections=200, headroom preserved for migrations/CLI. Deploy notes must state this arithmetic (Condition 6).
- **D2 (backstopPoll removed, backstopSchedule kept): ACCEPT.** Schedule is consumed by withDrain; the removed helper had no consumer.
- **D3 (`db as any` in notifyInTransaction, `schema: any` in pendingSessions): DEFER — advisory, not blocking.** Both predate this wave (present in my Memo #14 read; Cond 4 scoped the four `.for()` sites only — consistency). But `pendingSessions` now has ZERO consumers (grep) and is the last `any` in the DB layer: DELETE it (preferred — a global pending-scan poller would also violate V2 process-local drains by harvesting remote sessions) or type it; type wake.ts:71 via the Lock-style minimal-interface pattern. Condition 4.

**FLUSH-POOL AMENDMENT (my domain, recorded for Oracle visibility — no counter-sign required):** the landed realization is Semaphore(4) on the SHARED transactional pool; no dedicated flush pool exists and `synchronous_commit=off` is set NOWHERE. I accept this as the staging/beta flush pool: correctness-safer (no durability relaxation), the fast-tier-returns-first property is preserved by post-commit scheduling, and decision #6's constraint ("synchronous_commit=off flush pool only") remains satisfied vacuously. Memo #2 Cond 2 henceforth reads as a TOTAL ban (no connection may set it); Cond 5's "sized separately" is superseded by documenting flush concurrency (4) in deploy notes. A dedicated flush pool with `synchronous_commit=off` remains a Step 8+ performance option, to be re-blessed by memo if taken.

**INVARIANTS**

- "batch+checkpoint same-transaction (Memo #2 Cond 3, REJECT-on-sight)" — **FAIL** (flush.ts:135-154; three comments claim it, code lacks it).
- "checkpoint never ahead of projection" — **FAIL today** (FM-30: checkpoint advances with zero projections).
- "async tier = Text.Delta/Tool.Progress projections only; HARD FENCE: admissions/epoch/usage never async" — **PASS** (membership list correct, projector.ts:463-466; flush surface touches no session_input/epoch/usage statements; B5.2 fence intact — applyUsage call sites all sync-tier).
- "flush-on-read observable via projection-lag gauge" — **PASS mechanically** (history.ts:91-95 + lagGauge), **MASKED in practice** by FM-30.
- "SKIP LOCKED drain arbitration (decision #5)" — **PASS** (FM-29 RESOLVED; in-tx claim verified).
- "Exact-seq via per-aggregate FOR UPDATE" — **PASS** (unchanged, event.ts:279; now through Lock helper).
- "session_input partial index + predicate + unique backstop" — **PASS** (input.ts:315/:356/:162; backstops untouched).
- "NOTIFY tiny payload, self-drop, LISTEN→catch-up→resume; correctness never depends on NOTIFY" — **PASS** (wake.ts receiver; backstop per-drain; reconnect proven).
- V2: admission-before-wake **PASS**; SessionExecution process-global **PASS**; drains process-local **PASS** (per-drain backstop is the correct reading — a global pending-scan poller would harvest remote sessions and violate the clustering boundary); one llm.stream per turn **PASS** (llm.ts:235).
- "event (aggregate_id, seq) unique per partition; replay index" — **PASS** (untouched; 0000_init unmodified, re-verified).

**DURABLE-vs-DERIVED:** the async tier remains 100% derived — no durable write moved to the flush path; the checkpoint stays derived bookkeeping. FM-30's checkpoint-ahead-of-projection corrupts only DERIVED state (replayable from the log) — which is why this is REJECT-and-reland, not a data-integrity emergency.

**TRANSACTION SEMANTICS:** FM-29 fix lock order (session_input→event_sequence) verified with savepoints; flush path has NO lock discipline today (FM-33: no per-session claim; autocommit statements on possibly different pooled connections); fix ordering rule for the re-land: checkpoint-row claim (FOR UPDATE) → project batch → checkpoint advance, all in ONE tx — no cycle (flush never takes session_input/event_sequence locks).

**FAILURE-MODES-UPDATED:** yes — FM-30 (key mismatch, vacuous async tier), FM-31 (latent re-projection storm breaking history reads), FM-32 (unsupervised scheduleFlush), FM-33 (unserialized same-session flushes) appended; FM-27 and FM-29 annotated RESOLVED (FM-29 carries Oracle's N-container annotation verbatim).

**CONDITIONS**

1. (BLOCKING — gates Step 7 DIALECT matrix AND Step 8/9; owner: implementer; Effort: Short-Medium) Re-land the flush execution in `database/flush.ts` + `event.ts runProjectors`: (i) projector lookup by `definition.type` (from `Durable.get(row.type)`), never `row.type`; (ii) skip rows whose definition type is not `Flush.isAsyncTier` (sync-tier events are already projected in-tx; the checkpoint advances over them without re-running anything); (iii) wrap [claim → project batch → checkpoint advance] in ONE `db.transaction` (Memo #2 Cond 3 restored); (iv) claim the checkpoint row `FOR UPDATE` at flush start (per-session serialization, FM-33); (v) supervise `scheduleFlush`'s fork — log defects with sessionID (FM-32); (vi) flush-on-read degrades (log + serve with lag visible in the gauge) instead of dying on projector defects (FM-31's read-path blast radius). Delete or reconcile the three "one tx" comments.
2. (BLOCKING for Condition 1's discharge; owner: implementer; Effort: Short) Flush-tier regression tests asserting PROJECTION OUTCOMES under PG: publish Text.Delta + Tool.Progress through the real EventV2 pipe with SessionProjector mounted → assert session_message/part rows MATERIALIZED by the flush (row-count + content), lag drains to 0, double-flush idempotent, concurrent same-session flushes non-duplicating, and one sync-tier-heavy session (Created + PromptAdmitted) flushes WITHOUT projector death (FM-31 guard). FM-18/28 discipline: checkpoint-arithmetic-only asserts are insufficient evidence for this tier.
3. (Advisory, Quick; owner: implementer) wake.ts subscribe/unlisten race: if `ensureListening`'s meta resolves after the entry was deleted (fast subscribe/unsubscribe), call `unlisten()` immediately instead of dropping the handle (leaked LISTEN slot).
4. (Advisory, Quick; owner: implementer) Delete `pendingSessions` (zero consumers; a global poller would violate process-local drains) or type it; type wake.ts:71 `db as any` via the Lock-style minimal-interface pattern. Zero `any` in the DB layer is the standing end state.
5. (Advisory, Quick; owner: implementer) pgListenerLayer import failure currently returns `subscribe: () => Effect.die("postgres unavailable")` — degrade to backstop-only (no-op listener) instead of killing drain start.
6. (BLOCKING for Step 8 compose merge; owner: implementer + deploy notes) Connection math documented: per-process = pool_max (min(1.5×sessions, 12)) + 1 pinned listener; flush concurrency = Semaphore(4) on the shared pool; N-container worst case vs max_connections=200 stated in the compose deploy notes (D1 ruling; carries Memo #14 Cond 6 forward as amended).
7. (Advisory, Quick; owner: me at next matrix pass) Parity matrix: one line for the checkpoint FK asymmetry (B1) and one for the `ses_`-guard invariant (B3).

**UNVERIFIED**

1. UNVERIFIED: whether `SessionMessageUpdater` delta application is idempotent under re-execution — moot once Condition 1(iii) lands (same-tx makes replay apply-once), but cheapest resolve while testing Condition 2: assert double-flush produces identical session_message.data content.
2. UNVERIFIED: postgres-js ListenRequest promise-resolution semantics beyond the passing tests (handle retained, unlisten honored) — cheapest resolve: none needed; behavior is test-proven (wake-receive-pg 7/7 ×2).
3. UNVERIFIED: full-suite re-run counts (68/68, 10/10, 7/7 ×2 etc.) — orchestration-verified reports; cheapest resolve: PR-time dual-dialect CI with `TEST_DATABASE_URL` exported, per standing FM-18/28 discipline. Note the PG greens partially DEPEND on FM-30 (a working flush would fail the current flush-pg assertions) — Conditions 1+2 must land together and the suite re-run.

**ORACLE-COUNTER-SIGN:** not-required — the Item B REJECT enforces MY OWN signed condition (Memo #2 Cond 3) and locked decision #6 semantics; no baseline change, no new dependency, no V2 semantics change (the flush tier is derived-state machinery). VISIBILITY for Oracle's next pass: (i) Step 7 must not start its DIALECT matrix until Conditions 1+2 land — the PG leg would certify a vacuous async tier; (ii) the flush-pool amendment (semaphore-on-shared-pool, synchronous_commit=off banned everywhere) is recorded above for visibility; (iii) FM-29 row now carries Oracle's N-container annotation verbatim per his ruling.

**Effort:** Cond 1 Short-Medium · Cond 2 Short · Conds 3-5 Quick each · Cond 6 Quick (notes) · Cond 7 Quick (mine).

**MEMO #14: CLOSED** — Cond 1 DISCHARGED (suite verified line-by-line), Cond 2 DISCHARGED (typecheck re-run exit 0 both packages), Cond 3 DISCHARGED per Oracle's FINAL ruling (verified in source + tests), Cond 4 DISCHARGED (lock.ts verified), Cond 5 DISCHARGED (FM-27 RESOLVED). Cond 6 carried forward as amended by the D1 ruling (Condition 6 above). Cond 7 (channelName UTF-16 vs bytes) NOT discharged by this wave — the listener landed without an ASCII assert or byte-slice; carried as advisory (IDs are ASCII by schema today; cheapest resolve: one expect in the wake-receive test asserting `/^[\x20-\x7e]*$/` on channelName outputs, fold into Condition 4's Quick).

**VERDICT: APPROVE-WITH-CONDITIONS**

**Item B verdict line (greppable): VERDICT: REJECT (flush execution only — FM-30/FM-31 + Memo #2 Cond 3; structure retained; re-land per Conditions 1-2).**

# PART 15 — CLOSURE REVIEW #6: MEMO #15 DISCHARGE + TEXT.DELTA DURABILITY RULING (MEMO #16)

Session 10 (Athena, Memo #16). Scope: discharge of Memo #15 Conditions 1-5, Memo #14 Cond 7 fold, B2 record correction, Text.Delta durability ruling, FM-30/31/32/33 closure, Step 7/8/9 gate status. Evidence: full reads this session of flush.ts (239 lines), wake.ts (351 lines), event.ts :160-560 + :560-772 (commitDurableEvent, publishEvent/notify, runProjectors), history.ts :60-146, projector.ts :400-484 (registration block), schema/session-event.ts :1-100 + :150-269 + :440-469 (options, Text/Reasoning namespaces, DurableDefinitions inventory), schema/durable-event-manifest.ts (15 lines), schema/event.ts durable() grep (:98-103 filter), db.ts (opencode CLI) :176-200 panel; greps: pendingSessions=0 repo-wide, ASCII assert wake-receive-pg.test.ts:152-163, flush-pg/wake-pg test inventories; `bun typecheck` packages/core re-run BY ME — exit 0. Test bodies read at assertion level (flush-pg.test.ts :285-574).

## 16.1 — Decision memo

```
DECISION MEMO #16 — MEMO #15 CONDS 1-5 + MEMO #14 COND 7 DISCHARGED AND VERIFIED; FM-30/31/32/33 RESOLVED; TEXT.DELTA RULED LIVE-ONLY-BY-DESIGN — DEAD REGISTRATIONS ORDERED REMOVED (OPTION a); B2 RATIONALE CORRECTED
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: b (flush concurrency semantics discharge) | e (listener lifecycle folds) | record correction on a prior B-ruling
VERDICT: APPROVE-WITH-CONDITIONS
```

**PER-CONDITION DISCHARGE (Memo #15)**

- **Cond 1 (six sub-items): PASS, all six.** (i) FM-30 key fix — event.ts:724 `Durable.get(row.type)` resolves the definition, :737 `projectors.get(definition.type)` looks up by the UNVERSIONED key matching the registration map (:691). (ii) FM-31 filter — event.ts:728 `if (!Flush.isAsyncTier(definition.type)) continue`; sync-tier rows advance the checkpoint without re-running anything. (iii) Memo #2 Cond 3 restored — flush.ts:197-212 is ONE `db.transaction`: claimCheckpoint (:199) → runProjectors (:209) → advanceCheckpoint (:210); the "one tx" comments (flush.ts:23, :65-66, :170; event.ts:744-747) are now truthful. (iv) FM-33 — flush.ts:133-166: `ensureCheckpointRow` (insert-if-absent applied_seq=-1, onConflictDoNothing, :140-144) + `Lock.forUpdate` claim (:161) inside the tx; lock order checkpoint-row → project → advance documented (:174-177); flush takes NO session_input/event_sequence locks → no cycle with the drain path (session_input → event_sequence). Insert-then-claim chosen over claim-via-upsert so FOR UPDATE is the single serialization point — correct. (v) FM-32 — flush.ts:225-238: fork with `Effect.catchDefect` → `Effect.logError("Flush defect", defect)` + `annotateLogs({sessionID})` → asVoid; log-and-stop, no retry loop. (vi) FM-31 read path — history.ts:98-108: catchDefect → "Flush-on-read defect; serving read with lag" → serves the read; lag stays visible in the gauge.
- **Cond 2 (projection-outcome tests): PASS.** flush-pg.test.ts:296-372 asserts CONTENT (structured `{}` → `{progress:"50%"}`, content text `"running..."`, status `"running"`) + non-vacuity (session row, seq=3) + lag→0 + checkpoint=3; :378-435 double-flush idempotent with byte-identical `JSON.stringify(session_message.data)` (:422) — **Memo #15 UNVERIFIED 1 RESOLVED**; :440-502 concurrent same-session flushes → checkpoint 3, exactly 1 session_message row (:494-495), structured appears once, lag 0 (FM-33); :510-562 two PromptAdmitted (sync-tier) → flush survives, checkpoint advances to 1 (FM-31 guard; fails if the filter is missing). isPg sanity retained (:285-289, :567-574). **Correction to my own mandate:** Cond 2 as written said "publish Text.Delta + Tool.Progress" — the Text.Delta half was UNSATISFIABLE (Text.Delta is live-only, never enters the log; see 16.2) and inherited the same wrong belief as B2. The Tool.Progress-only realization is the correct and sufficient discharge.
- **Cond 3 (unlisten race): PASS.** wake.ts:182-190 — meta resolving after entry deletion calls `handle?.unlisten().catch(() => void 0)` immediately; no leaked LISTEN slot.
- **Cond 4 (pendingSessions + any): PASS.** `pendingSessions` — zero grep matches repo-wide (deleted; the V2-correct outcome: no global poller harvesting remote sessions). `notifyInTransaction` typed via `RawRunner` minimal interface (wake.ts:68-70) with a single documented `as unknown as` (:80) — Lock-style. No `db as any` remains in the DB layer.
- **Cond 5 (listener import failure): PASS.** wake.ts:141-151 — `catch: () => null` → no-op listener (backstop-only); no `Effect.die("postgres unavailable")` in the path. Correct reading of Memo #1: NOTIFY is latency, backstop is correctness.
- **Memo #14 Cond 7 (ASCII fold): PASS.** wake-receive-pg.test.ts:152-163 — `/^[\x20-\x7e]*$/` asserted across channelName outputs. **RESOLVED.**
- **Cond 6 (Step 8 compose math): READY — formalized as Condition 2 below.** Cond 7 (parity matrix lines B1/B3) remains MINE, open, next matrix pass.
- **Independent evidence:** typecheck packages/core exit 0 (my own run this session). Verifier's dual-dialect suite counts (flush-pg 7/7 ×2, wake-pg 9/9 — the pendingSessions SQLite no-op test removed, intended end state, wake-receive-pg 8/8, database-pg 11/11, SQLite 95/95) accepted as orchestration-verified; PR-time CI remains the standing resolve (FM-18/28 discipline). `0000_init.sql` untracked-unmodified — bootstrap untouched, as required.

## 16.2 — TEXT.DELTA RULING (Option a) + B2 RECORD CORRECTION

**The trace, verified at source this session:** schema/session-event.ts:210-218 defines Text.Delta WITHOUT `...options` (options = `{durable:{aggregate:"sessionID", version:1}}`, :38-43); the comment (:209) states the design intent: "Stream fragments are live-only; Text.Ended is the replayable full-value boundary." schema/event.ts:98-103 — `Event.durable()` drops definitions with `!definition.durable`, so Text.Delta is NOT in the Durable map (and absent from DurableDefinitions, session-event.ts:448-469, which lists Text.Started/Text.Ended only). core event.ts:443-467 — `publishEvent` routes non-durable definitions straight to `notify` (:467), and `notify` (:480-491) publishes to listeners/typed-pubsub/all WITHOUT consulting the `projectors` map. Therefore Text.Delta never enters the event log and never runs a projector — under BOTH dialects (durability is a definition property, not a dialect property). Its registration pair (projector.ts:463-464: `events.project(Text.Delta, ...)` + `Flush.registerAsyncTierType`) is provably INERT, as is the sync-skip it would trigger (event.ts:359) and the flush lookup it would feed. Corroborating asymmetry: Reasoning.Delta (session-event.ts:248-256, identically live-only) was never registered at all.

**B2 CORRECTION (Memo #15 PART 14, B2):** my acceptance rationale — "under SQLite it runs in-tx (single-tier collapse) — a fidelity IMPROVEMENT (deltas previously never projected)" — was WRONG. Under SQLite Text.Delta equally never reaches a projector (same notify-only routing). The acceptance OUTCOME survives (inert = harmless; nothing regressed), but B2 is hereby re-recorded as MOOT-AND-CORRECTED: the registration was never live under either dialect, and Memo #2's async-tier membership prose ("Text.Delta, Tool.Progress") described an event that cannot reach the tier.

**OPTIONS considered:**
- **(a) Intended end state — async tier = Tool.Progress only; remove the dead registrations.** Pros: eliminates the belief-reality divergence at exactly the FM-30 failure class (comments in flush.ts:18-19/:37-39 and projector.ts:459-462 claim a Text.Delta deferral that cannot occur); zero behavior change (provably dead in both dialects); tests already target the real async-tier event. Cons: none material; two-line removal plus comment edits.
- **(b) Make Text.Delta durable (schema change).** REJECTED on merits, not merely on scope: durable deltas would log one row per stream fragment — event-table/WAL/index bloat and replay-cost regression — and would blur the durable-vs-derived line the schema comment already draws correctly (Text.Ended carries the full value; the log's truth unit for text is the Ended boundary, and session_message text content must not flap with partial fragments). Would additionally be a schema-package change requiring its own memo + Oracle counter-sign. If a future requirement genuinely needs durable deltas (e.g., cross-process mid-stream resume), that is a NEW memo (trigger b) — and the machinery left behind by (a)'s removal is small, well-understood, and re-addable deliberately.
- **(c) Keep registrations as inert forward-compat.** REJECTED: keeps a false belief encoded in code and three comment sites; forward-compat that no test can exercise is exactly how FM-30 happened (vacuous green). The invariant is better enforced by absence + a documented rule than by dead code.

**RULING: (a).** Text.Delta (and, by the same rule, any future `*.delta` live-only fragment event) is live-only BY DESIGN; Text.Ended is the durable replay boundary for text; the async tier is Tool.Progress only. Conditions 1(g-h).

**Lag-gauge and `db status --sessions` interpretation (ruling requested):** the gauge (`es.seq - COALESCE(spc.applied_seq, -1)`, flush.ts:91-115; panel db.ts:184 — verified unchanged) counts ALL durable session events not yet checkpoint-advanced, while the WORK gated by the flush is Tool.Progress materialization ONLY. Therefore: (i) transient lag > 0 after every commit is NORMAL under PG (scheduleFlush is fire-and-forget; the flush advances over sync-tier rows without work); (ii) persistent or growing lag = broken flush tier (FM-30-class defect, projector death, or starvation); (iii) the only user-visible staleness persistent lag can cause is Tool.Progress part content — text NEVER lags (Text.Started/Text.Ended, Step, Tool settlement all project in the sync commit tx); (iv) under SQLite the gauge is structurally 0 (in-tx checkpoint, event.ts:396-409). The panel query itself needs NO change; the interpretation line goes into the deploy notes (Condition 2).

**INVARIANTS**

- "batch+checkpoint same-transaction (Memo #2 Cond 3, REJECT-on-sight)" — **PASS** (flush.ts:197-212; comments reconciled).
- "checkpoint never ahead of projection" — **PASS** (same-tx advance; FM-30 fixed — lookup by definition.type, proven by content-level materialization test).
- "async tier = Tool.Progress only (as ruled here); HARD FENCE: admissions/epoch/usage never async" — **PASS** (projector.ts:463-466; applyUsage call sites sync-tier, unchanged from Memo #15 verification).
- "flush-on-read degrades, lag visible" — **PASS** (history.ts:98-108).
- "per-session flush serialization (FM-33)" — **PASS** (in-tx insert-then-claim FOR UPDATE; concurrent test).
- "SKIP LOCKED drain arbitration; exact-seq FOR UPDATE; session_input predicate + backstops" — **PASS** (untouched this wave; event.ts:279, input.ts per Memo #15).
- "NOTIFY tiny payload, self-drop, LISTEN→catch-up→resume; correctness never depends on NOTIFY" — **PASS** (wake.ts; folds strengthen: unlisten race fixed, import-failure degrades to backstop-only).
- "event log is the only truth; deltas are live-only" — **PASS and now correctly encoded** (pending Condition 1 removal).
- V2: admission-before-wake, process-global SessionExecution, process-local drains, one llm.stream — **PASS** (untouched; pendingSessions deletion REMOVES a would-be V2-violating global poller).

**DURABLE-vs-DERIVED:** the ruling STRENGTHENS the line — live-only stream fragments stay out of the durable log; Text.Ended remains the replay boundary; the async tier materializes derived state (Tool.Progress parts) from durable rows only.

**TRANSACTION SEMANTICS:** flush tx = claim (FOR UPDATE on checkpoint row) → project → advance, no session_input/event_sequence locks → acyclic vs drain path (session_input → event_sequence). Semaphore(4) bounds flush concurrency on the shared pool (flush-pool amendment unchanged; synchronous_commit=off banned everywhere).

**FAILURE-MODES-UPDATED:** yes — FM-30 RESOLVED (key fix + content-level regression), FM-31 RESOLVED (filter + read-path degrade + guard test), FM-32 RESOLVED (supervised fork), FM-33 RESOLVED (in-tx claim + concurrent test); FM-34 appended (dead Text.Delta registrations + false membership comments — latent belief-divergence, inert today); Memo #15 UNVERIFIED 1 → RESOLVED; Memo #14 Cond 7 → RESOLVED (FM-annotated in the test).

**CONDITIONS**

1. (Non-blocking for Step 7; MUST land before Step 8 deploy-notes freeze; owner: implementer; Effort: Quick) Execute ruling (a): delete projector.ts:463-464 (`events.project(SessionEvent.Text.Delta, ...)` + `Flush.registerAsyncTierType(SessionEvent.Text.Delta.type)`); correct the membership comments to "Tool.Progress only" (flush.ts:16-19, :37-39; projector.ts:459-462); add one line to the session-event.ts :209 comment: deltas are never durable, never projected, never flushed (extend to the Reasoning.Delta comment :247 for symmetry). Re-run flush-pg + session-projector suites both dialects (expect green, zero behavior change).
2. (BLOCKING for Step 8 merge; owner: implementer + deploy notes; Effort: Quick) Compose math as deploy-note text, per D1 ruling as amended: per process = pool_max (min(1.5×sessions, 12)) + 1 pinned LISTEN connection (OUTSIDE the pool max) [+1 transient reserved connection while `opencode db status` runs]; flush concurrency = Semaphore(4) on the SHARED pool (no extra connections; synchronous_commit=off set NOWHERE); N=8 containers → ≤ 8×12 + 8 = ≤104 steady vs max_connections=200, headroom ≥96 for migrations/CLI/transients. Include the lag-gauge interpretation lines from 16.2 (transient-vs-persistent; Tool.Progress-only staleness; SQLite structurally 0).
3. (Advisory, mine, next matrix pass — carried) Memo #15 Cond 7 parity-matrix lines: checkpoint FK asymmetry (B1) and `ses_`-guard invariant (B3); add a third line: Text.Delta/`*.delta` live-only rule (this memo).
4. (Standing) PR-time dual-dialect CI with TEST_DATABASE_URL exported (FM-18/28 discipline) before Step 9 sign-off.

**UNVERIFIED**

1. UNVERIFIED: full-suite green under the CURRENT tree (verifier reports flush-pg 7/7 ×2, wake-pg 9/9, wake-receive-pg 8/8, database-pg 11/11, SQLite 95/95 — orchestration-verified, and the load-bearing flush tests were read BY ME at assertion level) — cheapest resolve: Condition 4 CI.
2. UNVERIFIED: nothing else material. (postgres-js listen semantics: test-proven per Memo #15; UNVERIFIED 2 there stands resolved.)

**ORACLE-COUNTER-SIGN:** not-required — discharge verification is DB-domain; the Text.Delta ruling REJECTS a re-scope rather than opening one (option (b) would have required counter-sign; it is rejected on durable-vs-derived merits); no baseline change, no new dependency, no V2 semantics change; effort Quick. VISIBILITY for Oracle's next pass: (i) **Step 7 DIALECT matrix is UNBLOCKED** — Memo #15's blocking Conditions 1+2 are discharged and verified; the PG async tier is real and content-level-proven; (ii) B2 rationale corrected in the record (outcome unchanged); (iii) if Oracle nevertheless wants durable deltas, that verdict SUPERSEDES this ruling via a new memo (trigger b, schema package).

**Effort:** Cond 1 Quick · Cond 2 Quick (notes) · Cond 3 Quick (mine) · Cond 4 standing.

**VERDICT: APPROVE-WITH-CONDITIONS**

# PART 16 — CLOSURE REVIEW #7: STEP 7 DISCHARGE (DIALECT MATRIX + GUARDS + CI) + POST-LANDING INCIDENT CLUSTER (MEMO #17)

Session 11 (Athena, Memo #17). Scope: Step 7 D0-D3 discharge per Memo #16 Cond 1 + Step 7 unblock; post-landing defect-cluster incident review; mutual-exclusion design-deviation ruling; Reasoning.Delta comment-extension ruling; latent SQLite-as-PG miscast ruling; MY parity-matrix checkmarks (Memo #15 Cond 7 / Memo #16 Cond 3 — EXECUTED this session, PART 3); FM table updates; Step 8 gate status. Evidence — full reads this session: dialect-matrix.test.ts (800 lines), grep-guard.test.ts (145), .github/workflows/pg-test.yml (106); cited regions: projector.ts:459-465, flush.ts:16-40/:95/:197, schema/session-event.ts:195-265 (both Delta comments), 0000_init.sql:200-212, event.ts:390-440 (both `ses_` guard sites); FM-28b static-chain trace at source: pg.bun.ts imports (clean — postgres/bridge/effect/`./pg` tag only), `./pg` (Context tag + type-only bridge ref), effect-drizzle-pg src (no database/database imports), session/event.ts (type-only re-export), session/input.ts:8 → database/lock.ts:3 (`isPg` RUNTIME value import) — the chain that found instance (3); test.yml grep (`bun turbo test`, no TEST_DATABASE_URL), packages/core/package.json (`#pg` mapping, test script), drizzle.config.ts (push-ban rationale). MY OWN PROBES: `shasum -a 256 .opencode/db-migrations/0000_init.sql` = `818ee1a9...422fb3` — byte-identical to the guard constant; `bun typecheck` packages/core exit 0 AND packages/opencode exit 0; ephemeral postgres:17-alpine on port 25471 (docker ps pre-checked clean): dialect-matrix PG leg **10/10 in 21.27s** (isPg sanity green, genuine execution), grep-guard **7/7** (239ms), dialect-matrix SQLite leg (no env) **10/10** (2.02s); **negative control** (dead-port TEST_DATABASE_URL): **5 PG tests FAIL with connect errors / 5 SQLite early-returns pass** — no silent no-op path remains; container removed, 0 left running.

## 17.1 — Decision memo

```
DECISION MEMO #17 — STEP 7 DISCHARGED (D0-D3 ALL VERIFIED); INCIDENT CLUSTER FIXED AND INDEPENDENTLY REPRODUCED; MUTUAL-EXCLUSION LEGS RULED CORRECT (TWO-PROCESS CI IS ALREADY THE LANDED SHAPE — HARDEN WITH AN EXPLICIT SQLITE-LEG STEP); NEW LATENT FM-28b INSTANCE FOUND IN session-pg-roundtrip (isPg FROZEN FALSE, STATICALLY PROVEN); PARITY LINES ATHENA-VERIFIED
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: c (Step 7 gate) | b-adjacent (PG-leg test concurrency semantics — incident + deviation rulings)
VERDICT: APPROVE-WITH-CONDITIONS
```

**PER-ITEM VERDICTS**

- **D0 (Memo #16 Cond 1, Text.Delta removal): DISCHARGED.** projector.ts:459-465 — registration pair deleted; Tool.Progress only, with the ruling comment ("live-only by design — never durable, never projected, never flushed"). flush.ts:19-20/:40 — membership comments corrected to Tool.Progress. session-event.ts — ruling comments on BOTH Delta definitions (see Ruling 3).
- **D1 (matrix): DISCHARGED.** 5 surfaces × 2 dialects; header doc verified accurate against source (B1 cites 0000_init.sql:206 = the exact FK line; B3 guard sites verified flush.ts:95/:197 + event.ts in-tx/scheduleFlush; Text.Delta line matches my Memo #16 ruling). Both legs executed BY ME against live PG (10/10, 21.27s, isPg sanity green) and SQLite (10/10). Surface 4 PG is exit-observed AND rollback-verified (`persisted` undefined). Surface 3's `Number(checkpoint)===3` is genuinely correct: 4 events (seqs 0-3), checkpoint = last projected seq — no off-by-one; I read the assertions and accept the fix agent's verification (it did not paper over a defect). Coercion at the ASSERTION for PG bigint-strings is the right shape — codecs untouched, dialect truth preserved.
- **D2 (guard): DISCHARGED.** 7/7 by my own run; the sha256 freeze constant is byte-verified by my own hash. AR5, drizzle-kit push, (q:any), as-any (sqlite.bun.ts excluded per my scoping), @ts-ignore, Text.Delta ban — patterns read; comment-aware grep logic read. Two scope notes → Condition 6 (push-guard breadth vs its header claim; grepCodeOnly's first-`//` truncation is conservative-direction only — could under-report on URL-containing strings, acceptable for current patterns, document it).
- **D3 (CI): DISCHARGED.** pg-test.yml read line-by-line: exit code preserved (set +e → $? → set -e, :78-81), zero-test=fail (:86-90) AND failing-test=fail (:91-95), bounded 30×1s health gate with explicit failure and cleanup on every exit path (:48-60). 6 suites enumerated (:67-74).
- **Incident cluster (module-gating / bigint shapes / CI swallow / dead-connection): FIXED, all four verified.** (1) FM-28b fix read at source: ZERO static runtime imports of core modules in the matrix (the remaining static imports — bun:test, drizzle-orm, effect, `#pg`, effect-drizzle-pg — traced clean: none transitively evaluates database.ts); all bindings via dynamic import after the env decision (:136-217). (2) bigint coercion at assertion — see D1. (3) CI exit preservation — see D3. (4) pgTest composes boot+setup+body in ONE Effect/scope (:267-282) — the dead-reference fix, correct shape. Post-fix evidence independently reproduced by me (10/10 live, negative control). The verifier's honesty in declaring the never-run leg is this discipline working, not a failure of it.

**RULING 2 — Mutually-exclusive legs vs two-process CI.** OPTIONS: (i) accept per-process mutual exclusion with the AS-LANDED two-workflow pairing (test.yml `bun turbo test` without TEST_DATABASE_URL covers the SQLite leg CI-side; pg-test.yml covers the PG leg); (ii) same semantics + harden pg-test.yml with an EXPLICIT SQLite-leg step so both dialects gate in ONE authoritative workflow; (iii) reject — demand both legs in one process. **RULING: (ii) over (i); (iii) REJECTED on merits.** The constraint is physics, not sloppiness: database.ts freezes `isPg` at module scope (blessed Step 2 design, Memo #9 lineage); one process = one dialect; the isPg VALUE is imported by lock.ts/event.ts and consumed throughout — per-layer dialect injection would be a wide-blast-radius refactor of blessed dispatch for zero correctness gain. Step 7's intent ("Core suites green on both dialects") is SATISFIED by two processes: every push/PR runs the SQLite leg (test.yml) and the PG leg (pg-test.yml). Residual risk in (i) alone: the SQLite leg's CI coverage depends on turbo invoking core's `bun test --only-failures` on a fresh runner (UNVERIFIED 1) and on the two workflows not drifting apart — Condition 4 (explicit SQLite-leg step in pg-test.yml) makes both legs gate in one file and moots the uncertainty.

**RULING 3 — Reasoning.Delta comment extension: APPROVE; not a deviation.** My Memo #16 Cond 1 explicitly mandated it: "(extend to the Reasoning.Delta comment :247 for symmetry)". Verified executed: both definitions carry the ruling; the sibling's shorter text (no "no projector registration" line) is CORRECT — Reasoning.Delta never had a dead registration (corroborating asymmetry, Memo #16 §16.2). The rule generalizes as recorded in PART 3 rule 3: any future `*.delta` live-only fragment event is covered.

**RULING 4 — latent SQLite-as-PG miscast: FM-35 (named, this session; table updated).** Not subsumed: the lesson is distinct from FM-28b (env/module-eval gating) — this is TYPE-SYSTEM FABRICATION in tests, invisible precisely because the gated leg never executed; the same camouflage class as FM-30's vacuous green but in test code. Guard: real `*.sql.pg` imports in PG legs + the executed-leg proof standard (isPg sanity + row-count non-vacuity + negative control). The residual `db as unknown as DbShape` casts in the matrix are test-scope, now executed-for-real, and accepted (documented in the FM-35 row).

**RULING 5 — parity checkmarks (Memo #15 Cond 7 / Memo #16 Cond 3): EXECUTED.** PART 3 now carries the three PARITY RULES lines marked ATHENA-VERIFIED 2026-08-20 with evidence (B1 live-verified both dialects; B3 guard sites source-verified + live; `*.delta` rule source-verified + guard-enforced). The test-header copy (:18-26) verified accurate; one wording note — the header's B3 line omits my "guard must not be silently widened" clause; PART 3 carries the full clause; non-blocking, Condition 5 folds the tick + optional clause into a comment-only edit (I do not touch implementation files).

**NEW FINDING (mine, this session) — session-pg-roundtrip.test.ts is FM-28b instance (3), LATENT.** Static chain, proven at source: `import { SessionInput } from "@opencode-ai/core/session/input"` (:33, runtime) → input.ts:8 `import { Lock } from "../database/lock"` (runtime) → lock.ts:3 `import { isPg } from "./database"` (RUNTIME VALUE import) → database.ts evaluates at static-hoist time with DATABASE_URL unset (the file reads TEST_DATABASE_URL only for pgLayer, :52, never copies it to process.env.DATABASE_URL) → **isPg frozen false process-wide while connected to PG**. The suite passes because it has NO isPg sanity assert and its exercised paths degrade silently — Lock takes the identity/no-lock fallback instead of FOR UPDATE/SKIP LOCKED on the admit path. Its core purpose (H-1 timestamp shape verification) remains genuinely tested (connection-level), so this is NOT a Step 7 blocker — but the file's PG-gated name overstates what it proves, and instance-count 3 triggers the escalation: mechanical guard (Condition 3), sanity asserts everywhere (Condition 2), fix (Condition 1). Production is UNAFFECTED (real processes set DATABASE_URL before import; the hazard is test-file static-import + runtime-env-copy only). database-pg.test.ts is CLEAN by absence — its only static core import (migration.pg) has a clean chain (node builtins + effect), and it never imports database.ts.

**INVARIANTS**

- "event (aggregate_id, seq) unique per partition; replay index equivalent" — **PASS** (untouched; 0000_init byte-frozen, hash verified by my own run).
- "session_input partial index + predicate + unique backstop" — **PASS** (untouched this wave; standing from Memo #16).
- "session_message history pagination index" — **PASS** (untouched).
- "NOTIFY tiny payload, self-drop, LISTEN→catch-up→resume" — **PASS** (untouched; wake.ts folds standing from Memo #16).
- "Migration apply: pg_advisory_lock(727274) via client.reserve, released in finalizer" — **PASS** (untouched; bootstrap frozen + guard-enforced).
- "async tier = Tool.Progress only; HARD FENCE: admissions/epoch/usage never async" — **PASS and mechanically guarded** (grep-guard Text.Delta ban; registrations absent, verified).
- "checkpoint never ahead of projection; batch+checkpoint one tx" — **PASS** (standing from Memo #16; matrix Surface 3 exercises it live: checkpoint=3 with real projections).
- V2: admission-before-wake, process-global SessionExecution, process-local drains, one llm.stream — **PASS** (untouched; test-only wave).

**DURABLE-vs-DERIVED:** untouched — the wave tests and documents; the parity rules record a derived-bookkeeping asymmetry (B1) without weakening the durable line; `*.delta` rule keeps live fragments out of the log (Memo #16 ruling, now encoded in PART 3).

**TRANSACTION SEMANTICS:** no production tx changed. Matrix Surface 1 exercises T2 exact-seq contiguity live (both dialects); Surface 3 exercises the single-tx flush claim→project→advance (checkpoint=3 = last projected seq, no off-by-one). pgTest single-scope composition preserves connection lifetime correctness for the whole test body.

**FAILURE-MODES-UPDATED:** yes — FM-28 instance ledger (3 static-freeze instances; escalation to mechanical guard); FM-18 annotated (CI landed: zero-test=fail + failing-test=fail + negative control proven); FM-34 row APPENDED (repairing Memo #16's claimed-but-unexecuted append — record-integrity fix, noted in the row); FM-35 appended (double-cast vacuous parity, RESOLVED-by-incident-fix).

**CONDITIONS**

1. (BLOCKING for Step 9 sign-off; owner: implementer; Effort: Short) Fix FM-28b instance (3): convert session-pg-roundtrip.test.ts's runtime core imports to `import type` + dynamic-import bindings after `process.env.DATABASE_URL = TEST_DATABASE_URL` (the matrix pattern, :129-217); add `expect(isPg).toBe(true)` sanity (it will fail today — that is the point; UNVERIFIED 3's cheapest resolve). Post-fix: re-run vs live PG and confirm the Lock paths the file exercises are the PG ones (FOR UPDATE/SKIP LOCKED, not the identity fallback).
2. (Required with Cond 1; owner: implementer; Effort: Quick) isPg sanity asserts in EVERY PG-gated test file whose import closure reaches database.ts (wake-pg, flush-pg, dialect-matrix already have it; session-pg-roundtrip via Cond 1; database-pg exempt — clean by absence). Plus SQLite-leg guard: `expect(isPg).toBe(false)` at the top of dialect-matrix's SQLite tests (an ambient DATABASE_URL in a dev shell currently poisons the SQLite leg — Database.node resolves PG; loud-but-confusing failure today, instant-clear failure with the assert).
3. (BLOCKING as the recurrence guard for Cond 1's class; owner: implementer; Effort: Quick) Extend grep-guard.test.ts: in PG-gated test files (`test/*-pg.test.ts`, `test/dialect-matrix.test.ts`), ban static RUNTIME (non-`import type`) imports of `@opencode-ai/core/**` modules whose transitive closure reaches database.ts — practical enforceable shape: ban all non-type `@opencode-ai/core` imports in those files except an explicit documented allowlist of provably-clean modules (database/migration.pg, schema-pg-namespace, `*.sql.pg`, `*/schema`, session/message, schema). This mechanically prevents instance (4).
4. (Required for Step 9; owner: implementer; Effort: Quick) pg-test.yml: add an explicit SQLite-leg step (clean env, TEST_DATABASE_URL unset) running dialect-matrix + grep-guard under the same zero-test/failing-test rules — both dialects gated in ONE authoritative workflow; resolves UNVERIFIED 1 (turbo/`--only-failures` coverage) by making it moot.
5. (Quick; owner: implementer; comment-only) Tick the ATHENA-VERIFIED column in dialect-matrix.test.ts:35 (reference Memo #17 / memos PART 3); optionally extend the B3 header line with "the guard must not be silently widened".
6. (Advisory, Quick; owner: implementer) grep-guard scope notes: extend the drizzle-kit push ban beyond drizzle.config.ts (package.json scripts, scripts/**) to match the guard's own header claim; add a one-line comment documenting grepCodeOnly's first-`//` truncation weakness (conservative direction; URLs in strings).
7. (Carried UNCHANGED, BLOCKING for Step 8 merge; owner: implementer + deploy notes; Effort: Quick) Memo #16 Cond 2: compose deploy-notes text — per process = pool_max (min(1.5×sessions, 12)) + 1 pinned LISTEN connection (OUTSIDE the pool max) [+1 transient reserved while `opencode db status` runs]; flush concurrency = Semaphore(4) on the SHARED pool (no extra connections; synchronous_commit=off set NOWHERE); N=8 containers → ≤ 8×12 + 8 = ≤104 steady vs max_connections=200 (headroom ≥96); plus the lag-gauge interpretation lines (transient-vs-persistent lag; only Tool.Progress part content can be stale; SQLite structurally 0).

**UNVERIFIED**

1. UNVERIFIED: whether test.yml's `bun turbo test` actually executes packages/core's suite (and thus the dialect-matrix SQLite leg) on a fresh CI runner given core's `bun test --only-failures` script — cheapest resolve: Condition 4 makes it moot; else inspect one CI log for the core test count.
2. UNVERIFIED: pg-test.yml loop behavior on a REAL failing suite/zero-test on the GitHub runner (exit-preservation logic read line-by-line and simulated by the orchestrator; not executed by me on GitHub) — cheapest resolve: first real PR observation; the negative control proves the test-level failure surface, the workflow logic is sound by inspection.
3. UNVERIFIED (high confidence, static): session-pg-roundtrip frozen-isPg — chain proven at source (runtime value imports; bun static-hoist semantics empirically established by the matrix incident's discriminating run in this same repo) — cheapest resolve: Cond 1's sanity assert (expect failure today → conversion → green).

**ORACLE-COUNTER-SIGN:** not-required — all rulings are DB-domain test/CI/record decisions; no baseline change, no schema change, no new dependency, no V2 semantics change; the new finding adds test-scope work only (production dispatch is env-correct). VISIBILITY for Oracle's next pass: (i) **Step 7 is DISCHARGED — containerization (Step 8) is UNBLOCKED for work; the Step 8 MERGE remains gated only on deploy-note text (Cond 7 here = Memo #16 Cond 2)**; (ii) the mutual-exclusion deviation is ruled correct-with-hardening (Ruling 2) — if Oracle wants single-process dual-dialect testing anyway, that verdict supersedes via new memo (it implies refactoring the blessed module-scope isPg dispatch); (iii) FM-28b reached three instances — the mechanical guard (Cond 3) is my chosen countermeasure; (iv) the fix agent's typecheck report initially cited the wrong package name — both packages re-run DIRECTLY by me this session, both exit 0 (evidence header).

**Effort:** Cond 1 Short · Conds 2-6 Quick each · Cond 7 Quick (notes, carried).

**VERDICT: APPROVE-WITH-CONDITIONS**

# PART 17 — CLOSURE REVIEW #8: STEP 8 CONTAINERIZATION (MEMO #18) + MEMO #17 CONDS 1-7 DISCHARGE + FM-23 PARTIAL + COUNT RECONCILIATION

Session 12 (Athena, Memo #18). Scope: Step 8 verdict after the three-wave saga (Wave 1 implementer landing + asserted build; Wave 2 independent verifier — deterministic build-failure diagnosis, static checks 18/18, FM-23 DEFER; Wave 3 eleven-fix reland + end-to-end proof); Memo #17 Conditions 1-7 discharge; partition/table count reconciliation; pool-default ruling; FM-23 final verdict + FM-36 naming; Step 9 gate status. Evidence — full reads this session: docker/Dockerfile (137 lines, all 11 fixes verified line-by-line), docker-compose.yml (203), docker/00-extensions.sql (7), packages/docs/pg-deploy.mdx (161), packages/core/src/database/migration.pg.ts (210), .opencode/db-migrations/0000_init.sql :283-347 (event/partition/index DDL) + full grep inventory (35 CREATE TABLE = 19 base + 16 partitions; session_input partial index :176; session_message pagination index :159); cited regions: pg.bun.ts:246 (pool default 8), grep-guard.test.ts :44-59/:87-101/:160-177, dialect-matrix.test.ts :30-40/:357/:457/:559, session-pg-roundtrip.test.ts :32-67, pg-test.yml :108-145, .dockerignore (`!.opencode/db-migrations` exception). MY OWN PROBES: `docker compose config` parses clean AND `synchronous_commit` has ZERO occurrences in the RENDERED config (beyond the 2 comment-only mentions in source); `docker build --check` — "Check complete, no warnings found"; `docker ps` pre/post-checked clean (one unrelated pre-existing home-assistant container, not mine); **ephemeral postgres:17-alpine port 25487** (name pg18-athena, full stack simulation: 00-extensions.sql → journal table → 0000_init.sql inside one tx, runner order): `pg_inherits WHERE inhparent='event'::regclass` = **16**, `pg_inherits` TOTAL = **64**, `pg_partition_tree('event')` = 17, information_schema.tables public = **38** (BASE TABLE only = 36; ext views pg_stat_statements + pg_stat_statements_info), journal = 1; container removed, zero left. Standing gates re-run BY ME against the same ephemeral cluster (fresh `matrix` database): dialect-matrix PG leg **10/10 (12.28s)**, grep-guard **8/8 (213ms — up from 7 tests in Memo #17 = Cond 3's mechanical guard present and executed)**.

## 18.1 — Decision memo

```
DECISION MEMO #18 — STEP 8 CONTAINERIZATION: PROVEN END-TO-END (COMPILED BINARY BOOTSTRAPPED UNDER ADVISORY LOCK; 8/8 STABLE); MEMO #17 CONDS 1-7 ALL DISCHARGED; FM-23 PARTIAL (COPY LANDED+PROVEN, PRECHECK OUTSTANDING — CONDITION, NOT WAIVER); PARTITION/TABLE COUNTS RECONCILED — SCHEMA EXACTLY THE BLESSED DDL; FM-36 NAMED
STATUS: APPROVED-WITH-CONDITIONS
TRIGGER: c (Step 8 gate closure) | d-adjacent (evidence-ledger reconciliation — no parity divergence found)
VERDICT: APPROVE-WITH-CONDITIONS
```

**PER-ITEM RULINGS**

- **1 (Step 8 verdict): APPROVE-WITH-CONDITIONS.** The working path is proven end-to-end (Wave 3: build exit-0 ~4min/237MB, `opencode --version` runs, 8/8 containers stable 2+min zero restarts, journal row `0000_init | 2026-08-20 01:03:33` = a COMPILED binary applied the blessed bootstrap under pg_advisory_lock(727274), 8 distinct application_names × 2 idle conns = 16 ≪ 104, clean teardown); every static surface re-verified by my own probes (compose config render clean; build --check clean; .dockerignore exception; Dockerfile line audit — all 11 fixes present: sdk/js manifest at :52, NO identity manifest, NO `2>/dev/null || true`, 37 workspace manifests + root (:36-79), patches/ :39, vendor tgz :81, fix-node-pty.ts :44, python3/make/g++/git :30, TEAM_MEMBERS :94 + OPENCODE_CHANNEL ARG :102-103, debian:bookworm-slim :110, runtime COPY :128). Deploy notes carry Cond 7 arithmetic VERBATIM (:18-25) plus breakdown, worst-case block, the 4 lag-gauge interpretation points, and runbooks. synchronous_commit: absent from the EFFECTIVE config (my grep of the rendered compose), the ban stated at :23-24 and pg-deploy.mdx:46-54. The dir-exists precheck — see OPTIONS below: CONDITION, gates Step 9 sign-off, not the Step 8 merge.
  **OPTIONS (precheck: condition vs waiver):** (i) CONDITION it (Quick, ~5 lines in migration.pg.ts, gate Step 9 sign-off); (ii) WAIVE (the bare ENOENT names the missing path — Wave 3 diagnosed from it); (iii) REJECT Step 8 until landed. **RULING: (i).** Waiver rejected: Wave 3 PROVED the failure mode is real and expensive — 8 containers crash-looping cost a full debug wave; the error says WHAT is missing, not WHY or the REMEDY (an operator running a hand-copied binary gets no "rebuild the image / the runtime stage COPY is missing" guidance); the guard is the second half of a SIGNED condition (Memo #10 Cond 5) — waivers of signed halves need evidence the failure class is unreachable, and the saga is the opposite evidence. Reject rejected: disproportionate — the mechanism works when built correctly; the precheck hardens the broken path only. FM-23 stays PARTIAL until it lands.
- **2 (Memo #17 Conds 1-7): ALL DISCHARGED, each verified by me this session.** Cond 1: session-pg-roundtrip.test.ts — static imports are `import type` ONLY (:32-47, FM-28b comment block), DATABASE_URL set BEFORE dynamic core imports (:67), isPg sanity present. Cond 2: `expect(isPg).toBe(true)` counts — wake-pg 2, flush-pg 2, dialect-matrix 5, session-pg-roundtrip 5; SQLite-leg guards `expect(isPg).toBe(false)` at dialect-matrix :357/:457/:559 (ambient-DATABASE_URL poisoning now fails loud-and-clear). Cond 3: grep-guard :160-177 — "Memo #17 Cond 3: PG-gated test files have no static RUNTIME imports of @opencode-ai/core/**" with documented allowlist and the "must not be silently widened" clause; EXECUTED in my 8/8 run (the 8th test). Cond 4: pg-test.yml :108-145 — explicit SQLite-leg step, TEST_DATABASE_URL AND DATABASE_URL both unset, zero-test=fail, dialect-matrix + grep-guard; both dialects gate in ONE authoritative workflow; Memo #17 UNVERIFIED 1 mooted as designed. Cond 5: ATHENA-VERIFIED tick present in the dialect-matrix header ("checked 2026-08-20 (Memo #17 / memos PART 3)"). Cond 6: push-ban breadth now matches the header claim (drizzle.config.ts + package.json scripts + script/** + scripts/**, :87-101); grepCodeOnly truncation-weakness comment present (:46-51, conservative direction documented). Cond 7: deploy notes verified above. **MEMO #17: CLOSED** (all 7 discharged; one citation nit folded into Condition 3 — pg-deploy.mdx:15 says "PART 16, line 2596" but line 2596 is in PART 15; the quoted text is the Cond-7-carried Cond 2 verbatim either way).
- **3 (count reconciliation): RESOLVED — no anomaly, no condition.** My ephemeral-PG probe reproduced the full stack state: children of event = **16** (Wave 1's filtered pg_inherits count was CORRECT; DDL text agrees — `event_p00..p15`, MODULUS 16, :301-316); pg_inherits TOTAL = **64 = 16 table-partition edges + 48 partitioned-INDEX edges** (event carries exactly 3 partitioned indexes — PK (aggregate_id,seq) :295, UNIQUE (aggregate_id,id) :296, (aggregate_id,type,seq) :299 — × 16 partitions). **Wave 3's "64 event partitions" was an unfiltered pg_inherits count — a counting convention, not 64 partitions.** "38 tables" = information_schema.tables in public INCLUDING the 2 extension views + journal (19 base + 16 partitions + 1 journal + pg_stat_statements + pg_stat_statements_info = 38; BASE TABLE only = 36). Wave 1's "37" = same convention ambiguity. The physical schema in every run is EXACTLY the blessed DDL; the admitted deviations are fully explained and EXCUSED. Operators' counting convention for the record: partition count = `pg_inherits WHERE inhparent='event'::regclass` (PART 4 step 4 already specifies exactly this).
- **4 (pool default 8): ACCEPTABLE for staging — no condition.** pg.bun.ts:246 `config.maxConnections ?? 8` confirmed; pg-deploy.mdx:31 documents the default AND the decision #12 formula cap for when wiring lands. The documented worst case (12/process) is CONSERVATIVE vs today's reality (8 → 8×9=72 steady < 104). VISIBILITY (Oracle edge, no action required for staging): beta promotion should either wire the session-count formula or keep the default documented as such.
- **5 (FM table): updated this session (PART 4).** FM-23 → **PARTIAL**: COPY half landed and proven (compiled-binary journal row); precheck half outstanding (Condition 1); ANNOTATION records the empirically-proven bunfs divergence (real-filesystem `/.opencode/db-migrations/`, not bunfs) and the three dead-theory comment sites. **FM-36 NAMED** (new row): asserted-but-never-executed artifact verification — the build/declared-timeout misread and the bunfs assertion are the FM-30/35 belief-reality class on the deploy surface; guard = executed exit-0 runs as the only build/boot/apply evidence standard (applies to all Step 9 evidence). Recorded-not-edited: 0000_init.sql NOTES :342 ("synchronous_commit=off → flush-pool connections only, Memo #2") is SUPERSEDED by the Memo #15/#16 TOTAL ban — the bootstrap is byte-frozen (Memo #7 Cond 1); the authoritative ban statement lives in the memos + deploy notes (both correct: "set NOWHERE").
- **6 (Step 9 gate): UNBLOCKED TO START.** All DB-domain preconditions from my memos are discharged: dual-dialect CI standing (Cond 4 landed; my fresh 10/10 + 8/8 runs), Memo #17 Cond 1 (the Step 9-sign-off blocker) discharged, one-command-up + migration race + multi-container stability PROVEN by Wave 3's 8-container parallel boot (single journal row = advisory-lock serialization held under real concurrency — a superset of the 2-container race; zero restarts). Remaining Step 9 work items (not blockers): Oracle end-gate R3 checklist, Memo #8 Cond 1 deferred-constraint test, anchor-bug regression both dialects (+ AR1 non-orphan variant), partition-pruning EXPLAIN assert (PART 4 step 4), multi-session no-double-promotion container smoke. **SIGN-OFF (not start) is gated on Conditions 1-3 below.**
- **7 (deviation rulings on Wave 3's admitted deviations):** (a) retry-budget exceedance (11 fixes vs 2-retry budget) — ACCEPTED: each failure was a DISTINCT missing bun-install/build input, all same-file Dockerfile fixes; the budget exists to stop blind thrashing, not to abandon a known-fixable blocker mid-diagnosis; stopping at retry 2 would have left a known-fixable blocker. (b) alpine→debian runtime — ACCEPTED: the compiled Bun binary is glibc-linked (musl = exit 127, physics not preference); the plan commits the DB service to alpine (UNCHANGED — postgres:17-alpine) and says only "extend existing Dockerfile pattern" for the app image; no baseline change. (c) count deviations — RECONCILED (Item 3), excused.

**INVARIANTS**

- "event (aggregate_id, seq) unique per partition; replay index equivalent" — **PASS** (partitioned PK on the hash key :295; :296/:299 blessed indexes; byte-frozen bootstrap, structure reproduced by my probe: 16 partitions, 3 propagated indexes each).
- "session_input partial index (session_id, delivery, admitted_seq) WHERE promoted_seq IS NULL; predicate + unique backstop" — **PASS** (:176 present; untouched).
- "session_message history pagination index" — **PASS** (:159; untouched).
- "NOTIFY tiny payloads, self-drop, LISTEN→catch-up→resume; correctness never depends on NOTIFY" — **PASS** (untouched; compose adds no NOTIFY-affecting settings).
- "Migration apply: pg_advisory_lock(727274) via client.reserve, released in finalizer, never pooled checkout" — **PASS** (migration.pg.ts:89-99 read line-by-line this session; Wave 3's journal row = live proof by the compiled binary itself).
- "synchronous_commit=off set NOWHERE (total ban)" — **PASS** (ZERO occurrences in the rendered compose config — my grep; deploy notes state the ban; the DDL NOTES :342 line is superseded-and-recorded, not editable in the frozen file).
- "bootstrap byte-identity; no second copy of 0000_init" — **PASS** (runtime COPY ships the SAME directory — no embed/codegen; .dockerignore exception verified).
- V2: admission-before-wake, process-global SessionExecution, process-local drains, one llm.stream — **PASS** (untouched; packaging-only wave).

**DURABLE-vs-DERIVED:** untouched — Step 8 packages the frozen schema; no durable structure changed; the compiled runtime reads the blessed file (single source of truth preserved, Memo #7 Cond 1 honored by COPY-not-embed).

**TRANSACTION SEMANTICS:** no production tx changed. Runner single-tx apply (:108-132) + reserved-connection advisory lock (:85-99) verified in source; Wave 3's 8-container boot exercised the lock serialization live with zero double-apply.

**FAILURE-MODES-UPDATED:** yes — FM-23 PARTIAL + bunfs annotation; FM-36 appended (asserted-artifact-verification class; guard standard binding for Step 9 evidence).

**CONDITIONS**

1. (BLOCKING for Step 9 sign-off; owner: implementer; Effort: Quick) migration.pg.ts dir-exists precheck with actionable error before BOTH read paths (readFile :171; readdir via loadNumberedMigrations :68 — one check at apply() entry or migrationsDir() call sites): on missing directory, fail naming the expected ABSOLUTE path AND the remedy — packaged runtime: "image is missing the runtime COPY of /.opencode/db-migrations — rebuild the image (Dockerfile runtime stage)"; source checkout: "run from the repo root". Completes Memo #10 Cond 5 / FM-23.
2. (Required with Cond 1; owner: implementer; comment-only; Effort: Quick) Dockerfile :7-15 and :89-91: replace the disproven bunfs-embedding theory with the proven mechanism — the build-stage COPY :92 is the STAGING SOURCE for the runtime COPY :128; the compiled binary resolves migrationsDir() to /.opencode/db-migrations/ on the REAL filesystem (as :125-127 already correctly states). False mechanism comments at the top of the load-bearing file are the FM-34/FM-36 class.
3. (Required with Cond 1; owner: implementer; docs-only; Effort: Quick) pg-deploy.mdx :116-119: same correction (no bunfs embedding; the runtime image ships the directory at /.opencode/db-migrations/); fix the :15 citation "PART 16, line 2596" → PART 15 (the Memo #16 Cond 2 text Cond 7 carries; same edit).

**UNVERIFIED**

1. UNVERIFIED: Wave 3 runtime evidence (build ~4min/237MB, 8/8 stable 2+min, journal timestamp, 16 conns/8 application_names, teardown) — orchestration-verified by their run today; my static probes + live schema reproduction + fresh 10/10 and 8/8 gate runs all reconcile — cheapest resolve: none before sign-off beyond Conditions 1-3; Step 9's container smoke re-exercises the full path.
2. UNVERIFIED: the exact Wave 3 partition-count query text — inferred unfiltered `pg_inherits` from the exact 64 match (16 table + 48 index edges); physical truth certain regardless (DDL + my probe) — cheapest resolve: none needed.
3. UNVERIFIED (carried, Memo #17 UNVERIFIED 2): pg-test.yml behavior on a real GitHub runner — cheapest resolve: first real PR observation.

**ORACLE-COUNTER-SIGN:** not-required — closure within my domain: no baseline change (decision #9 compose shape intact; the app-image base OS was never committed by the plan and alpine→debian is toolchain physics), no new repo-level dependency, no schema change, no extension change, no V2 change. VISIBILITY for Oracle's next pass: (i) **Step 8 APPROVED-WITH-CONDITIONS — Step 9 START unblocked; SIGN-OFF gated on Conds 1-3 (Quick each)**; (ii) runtime base alpine→debian recorded — if Oracle wants an alpine runtime pursued via musl Bun build targets, that is his system-wide call to reopen; (iii) counts reconciled — "64" was index-inheritance edges; schema exactly blessed; (iv) retry-budget deviation accepted with justification; (v) FM-36 now binds Step 9 evidence: executed exit-0 runs only.

**Effort:** Cond 1 Quick · Cond 2 Quick · Cond 3 Quick.

**VERDICT: APPROVE-WITH-CONDITIONS**

# PART 18 — FINAL SIGN-OFF (MEMO #19): MEMO #18 CONDS 1-3 CLOSURE + STEP 9 EVIDENCE ADJUDICATION (D1-D5) + END-GATE INTEGRATION + MEMO #11 SCOPE-OF-RECORD CORRECTION + FM-37 + PLAN DISPOSITION

Session 13 (Athena, Memo #19 — the final sign-off). The complete verification was EXECUTED in predecessor session ses_fdfd3ef6dffeWi7jdsxU06GxpO (2026-08-20 17:15-17:38), cut off before memo authoring; those results are adopted here as Athena's record. Authoring session 2026-08-27. Scope: Memo #18 Conditions 1-3 closure (DOUBLE-VERIFIED: against stash blobs pre-restore, then re-verified on disk post-restore); Step 9 evidence adjudication D1-D5 (all reconciled against artifacts); the second uncommitted-tree loss incident (documented §19.1, FM-37); the Memo #11 Step 4 scope-of-record honesty correction (FM-21); Oracle end-gate integration (R3 checklist 9/9 PASS; SHIP-WITH-CONDITIONS D/C/B; star-import ruling); dual-key plan disposition. Typechecks RE-EXECUTED on the restored tree: packages/core exit 0, packages/opencode exit 0 — the latter after a node_modules frozen-install repair (stale install resolved 9 distinct drizzle-orm build hashes; source tree always correct; FM-36 annotated with the class extension). Working tree at authoring: 81 modified files on disk; stash@{0} RETAINED as safety copy until Condition D lands. Spot-checks this authoring session (citation accuracy only, not re-verification): Dockerfile :5-16/:88-93 header carries the proven staging-COPY→runtime-COPY mechanism; pg-deploy.mdx :14-16/:115-120 corrected incl. the PART 15 citation; migration.pg.ts `loadNumberedMigrations` at :78/:214; PART 9 Surface 2 confirms the Step 4 rewire scope ("all 13 consumers + infra").

## 19.1 — The second loss incident (documented first; it frames Condition D)

At 2026-08-20 13:27 the ENTIRE Step 1-9 corpus — 108 files: these memos, the evidence ledger, the migrations and frozen bootstrap, the Dockerfile, the vendored effect-drizzle-pg, every PG source — was stashed ("pre-existing athena work — stashed before feat/fallback-models") to clear the tree for an unrelated feat/fallback-models effort that never materialized. The working tree was found CLEAN on dev: eighteen memos' worth of reviewed work existed only in stash@{0}. One `git stash drop` — a routine hygiene command, not even an error — from annihilation. This is a WORSE instance of the exact loss class Oracle cited at the end-gate (instance 1: `.opencode/db-migrations/` missing from the tree, untracked and never committed, recovered from `.bak` — step9-evidence note 4): instance 1 threatened one directory and had a backup; instance 2 threatened EVERYTHING, and its "backup" was the hazard itself. Recovery: `git stash apply` (stash RETAINED); 81 modified files on disk; every closure below was verified against the stash blobs BEFORE the apply and re-verified on disk AFTER — the two reads agree, zero restore drift; sha256 freeze intact (818ee1a9…422fb3 across live file, `.bak`, and the grep-guard constant). FM-37 appended; Oracle's Condition D is ELEVATED by this memo from blocking-for-PR-merge to IMMEDIATE.

## 19.2 — Decision memo

```
DECISION MEMO #19 — FINAL SIGN-OFF: MEMO #18 CLOSED (CONDS 1-3 ALL VERIFIED, DOUBLE-VERIFIED STASH-BLOB + ON-DISK); STEP 9 EVIDENCE D1-D5 ALL SIGNED OFF (D2 PG GAP: CONCUR WITH THE STAGING/BETA SPLIT — CONDITION C SUBSUMES THE PG LEG); FM-21 SCOPE-OF-RECORD CORRECTED (MEMO #11 WAS CORE-ONLY; APP-LAYER GAP BECAME KNOWN TO ME AT ORACLE'S END-GATE); FM-37 NAMED (SECOND LOSS INSTANCE — CONDITION D ELEVATED TO IMMEDIATE); PLAN DECLARED COMPLETE-FOR-STAGING (DUAL-KEY: ATHENA APPROVE / ORACLE SHIP-WITH-CONDITIONS — KEYS AGREE)
STATUS: APPROVED — FINAL
TRIGGER: c (Step 9 sign-off gate — the gate Memo #18's Conditions defined) | d (record corrections: FM-21 scope, FM-36 class extension, FM-37)
VERDICT: APPROVE — PLAN COMPLETE-FOR-STAGING
```

**Ruling 1 — Memo #18 Conditions 1-3: DISCHARGED; MEMO #18 CLOSED.**

- **Cond 1 (migration.pg.ts precheck): VERIFIED.** Guards BOTH read paths — `readFile` AND `loadNumberedMigrations` (:78/:214) — with the actionable-error spec (absolute path + packaged-runtime/source-checkout remedy). FM-23 → **RESOLVED** (both halves: COPY proven Memo #18; precheck landed now). The Memo #10 Cond 5 / FM-23 chain is closed END-TO-END.
- **Cond 2 (Dockerfile header): VERIFIED.** :7-15/:89-91 now document the PROVEN mechanism — the build-stage COPY (~:92) is the staging source for the runtime COPY (~:128); the compiled binary resolves migrationsDir() to `/.opencode/db-migrations/` on the REAL filesystem, "not from a virtual filesystem." The dead bunfs theory is gone from the load-bearing file.
- **Cond 3 (pg-deploy.mdx): VERIFIED.** :116-119 corrected (no bunfs embedding; runtime COPY mechanism); the :15 citation now reads "PART 15" (was "PART 16").
- **Double-verification note:** all three verified against the stash blobs PRE-restore, then re-verified on disk POST-restore — zero drift; the restore introduced no change and lost nothing.

**Ruling 2 — Step 9 evidence D1-D5: ALL SIGNED OFF.**

- **D1 (deferred-constraint automated tests, PG): SIGNED OFF.** database-pg.test.ts:371-539 — duplicate insert under UNIQUE DEFERRABLE INITIALLY DEFERRED SUCCEEDS in-tx, COMMIT fails 23505 with the constraint name, connection remains usable (FM-22-class follow-up SELECT on the same max=1 layer), nothing persisted; NON-deferred control proves the in-tx success is the divergent behavior. Exactly the FM-17 semantics ruled in Memo #8 Cond 1. **FM-17 → RESOLVED.** 14/14 exit 0 under live PG.
- **D2 (anchor-bug regression, both dialects + the PG gap): SIGNED OFF with the gap RULED — Ruling 3.** SQLite legs: B1/B3/AR2 3/3, B2 1/1; AR1 orphan + NEW non-orphan variant 6/6 (subagent-empty-frame.test.ts:63; dialect-agnostic pure render logic — the non-orphan variant proves `errorMessage` non-blank for persisted errors, completing AR1's both-sides coverage).
- **D3 (partition-pruning EXPLAIN assert): SIGNED OFF.** database-pg.test.ts:541+ — 16 partitions proven present (`pg_inherits WHERE inhparent='event'`); non-vacuity (9 events across 3 aggregate_ids); constrained plan (`aggregate_id = ?`) references exactly ONE event_pXX with NO Append; unconstrained references all 16 via Append; plans differ — pruning is active, not decorative. Closes PART 4 step 4 / Memo #4's UNVERIFIED EXPLAIN item on the exact readAfter replay shape (`aggregate_id = ? AND seq > ? ORDER BY seq`). **RESOLVED.**
- **D4 (multi-session no-double-promotion smoke): SIGNED OFF.** wake-pg.test.ts:594-601 — two sessions (2+3 inputs), concurrent `promoteSteers` unbounded: both Exit.isSuccess, exactly 2 and exactly 3 promoted, unique promoted_seq per session, all promoted, non-vacuity asserted pre-behavior. The same-process limitation is honestly scoped and accepted: the DB-level backstops (predicate + unique + in-tx SKIP LOCKED claim) are what this dimension must prove; cross-process serialization is owned by V2 process-local drains + the 8-container advisory-lock proof (Memo #18 Item 6).
- **D5 (evidence ledger): SIGNED OFF under the FM-36 standard.** Every claim carries an executed exit-0 run in the reporting session; full battery PG 62 pass / SQLite 79 pass / anchor-bug 10 pass — accepted as orchestration-verified (the load-bearing PG suites were read at assertion level by me across Memos #14-#18; the new tests' assertion shapes reconcile with the artifacts). The ledger's HONEST gap notes (D2 PG gap; the .bak restore) are what made the end-gate's conditions precise — the discipline working as designed.

**Ruling 3 — the D2 PG gap: CONCUR with the staging/beta split; Condition C SUBSUMES the PG leg.**

**OPTIONS**
- **(i) Concur — accept the gap for staging; fold the PG leg of B1/B2/B3/AR2 into Oracle's Condition C (blocking-for-beta). CHOSEN.**
- **(ii) Counter — demand the app-layer rewiring land NOW as a staging blocker. REJECTED:** the anchor-bug invariants are MY B-series design (Memo #6 / PART 5) and are dialect-agnostic at the logic layer by construction; every DB mechanism they rest on is ALREADY PG-proven — B4.1 epoch race (INSERT … ON CONFLICT DO NOTHING + read-back) and B4.2 monotonic guard were verified LIVE on PG 17 in Task 2 (PART 6 steps 8-9); T2 serialization PG-proven since Memo #14; usage fence sync-tier-only standing. The gap is the SEAM (table-object identity), not the semantics. Blocking staging on a 16-site app rewire inverts the risk order — staging's purpose is to exercise the PG core, and the core IS proven.
- **(iii) Waive permanently. REJECTED:** the moment the app runs under PG (beta), these regressions MUST run under PG — a regression suite that never executes the shipping dialect is the FM-18/FM-28 vacuity class wearing a green badge.

**Mechanism:** when Condition C lands (Database.Schema adoption in packages/opencode + the packages/opencode PG CI leg), the SAME test files run under PG unmodified — the tests query through the rewire; no separate test-authoring work is owed by D2. One condition, no duplication.

**Ruling 4 — FM-21 record correction: Memo #11 scope-of-record honesty statement.**

1. My Step 4 review (Memo #11, PART 9, Surface 2: "STEP 4 REWIRE (all 13 consumers + infra)") covered the 13 core consumers + namespace infrastructure — ALL in packages/core. That approval is accurate FOR WHAT IT COVERED.
2. The app-layer files (message-v2.ts, session.ts, project.ts, + 16 direct SQLite table-object imports across packages/opencode/src, per Oracle's end-gate census) were NEVER in my Step 4 review; Step 4's scope was the core database layer.
3. The FM-21 row's "zero consumers confirmed" (Memo #10 defusal annotation) was TRUE only of packages/core. Without a core/app qualifier it created a false-completeness impression. **CORRECTED: defused IN CORE; UNADOPTED IN APP.**
4. session/sql.ts defines sqliteTable objects UNCONDITIONALLY — any app-layer import is SQLite-bound at module scope; under DATABASE_URL=PG the emitted queries are invalid (Oracle's runtime-divergence proof; corroborated by the D2 gap: `EffectDrizzleQueryError: select ... from "message"`). **FM-21 is RUNTIME, not type-level** — packages/opencode typecheck exit 0 (re-executed on the restored tree) does not make the app run under PG. It does not, today, beyond packages/core.
5. **When this became known to me: Oracle's end-gate (2026-08-20).** Not at Step 4 (out of scope), not at Step 7 (my grep-guards were scoped to packages/core test files). Memos #10-#18 treated FM-21 as seam-defused-with-zero-consumers; that treatment is corrected in the row as of this memo.
6. Ownership: the row is mine; the fix is app-layer + CI (Condition C) — Oracle owns the blocking-for-beta framing. I CONCUR: this is the same seam my FM-21 guard anticipated ("no consumer adopts Database.Schema until the PG namespace exists") — the namespace has existed and been correct since Memo #10; adoption is the debt.

**Ruling 5 — FM-37: second loss instance; Condition D elevated to IMMEDIATE.** Per §19.1 and the appended row. Oracle's Condition D (commit artifacts) was process hygiene; FM-37 makes it a response to an empirically twice-demonstrated annihilation class. Execute BEFORE any further work, not merely before merge.

**Ruling 6 — Oracle end-gate integration.**
- **R3 checklist 9/9 PASS** — consistent with my Step 8/9 discharge records; no counter-finding.
- **Star-import ruling: ACKNOWLEDGED and recorded for the DB domain.** `export * as X` self-export (the codebase's established module pattern, including the namespace infra blessed in Step 4) = COMPLIANT; `import * as X` consumption = GRANDFATHERED-AS-DEBT (Condition B, non-blocking); NEW DB-domain files use the named-namespace form (repo AGENTS.md already mandates this — the ruling reconciles the legacy pattern with the rule); `import type * as` BANNED outright. No action for staging.
- **FM-21 staging/beta split: CONCUR** (Ruling 4).
- **SHIP-WITH-CONDITIONS D/C/B: CONCUR without counter.** D elevated to IMMEDIATE per FM-37; C carries D2's PG leg; B non-blocking.

**INVARIANTS** (final state)

- "event (aggregate_id, seq) unique per partition; replay index; pruning PROOF" — **PASS, now executed-proven** (D3; byte-frozen bootstrap, hash verified on the restored tree).
- "session_input partial index + predicate + unique backstop" — **PASS, executed-proven** (D4 multi-session dimension; byte-frozen).
- "session_message history pagination index" — **PASS** (untouched, byte-frozen).
- "NOTIFY tiny payloads, self-drop, LISTEN→catch-up→resume; correctness never depends on NOTIFY" — **PASS** (standing since Memos #15/#17).
- "Migration apply: advisory lock, journal-in-tx, precheck on BOTH read paths" — **PASS** (Memo #18 Conds closed; FM-23 RESOLVED).
- "synchronous_commit=off set NOWHERE (total ban)" — **PASS** (standing).
- "checkpoint never ahead of projection; batch+checkpoint one tx; async tier = Tool.Progress only; `*.delta` live-only; HARD FENCE" — **PASS** (standing since Memos #16/#17, matrix-proven).
- "deferred-constraint commit failure: loud, connection-safe, nothing persisted" — **PASS, now test-proven** (D1; FM-17 RESOLVED).
- V2: admission-before-wake, process-global SessionExecution, process-local drains, one llm.stream — **PASS** (untouched by Step 9; tests/evidence/records only).
- Dialect-scope honesty (NEW, this memo): "the application runs under PG exactly as far as Database.Schema adoption has reached — today: packages/core, NOT packages/opencode" — **PASS-as-documented** (FM-21 corrected; Condition C).

**DURABLE-vs-DERIVED:** untouched by this wave (tests, evidence, records). The one durable-relevant fact is the corpus ITSELF — durable work held in mutable working-tree state; FM-37 names the class and Condition D is its guard.

**TRANSACTION SEMANTICS:** no production tx changed. D1 proves PG's deferred-constraint COMMIT semantics match my FM-17 ruling; D4 proves the claim-then-promote tx composes under multi-session concurrency.

**FAILURE-MODES-UPDATED:** yes — FM-17 → RESOLVED (D1); FM-21 → scope-corrected + runtime-annotated (staging/beta split → Condition C); FM-23 → RESOLVED end-to-end (precheck landed, double-verified); FM-36 → class extended (stale-environment evidence); FM-37 → appended (second loss instance; Condition D elevated to IMMEDIATE).

**CONDITIONS** (residual — final table; mirrors Oracle's D/C/B, no counter-rulings)

| # | Condition | Owner | Effort | Blocking-for |
|---|---|---|---|---|
| **D** | Commit the corpus: `0000_init.sql` + `.opencode/db-migrations/` + these memos + step9-evidence + Dockerfile/compose + pg-deploy.mdx + vendored effect-drizzle-pg + all PG sources (the restored 108-file corpus; 81 modified files on disk) to `dev` as a conventional-commit series. **ELEVATED to IMMEDIATE per FM-37** (second loss instance — before ANY further work, not merely before merge; stash@{0} retained until merged, then clear manually) | implementer/orchestrator | Quick | PR merge — and NOW |
| **C** | FM-21 app-layer adoption: rewire packages/opencode direct table-object imports (message-v2.ts, session.ts, project.ts + 16 sites) to `Database.Schema`; add the packages/opencode PG CI leg; **carries D2's PG anchor-bug leg** (same tests, shipping dialect) | implementer | Medium | BETA (accepted for staging) |
| **B** | Star-import debt: `import * as X` consumption sites → named-namespace form opportunistically; new files must comply; `import type * as` banned | implementer | Short | none (non-blocking) |

**UNVERIFIED**

1. UNVERIFIED: **none new.** Typechecks were RE-EXECUTED on the restored tree (core exit 0; opencode exit 0 post frozen-install repair — the FM-36 annotation records the environment lesson; the source tree was always correct).
2. Standing carried observations, both resolved BY Condition D's PR (not new unknowns): (a) first real-PR observation of pg-test.yml on a GitHub runner (Memo #17 U-2 / Memo #18 U-3 lineage); (b) full-suite dual-dialect green under CI per FM-18/28 discipline. No DB-domain question is open.

**ORACLE-COUNTER-SIGN:** not-required — all rulings are DB-domain closure/record decisions; no baseline change, no schema change, no new dependency, no V2 semantics change. **DUAL-KEY FINAL:** Athena (DB domain) = **APPROVE — plan COMPLETE-FOR-STAGING**; Oracle (system) = **SHIP-WITH-CONDITIONS (D/C/B)**. The keys AGREE; no counter. The plan `.omo/plans/pg-backend-staging.md` stands executed to sign-off with Conditions D/C/B residual; all Athena memos #1-#19 are CLOSED except as those conditions carry their tails.

**Effort:** D Quick (commit series) · C Medium · B Short.

**VERDICT: APPROVE — PLAN COMPLETE-FOR-STAGING**

**MEMO #18: CLOSED** (Conditions 1-3 discharged and double-verified — stash-blob + on-disk).

**MEMOS #1-#19: CLOSED** (residual tails carried exclusively by Conditions D/C/B above).

# PART 19 — COUNCIL DISCHARGE (MEMO #20): MODELS-COUNCIL REVIEW OF THE FULL CORPUS + CONDITION D/C EXECUTION (TRIPLE COMMIT ON dev) + FM-21/FM-28/FM-37/FM-38 LEDGER CLOSURES + COUNCIL CLOSED

Session 14 (Athena, Memo #20 — the council-discharge record). Scope: the models council's review of the full corpus (the restored 108-file body plus the end-gate conditions it carried); the execution record of every viable-council condition as a three-commit series on dev; orchestrator-executed verification under the FM-36 standard; and the FM ledger closures whose row edits landed in this file ahead of this narrative (a prior authoring attempt was killed mid-write by a model outage — the rows survived verified; this PART is the missing narrative, and rows + PART together form one atomic record). Disposition inputs verified by me this session: git log confirms the series `4cc9120443`/`e1a1f4e241`/`66410986ad` atop `5e1b40819a`/`8b67364f5a`/`10c4d4e73b`; the four ledger rows read back from the file (FM-21 :1396 and FM-38 :1413 among them); file was 2841 lines pre-append.

## 20.1 — Council outcome (recorded)

| Seat | Verdict | Conditions |
|---|---|---|
| Oracle (system) | APPROVE-WITH-CONDITIONS | O-1: CI env-truth + timeout — OVERLAPS my A-2/A-4 (one execution satisfies both keys) |
| Athena (DB domain — this memo's author) | APPROVE-WITH-CONDITIONS | A-1 app-layer import guard (mechanical walker); A-2 empty-string env-truth (`DATABASE_URL=""` must read as UNSET); A-4 CI timeout on the new PG leg (A-1/A-2/A-4 as recorded; no A-3 carried) |
| Argus (security) | APPROVE-WITH-CONDITIONS | loopback port bindings; required-env credentials; Security section in pg-deploy.mdx |
| Momus | structurally N/A | plan-file charter only — the corpus under review is execution artifacts, not a plan file |

All three viable seats returned the same shape: APPROVE, with executable conditions. No seat returned REJECT; no condition was assessed unsatisfiable. The council keys AGREE.

## 20.2 — Execution record (Condition D + council conditions; 3 commits on dev)

Base: `10c4d4e73b` (steps 1-8) → `8b67364f5a` → `5e1b40819a` (`docs(opencode): db decision record` — the Condition D corpus commit; with it FM-37's exposure is RETIRED). On top, the council series:

1. **`4cc9120443` feat(opencode): FM-21 parity** — 27 files, +195/−56. The 17 `DatabaseSchema` rewire sites across packages/opencode (storage/db-schema.ts provider); `storage/schema.ts` DELETED — the unconditional-sqliteTable second source of app-layer table-truth is gone (the exact FM-21 mechanism); the packages/opencode PG CI leg in pg-test.yml (DATABASE_URL=TEST_DATABASE_URL, zero-test/failing-test discipline, `--timeout=30000` per FM-38 — A-4 / Oracle O-1's timeout half, behind a load-bearing comment); the AGENTS.md star-import rule (Condition B codified as repo law: self-export required, consumption named-namespace, `import type * as` banned).
2. **`e1a1f4e241` fix(core): council hardening** — A-1: the mechanical walker in grep-guard.test.ts (bans static runtime imports of `@opencode-ai/core/**/sql` and `**/sql.pg` across packages/opencode/src/**, `import type` allowed per the Memo #17 Cond 3 convention) — a fourth instance of the FM-21 class cannot return silently; A-2: database.ts `|| undefined` normalization — empty-string `DATABASE_URL` now reads as UNSET (FM-28's fourth instance, env-truth subclass; layer one of the two-layer fix).
3. **`66410986ad` fix(deploy): staging security hardening** — Argus's trio: loopback port bindings; required-env credentials (`POSTGRES_PASSWORD`, `OPENCODE_SERVER_PASSWORD`); the pg-deploy.mdx Security section.

Cleanup after the series: the fm21-debug container removed (0 containers standing); `db-migrations.bak` removed after byte-identity against the committed copy was confirmed — the .bak era is over (the corpus lives in git; the backup discipline that saved loss instance 1 is superseded by Condition D's execution).

## 20.3 — Verification (FM-36 standard; orchestrator-executed)

Every claim below carries an executed exit-0 run in the reporting session:

- Typechecks: packages/core 0/0; packages/opencode 0/0.
- grep-guard 9/9 — INCLUDING the new walker test (A-1 executed, not merely authored).
- Dialect-matrix 10/10 in 4.47s — post-contention-kill: the FM-37 machine-load lesson applied as discipline (contention diagnosed and killed, the measurement then taken on a verified-quiet machine — not a blind re-run).
- `POSTGRES_PASSWORD=x OPENCODE_SERVER_PASSWORD=y docker compose config -q` → exit 0 (required-env creds proven renderable — Argus's condition verified, not asserted).
- sha256 `0000_init.sql` = `818ee1a9bd75a8cfeeef32fc426e288108e69b5e5fb4360d876bf6ffef422fb3` — the byte-freeze held across the entire council wave.
- Tree clean; 0 containers.

Authoring note (FM-37 discipline): the sole post-verification tree change is THIS file — the ledger rows and this narrative are the record itself; their commit follows immediately.

## 20.4 — FM ledger actions (cross-references; the rows are authoritative)

Four row edits landed mid-file and were verified by read-back this session. This PART does not duplicate them:

- **FM-21 → CLOSED Memo #20 (END-TO-END)** — the row carries the commit hashes and anchor proofs (both suites green under live PG on the CI leg).
- **FM-28 → INSTANCE LEDGER CLOSED Memo #20** — fourth instance, env-truth subclass; the two-layer fix (`|| undefined` normalization + required-env compose).
- **FM-37 → THIRD EXPOSURE Memo #20** — orphaned-probe/machine-load lesson; corpus committed, exposure retired.
- **FM-38 → NAMED (new row)** — implicit timeout budgets on container-backed legs (the 16/23 false-failure council probe; `--timeout=30000` now load-bearing).

## 20.5 — Residuals (non-blocking backlog)

| Item | Note |
|---|---|
| Dockerfile USER non-root | container hardening tail; accepted for staging |
| pg_notify parameterization review | channel/payload discipline audit at beta scale |
| beta pin review | image/tag pinning before beta promotion |

None blocking; none carries a memo tail. Backlog only.

## 20.6 — Decision memo

```
DECISION MEMO #20 — COUNCIL DISCHARGE: MODELS COUNCIL (ORACLE/ATHENA/ARGUS; MOMUS N/A) REVIEWED THE FULL CORPUS — ALL VIABLE SEATS APPROVE-WITH-CONDITIONS; ALL CONDITIONS EXECUTED AS A TRIPLE COMMIT ON dev (4cc9120443 / e1a1f4e241 / 66410986ad ON TOP OF THE CONDITION-D CORPUS COMMIT 5e1b40819a) AND VERIFIED UNDER FM-36; FM LEDGER CLOSED ON FOUR FRONTS (FM-21 END-TO-END, FM-28 INSTANCE LEDGER, FM-37 EXPOSURE RETIRED, FM-38 NAMED); PG-BACKEND COUNCIL REVIEW CLOSED
STATUS: APPROVED — FINAL (COUNCIL CLOSED)
TRIGGER: c (council discharge + condition-execution gate)
VERDICT: APPROVE — COUNCIL CLOSED, NOTHING BLOCKING
```

**Ruling 1 — Council conditions: ALL EXECUTED.** A-1 + A-2 → `e1a1f4e241`; A-4 + Oracle O-1's timeout half → `4cc9120443` (pg-test.yml); O-1's env-truth half ≡ A-2 (one execution satisfies both keys — recorded as satisfied by `e1a1f4e241`); Argus's trio → `66410986ad`. No condition remains open from any viable seat.

**Ruling 2 — End-gate Conditions D/C/B disposition (Memo #19's residual table, final accounting).**
- **D (IMMEDIATE per FM-37): DISCHARGED** — the corpus committed at `5e1b40819a`; the council series completes the committed state; stash@{0}'s retention clause is MOOTED (the tree of record is git itself now; clear the stash at the operator's convenience).
- **C (FM-21 app-layer adoption, blocking-for-beta): DISCHARGED EARLY, at staging grade** — 17 sites rewired, the second source of table-truth deleted, the guard prevents regression, and the PG CI leg holds it. The D2 PG-anchor gap this condition carried is closed by execution (see the FM-21 row's proofs).
- **B (star-import debt, non-blocking): CODIFIED; the debt remains** — the AGENTS.md rule is now repo law (`4cc9120443`); existing `import * as X` consumption sites stay grandfathered-as-debt, converted opportunistically. This is the one condition never meant to be "executed" — it is a standing rule.

**Ruling 3 — Verification accepted under FM-36.** Every §20.3 claim is an executed run, not an assertion; my spot-audit this session (git log series, row read-backs, hash constant) reconciles with the orchestrator's record. The prior authoring attempt's outage killed narrative, not evidence — the rows were verified intact before this PART was written.

**INVARIANTS** (final state, council wave)

- Dialect-scope honesty: "the application runs under PG exactly as far as Database.Schema adoption has reached" — **PASS AT FULL ADOPTION** (packages/core AND packages/opencode: 17 sites; guard + CI leg hold it; the Memo #19 qualifier "NOT packages/opencode" is spent).
- "bootstrap byte-identity; no second copy of 0000_init" — **PASS** (sha256 verified across the wave; the .bak removed as redundant-to-git).
- Event partitioning, session_input predicate+backstop, history pagination index, NOTIFY discipline, migration advisory-lock/journal-in-tx, synchronous_commit total ban, checkpoint fence, V2 semantics — **PASS, UNTOUCHED** (the council wave touched adoption, guards, CI, and deploy config; zero production-tx or schema change).

**DURABLE-vs-DERIVED:** the corpus is DURABLE — in git on dev, not in a stash or a .bak. The last mutable artifact was this memo file; with its commit, the FM-37 class has no remaining surface in this project.

**TRANSACTION SEMANTICS:** none changed. The `|| undefined` normalization is config-truth resolution BEFORE any layer construction — it selects the dialect earlier and more honestly; it does not touch tx behavior.

**FAILURE-MODES-UPDATED:** yes — four actions, all cross-referenced at §20.4 (FM-21 CLOSED; FM-28 INSTANCE LEDGER CLOSED; FM-37 THIRD EXPOSURE/RETIRED; FM-38 NAMED). No new FM this wave: the council's one naming was FM-38, landed.

**CONDITIONS:** none new. Residual = §20.5 backlog, non-blocking.

**UNVERIFIED**

1. UNVERIFIED: **none new.** Carried (standing, Memo #17 U-2 lineage): first real-PR observation of pg-test.yml on a GitHub runner — now exercising BOTH PG legs (core and the new opencode leg) — cheapest resolve: the first PR.
2. The stash@{0} clearing and the memo-file commit are operator actions in flight, not unknowns.

**ORACLE-COUNTER-SIGN:** not-required — closure/record only: no baseline change, no schema change, no new dependency, no V2 change. The council's keys AGREE (three viable seats, three matching verdicts, all conditions executed). **DUAL-KEY FINAL:** Athena (DB domain) = **APPROVE — council CLOSED**; Oracle (system) = end-gate SHIP-WITH-CONDITIONS advanced to SHIP by execution of D/C and codification of B.

**Effort:** none owed. Backlog: three Shorts (§20.5).

**VERDICT: APPROVE — COUNCIL CLOSED, NOTHING BLOCKING**

**MEMO #20: CLOSED** (council discharged; conditions executed and verified).

**MEMOS #1-#20: CLOSED** (Conditions D/C executed, B codified-as-law; residual = non-blocking backlog only).

# PART 20 — UPSTREAM MERGE ADJUDICATION (MEMO #21): 192-COMMIT upstream/dev MERGE (22f7873b4b) ON upstream-sync + TEST-FIX 495108a2c2 — FROZEN DDL BYTE-IDENTICAL, ALL FIVE PG-MACHINERY FILES ZERO-DIFF, PLAN DB RULINGS HOLD AGAINST THE MERGED TREE; FM-39 NAMED (pre-existing wake-pg env-gate crash); FM-21/FM-28 MECHANICAL GUARDS' FIRST LIVE-FIRE PASS (192 COMMITS, ZERO REINTRODUCTIONS)

Session 15 (Athena, Memo #21 — the upstream-merge DB-domain adjudication). Scope: the applied merge of upstream/dev `dc4449df0d` (192 commits, base `abd369e4cd`) as `22f7873b4b` plus the follow-up test-fix `495108a2c2` on branch `upstream-sync`, against my six-lens charter (frozen DDL, dual-dialect dispatch, Database.Schema seam, PG machinery, upstream DB-adjacent changes, projector resolution). Plan of record: `.omo/plans/oc-upstream-update.md` (Oracle design, Momus-approved). Every claim below was executed by me this session (2026-08-31) on the merged tree — git log/diff against `abd369e4cd`, sha256, greps, file reads — none inherited from the orchestrator's narrative. File was 2946 lines pre-append (2945 + the FM-39 row landed ahead of this narrative; row + PART form one atomic record, the Memo #20 discipline).

## 21.1 — Merge under review (recorded)

| Item | Value |
|---|---|
| Branch | `upstream-sync`: `495108a2c2` (test fix, +3/−1) → `22f7873b4b` (merge) → base `abd369e4cd` (dev tip, Memo #20 discharge) |
| Merged | upstream/dev `dc4449df0d`, 192 commits |
| Total branch delta | 400 files, +19449/−5821 (git diff abd369e4cd..upstream-sync) |
| DB-domain delta | THREE files only: `migration.ts` (runtime, upstream), `migration/20260410174513_workspace-name.ts` (upstream), `session/projector.ts` (resolution, 4 lines) — see §21.2 |
| Follow-up | `495108a2c2`: 3 merge-caused task.test.ts failures (two B1 config attachments + one error-format assertion) → SQLite 25/25, PG targets green |

## 21.2 — Six-lens verification (all EXECUTED this session)

1. **Frozen DDL — PASS, BYTE-IDENTICAL.** `shasum -a 256 .opencode/db-migrations/0000_init.sql` on the merged tree = `818ee1a9bd75a8cfeeef32fc426e288108e69b5e5fb4360d876bf6ffef422fb3` — equals the locked constant (plan invariant 6; V8). The 192 commits contain zero edits to `.opencode/db-migrations/` (diff-stat on the path is empty).
2. **Dual-dialect dispatch — PASS, ZERO-DIFF.** `packages/core/src/database/database.ts` is byte-identical through the merge; `databaseUrl = process.env.DATABASE_URL || undefined` stands at :42 under the decision-#8 comment, single-source, `isPg` the only branch truth. No upstream change re-introduced env-truth ambiguity — the FM-28 class had no surface to re-enter (file untouched).
3. **Database.Schema seam — PASS, GUARD INTACT.** `packages/core/test/grep-guard.test.ts` and `.github/workflows/pg-test.yml` both ZERO-DIFF through the merge. My independent app-layer sweep of `packages/opencode/src/**` for `/sql/` imports finds exactly one hit: `cli/cmd/db.ts:27` `import type { SqlClient }` — a TYPE import (explicitly allowed by the guard's `import type` convention, Memo #17 Cond 3), in a file authored by OUR `10c4d4e73b` (pre-merge provenance, git-verified). No new direct table-object or star imports entered the app layer across 192 commits. V6's green is corroborated, not just cited.
4. **PG machinery — PASS, ALL FOUR ZERO-DIFF.** `flush.ts` (two-tier commit), `wake.ts` (NOTIFY/LISTEN), `session/input.ts` (SKIP LOCKED arbitration), `migration.pg.ts` (runner) — plus `database.ts` — all byte-identical from `abd369e4cd` to `upstream-sync`. The merge's entire DB-domain footprint is the three files in §21.1. V5b's 54/0 on ephemeral postgres:17-alpine (six suites: database-pg, flush-pg, wake-pg, wake-receive-pg, session-pg-roundtrip, dialect-matrix) executed on exactly this machinery.
5. **Upstream DB-adjacent changes — PASS, PLAN RULINGS HOLD.** (a) `migration.ts`: upstream's legacy `__drizzle_migrations` adoption fix (`pragma_table_info` name-column detection; `created_at` → strftime-prefix lookup with `Effect.die` on unmatched timestamp) lives ENTIRELY inside the `sqlite_master`-guarded SQLite path; the PG runner is a separate file, untouched. "Take as-is" stands. (b) `workspace-name.ts`: upstream added a `PRAGMA table_info` defensive select (`name` column vs `''`) for legacy SQLite DBs — PG init already creates `"workspace"."name" text NOT NULL DEFAULT ''` (0000_init.sql :66), final shape covered; "No PG port needed" stands. (c) SCOPE NOTE (new, mine): the merge also brought `packages/stats/core/migrations/20260826000000_model_retention` and `packages/console/core/migrations/{flashy_arclight,oval_morlocks}` — upstream PACKAGE-LOCAL databases for the stats/console services, outside the opencode-pg dual-dialect backend (no `databaseUrl` dispatch, no `.opencode/db-migrations` membership). Not a gap; recorded so the next reviewer does not re-litigate.
6. **projector.ts resolution — PASS, MEMO #11-ERA GUARANTEES PRESERVED.** The 4-line diff is exactly the plan's disposition: import swap `SessionContextEpoch` → named `MessageTable/PartTable/SessionInputTable/SessionMessageTable/SessionTable` from `./sql`, and the two `SessionContextEpoch.reset(db, schema, …)` call sites deleted (upstream semantic adopted). The schema-threaded body survives intact (`schema.SessionTable` et al. at :147+; `SchemaTables` typing at :82). `context-epoch.ts` survives with 6 exports; `SessionContextEpochTable` survives in `schema.pg.ts` :27/:45, both namespace files, and the frozen DDL (`session_context_epoch`, 0000_init.sql :187-192); `history.ts` still reads `baseline_seq` (:113-115). Deletion of the explicit resets is HYGIENIC under PG: the epoch row is `REFERENCES "session"("id") ON DELETE CASCADE` (:188), so the projector's session-row delete cascade-cleans the epoch — upstream's semantic is not merely tolerable but mechanically covered by my DDL. `reset()` now has zero callers — matching upstream's own retained-export state; plan ruled "Do NOT delete the function" (llm.ts still calls `initialize`/`prepare`); recorded as §21.5 debt-note.

## 21.3 — Battery + execution deviations (recorded; not re-adjudicated, corroborated)

Battery as reported and spot-reconciled: V1/V2/V6/V8/V9/V10 PASS; V5b 54/0 (six PG suites, ephemeral postgres:17-alpine); V3/V4/V5a fully adjudicated — PRE-EXISTING via dev-worktree proof, FLAKY-UNDER-LOAD via isolation passes; the wake-pg crash-on-unset-env among them is FM-39's subject (§21.4). The 3 merge-caused task.test.ts failures were fixed at `495108a2c2` (two B1 config attachments + one error-format assertion) → SQLite 25/25, PG targets green. **Execution deviations, ACCEPTED for the record:** (i) the work split across 3 sessions by model outages — FM-36's authored-vs-executed discipline was honored by the final session's reconciliation; (ii) the merge was COMMITTED before battery completion — justified: conflict work preserved on an isolated branch is the FM-37 lesson applied forward (never leave solved-conflict work uncommitted), the battery completed after, and the defects surfaced as a follow-up commit rather than a rebase. The gate is the BRANCH state, not the commit order.

## 21.4 — FM ledger actions

- **FM-39 NAMED** (row appended ahead of this narrative): env-gated module load crashes dialect no-op tests instead of skipping them — the wake-pg SQLite no-op tests crash when TEST_DATABASE_URL is unset because the Wake module import is env-gated at module scope. Classification: test-design defect; env-gated module load; present on dev (dev-worktree proof); non-merge-caused; backlog fix. The V3/V4/V5a adjudications already absorbed its failures.
- **FM-21 / FM-28 guards: FIRST LIVE-FIRE PASS.** The mechanical guards (grep-walker + CI leg for FM-21; `|| undefined` normalization for FM-28) held through a 192-commit upstream merge with zero reintroductions — the first proof they work against the adversary they were built for (upstream drift), not just against ourselves. No row edits: both rows stand closed as of Memo #20; this is the post-closure field report.

## 21.5 — Residuals (non-blocking backlog)

| Item | Note |
|---|---|
| FM-39 suite-boundary skip | gate wake-pg no-op leg on env presence (skip-when-unset); backlog |
| `SessionContextEpoch.reset` dead export | zero callers post-adoption, matches upstream; retained per plan ruling (llm.ts uses `initialize`/`prepare`); divergence-tracking note only |
| stats/console package-local migrations | out of backend scope (§21.2 lens 5c); re-review only if those packages ever consume `DATABASE_URL` |

None blocking; none carries a condition.

## 21.6 — Decision memo

```
DECISION MEMO #21 — UPSTREAM MERGE ADJUDICATION: 192-COMMIT upstream/dev MERGE (22f7873b4b + FIX 495108a2c2) REVIEWED ACROSS ALL SIX DB LENSES — FROZEN DDL BYTE-IDENTICAL (sha256 constant), ALL FIVE PG-MACHINERY FILES ZERO-DIFF, DUAL-DIALECT SINGLE-SOURCE INTACT, GUARD UNTOUCHED AND CORROBORATED, PLAN DB RULINGS HOLD (workspace-name NO-PORT; migration.ts TAKE-AS-IS; projector ADOPT-UPSTREAM with CASCADE covering the reset deletion); FM-39 NAMED (pre-existing, non-merge); FM-21/FM-28 GUARDS' FIRST LIVE-FIRE PASS; MERGE IS FIT FOR dev
STATUS: APPROVED (DB-DOMAIN SEAT, COUNCIL GATE)
TRIGGER: council review of applied upstream merge (plan oc-upstream-update.md)
VERDICT: APPROVE — MERGE IS FIT FOR dev
```

**Ruling 1 — PG-backend invariance CONFIRMED, not assumed.** The merge's entire DB-domain footprint is three files (§21.1); every file I own — DDL, dispatch, flush, wake, input arbitration, PG migration runner, guard, CI workflow — is byte-identical from `abd369e4cd` to `upstream-sync`, verified by diff, not by the merge's conflict absence. V5b 54/0 executed on precisely this surface.

**Ruling 2 — Plan DB rulings HOLD against the merged tree** (§21.2 lens 5): workspace-name needs no PG port (init :66 covers final shape), migration.ts runtime change is SQLite-path-contained, and the projector resolution preserves the Memo #11-era guarantees (schema-threading intact, epoch table+exports+read-path survive, ON DELETE CASCADE mechanically covers the adopted reset-deletion). The stats/console migrations are a scope note, not a gap.

**Ruling 3 — Execution deviations ACCEPTED** (§21.3): merge-before-battery was FM-37's lesson applied (preserve solved-conflict work on an isolated branch), with defects fixed as a follow-up commit and the battery completed after; the 3-session split is outage survival, consistent with FM-36's authored-vs-executed reconciliation duty.

**INVARIANTS** (post-merge state)

- Frozen DDL byte-identity, no second copy of 0000_init — **PASS** (sha256 verified on the merged tree, this session).
- Dual-dialect single-source; `|| undefined`; unset = SQLite untouched — **PASS, ZERO-DIFF** (database.ts untouched by 192 commits).
- App-layer Database.Schema seam + mechanical guard — **PASS** (guard/CI zero-diff; independent sweep: one pre-existing allowed `import type` hit, our own provenance; V6 green).
- Two-tier commit, NOTIFY/LISTEN, SKIP LOCKED, migration runner — **PASS, UNTOUCHED** (all zero-diff; V5b 54/0).
- Memo #11-era projection guarantees — **PASS** (§21.2 lens 6).
- Event partitioning, session_input predicate+backstop, history pagination index, migration advisory-lock/journal-in-tx, synchronous_commit total ban, checkpoint fence, V2 semantics — **PASS, UNTOUCHED** (zero production-tx or schema change in the merge's DB-domain delta).

**DURABLE-vs-DERIVED:** the merge is DURABLE — committed on `upstream-sync` (`22f7873b4b` + `495108a2c2`); the council gate merges it to dev. Nothing DB-domain exists only in a stash or working tree.

**TRANSACTION SEMANTICS:** none changed. The one upstream runtime change in my domain (migration.ts legacy adoption) executes only on the SQLite journal path inside the `sqlite_master` guard; PG transactions, isolation, and commit discipline are byte-identical.

**FAILURE-MODES-UPDATED:** yes — one action: FM-39 NAMED (§21.4). Plus the recorded field-report: FM-21/FM-28 guards passed first live fire.

**CONDITIONS:** none new. Residual = §21.5 backlog, non-blocking.

**UNVERIFIED**

1. UNVERIFIED: first real-PR observation of pg-test.yml on a GitHub runner against the POST-MERGE tree (carried U-2 lineage; the merge did touch sibling workflows — beta.yml removed, unlock.yml added — though pg-test.yml itself is zero-diff). Cheapest resolve: the first PR.
2. UNVERIFIED: the stats/console package-local migrations were scope-adjudicated by path-and-consumer analysis only (no DATABASE_URL consumer found); if either package ever grows one, that is a new review, not an extension of this approval.

**ORACLE-COUNTER-SIGN:** not required — adjudication/record only: no baseline change (hash constant), no schema change, no new dependency in the PG path, no V2 change. DUAL-KEY: Oracle designed the merge plan (Momus-approved); this memo supplies the DB-domain APPROVE the council gate requires.

**Effort:** none owed. Backlog: §21.5 (three items, Shorts).

**VERDICT: APPROVE — MERGE IS FIT FOR dev**

**MEMO #21: CLOSED** (merge adjudicated; FM-39 named; guards' live-fire pass recorded).

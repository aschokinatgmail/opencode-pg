-- =====================================================================
-- opencode-pg 0000_init — single fresh PostgreSQL bootstrap
-- Signed: Athena (DB key), Task 1 session; executable form emitted by
--         Athena, Task 2 session. This file IS the blessed executable
--         form of .opencode/db-decision-memos.md PART 2, as amended by
--         Memo #6 B6 (data_migration OMITTED, credential KEPT).
-- Runner contract: the migration runner executes this file INSIDE its
--   own transaction while holding pg_advisory_lock(727274) RUNNER-SIDE
--   (client.reserve + finalizer). This file deliberately contains NO
--   BEGIN/COMMIT and NO advisory-lock statement.
-- Idempotency: CREATE ... IF NOT EXISTS on tables/indexes; guarded
--   extension DO block; ALTER TABLE ... SET is re-entrant. Safe to
--   re-execute (proof: Part 6, Task 2 verification transcript).
-- Executability deltas vs the signed PART 2 text: IF NOT EXISTS
--   qualifiers + this header ONLY. No semantic divergence (B6.3).
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
CREATE TABLE IF NOT EXISTS "project" (
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

CREATE TABLE IF NOT EXISTS "project_directory" (
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
CREATE TABLE IF NOT EXISTS "workspace" (
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
CREATE TABLE IF NOT EXISTS "session" (
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
CREATE INDEX IF NOT EXISTS "session_project_idx" ON "session" ("project_id");
CREATE INDEX IF NOT EXISTS "session_workspace_idx" ON "session" ("workspace_id");
CREATE INDEX IF NOT EXISTS "session_parent_idx" ON "session" ("parent_id");

CREATE TABLE IF NOT EXISTS "message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx"
  ON "message" ("session_id", "time_created" DESC, "id" DESC);

CREATE TABLE IF NOT EXISTS "part" (
  "id" text PRIMARY KEY,
  "message_id" text NOT NULL REFERENCES "message"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
) WITH (fillfactor = 80);
CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id", "id");
CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id");

CREATE TABLE IF NOT EXISTS "todo" (
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

CREATE TABLE IF NOT EXISTS "session_message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "seq" bigint NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL,
  "data" jsonb NOT NULL
) WITH (fillfactor = 80);
CREATE UNIQUE INDEX IF NOT EXISTS "session_message_session_seq_idx" ON "session_message" ("session_id", "seq");
CREATE INDEX IF NOT EXISTS "session_message_session_type_seq_idx" ON "session_message" ("session_id", "type", "seq");
-- history pagination index (hot-path invariant; DESC-native for
-- ORDER BY time_created DESC, id DESC page walks)
CREATE INDEX IF NOT EXISTS "session_message_session_time_created_id_idx"
  ON "session_message" ("session_id", "time_created" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "session_message_time_created_idx" ON "session_message" ("time_created");

-- V2-semantics DDL section (Memo #5):
-- re-expresses 20260603141458 + 20260604172448 (current shape + indexes).
-- Partial index REWRITES SQLite's full (session_id, promoted_seq,
-- delivery, admitted_seq) index: pending scans hit the partial index only.
CREATE TABLE IF NOT EXISTS "session_input" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "prompt" jsonb NOT NULL,
  "delivery" text NOT NULL,
  "admitted_seq" bigint NOT NULL,
  "promoted_seq" bigint,
  "time_created" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "session_input_session_pending_delivery_seq_idx"
  ON "session_input" ("session_id", "delivery", "admitted_seq")
  WHERE "promoted_seq" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "session_input_session_admitted_seq_idx"
  ON "session_input" ("session_id", "admitted_seq");
-- backstops promotion races; PG (like SQLite) allows multiple NULLs
CREATE UNIQUE INDEX IF NOT EXISTS "session_input_session_promoted_seq_idx"
  ON "session_input" ("session_id", "promoted_seq");

-- V2-semantics DDL section (Memo #5):
-- re-expresses 20260605003541 + 20260622142730 (final shape).
CREATE TABLE IF NOT EXISTS "session_context_epoch" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "baseline" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "baseline_seq" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "session_share" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "id" text NOT NULL,
  "secret" text NOT NULL,
  "url" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);

-- T3 (Memo #2): async-tier flush checkpoint. Derived bookkeeping —
-- batch + checkpoint advance share ONE async transaction (HARD rule).
CREATE TABLE IF NOT EXISTS "session_projection_checkpoint" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "applied_seq" bigint NOT NULL,
  "time_updated" timestamptz NOT NULL
);

-- ---------------------------------------------------------------------
-- 4. PERMISSION
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "permission" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "permission_project_action_resource_idx"
  ON "permission" ("project_id", "action", "resource");

-- ---------------------------------------------------------------------
-- 5. ACCOUNT / CREDENTIAL
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" timestamptz,
  "time_created" timestamptz NOT NULL,
  "time_updated" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "account_state" (
  "id" integer PRIMARY KEY,
  "active_account_id" text REFERENCES "account"("id") ON DELETE SET NULL,
  "active_org_id" text
);

-- LEGACY
CREATE TABLE IF NOT EXISTS "control_account" (
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

CREATE TABLE IF NOT EXISTS "credential" (
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
CREATE TABLE IF NOT EXISTS "event_sequence" (
  "aggregate_id" text PRIMARY KEY,
  "seq" bigint NOT NULL,
  "owner_id" text
);

CREATE TABLE IF NOT EXISTS "event" (
  "id" text NOT NULL,
  "aggregate_id" text NOT NULL REFERENCES "event_sequence"("aggregate_id") ON DELETE CASCADE,
  "seq" bigint NOT NULL,
  "type" text NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "event_pk" PRIMARY KEY ("aggregate_id", "seq"),
  CONSTRAINT "event_aggregate_id_id_idx" UNIQUE ("aggregate_id", "id")
) PARTITION BY HASH ("aggregate_id");

CREATE INDEX IF NOT EXISTS "event_aggregate_type_seq_idx" ON "event" ("aggregate_id", "type", "seq");

CREATE TABLE IF NOT EXISTS "event_p00" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE IF NOT EXISTS "event_p01" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE IF NOT EXISTS "event_p02" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE IF NOT EXISTS "event_p03" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE IF NOT EXISTS "event_p04" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE IF NOT EXISTS "event_p05" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE IF NOT EXISTS "event_p06" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE IF NOT EXISTS "event_p07" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE IF NOT EXISTS "event_p08" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE IF NOT EXISTS "event_p09" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE IF NOT EXISTS "event_p10" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE IF NOT EXISTS "event_p11" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE IF NOT EXISTS "event_p12" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE IF NOT EXISTS "event_p13" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE IF NOT EXISTS "event_p14" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE IF NOT EXISTS "event_p15" PARTITION OF "event" FOR VALUES WITH (MODULUS 16, REMAINDER 15);

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

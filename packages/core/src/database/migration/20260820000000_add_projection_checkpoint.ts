import type { DatabaseMigration } from "../migration"
import { sql } from "drizzle-orm"

// T3 (Memo #2): session_projection_checkpoint — durable high-water mark of
// applied projection seq per session. The table already exists in the PG
// 0000_init.sql bootstrap; this migration creates it for existing SQLite
// installs. Under SQLite the two-tier commit collapses to synchronous
// single-tier (all projectors run in-tx, checkpoint advances to the event
// seq). Under PG the checkpoint is advanced by the deferred flush tier.
export default {
  id: "20260820000000_add_projection_checkpoint",
  up: (tx) =>
    tx.run(
      sql`CREATE TABLE IF NOT EXISTS "session_projection_checkpoint" ("session_id" text PRIMARY KEY, "applied_seq" integer NOT NULL, "time_updated" integer NOT NULL)`,
    ),
} satisfies DatabaseMigration.Migration
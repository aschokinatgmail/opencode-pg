import { pgTable, text, bigint, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core"
import type { EventV2 } from "../event"

export const EventSequenceTable = pgTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: bigint({ mode: "number" }).notNull(),
  owner_id: text(),
})

// Memo #4: event is hash-partitioned by aggregate_id × 16 in the bootstrap
// DDL. Drizzle's pgTable does not model partitioning declaratively; the
// partition DDL lives in 0000_init.sql (raw SQL inside the migration). The
// table object here describes the column shape consumers query against.
// Per-partition PK is (aggregate_id, seq); the parent has no id-only PK
// (documented deviation from SQLite — per-aggregate UNIQUE (aggregate_id, id)
// preserves the dedupe check at event.ts:303-315).
export const EventTable = pgTable(
  "event",
  {
    id: text().$type<EventV2.ID>().notNull(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    seq: bigint({ mode: "number" }).notNull(),
    type: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.aggregate_id, table.seq] }),
    uniqueIndex("event_aggregate_id_id_idx").on(table.aggregate_id, table.id),
    index("event_aggregate_type_seq_idx").on(table.aggregate_id, table.type, table.seq),
  ],
)
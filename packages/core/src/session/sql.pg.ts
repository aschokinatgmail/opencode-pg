import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as DatabasePath from "../database/path.pg"
import { ProjectTable } from "../project/sql.pg"
import type { SessionMessage } from "./message"
import type { Prompt } from "./prompt"
import type { SessionInput } from "./input"
import type { Snapshot } from "../snapshot"
import { PermissionV1 } from "../v1/permission"
import { ProjectV2 } from "../project"
import type { SessionSchema } from "./schema"
import type { MessageID, PartID, SessionV1 } from "../v1/session"
import { WorkspaceV2 } from "../workspace"
import { Timestamps, epochTimestamp } from "../database/schema.sql.pg"
import type { SystemContext } from "../system-context/index"
import type { Revert } from "@opencode-ai/schema/revert"

type SessionMessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "type" | "id">
type V1MessageData = Omit<SessionV1.Info, "id" | "sessionID">
type V1PartData = Omit<SessionV1.Part, "id" | "sessionID" | "messageID">

export const SessionTable = pgTable(
  "session",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    slug: text().notNull(),
    directory: DatabasePath.directoryColumn().notNull(),
    path: DatabasePath.pathColumn(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: jsonb().$type<Snapshot.LegacyFileDiff[]>(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    cost: doublePrecision().notNull().default(0),
    tokens_input: bigint({ mode: "number" }).notNull().default(0),
    tokens_output: bigint({ mode: "number" }).notNull().default(0),
    tokens_reasoning: bigint({ mode: "number" }).notNull().default(0),
    tokens_cache_read: bigint({ mode: "number" }).notNull().default(0),
    tokens_cache_write: bigint({ mode: "number" }).notNull().default(0),
    revert: jsonb().$type<Revert.State>(),
    permission: jsonb().$type<PermissionV1.Ruleset>(),
    agent: text(),
    model: jsonb().$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    ...Timestamps,
    time_compacting: epochTimestamp(),
    time_archived: epochTimestamp(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = pgTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: jsonb().$type<V1MessageData>().notNull(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = pgTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    ...Timestamps,
    data: jsonb().$type<V1PartData>().notNull(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = pgTable(
  "todo",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.session_id, table.position] })],
  // todo_session_idx intentionally NOT created on PG — redundant with PK
  // prefix (session_id, position). See parity matrix PART 3.
)

export const SessionMessageTable = pgTable(
  "session_message",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionMessage.Type>().notNull(),
    seq: bigint({ mode: "number" }).notNull(),
    ...Timestamps,
    data: jsonb().$type<SessionMessageData>().notNull(),
  },
  (table) => [
    uniqueIndex("session_message_session_seq_idx").on(table.session_id, table.seq),
    index("session_message_session_type_seq_idx").on(table.session_id, table.type, table.seq),
    index("session_message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
    index("session_message_time_created_idx").on(table.time_created),
  ],
)

export const SessionInputTable = pgTable(
  "session_input",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    prompt: jsonb().$type<Prompt>().notNull(),
    delivery: text().$type<SessionInput.Delivery>().notNull(),
    admitted_seq: bigint({ mode: "number" }).notNull(),
    promoted_seq: bigint({ mode: "number" }),
    time_created: epochTimestamp()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    // PG partial index rewrite (parity matrix): pending scans hit the partial
    // index only. SQLite's full (session_id, promoted_seq, delivery,
    // admitted_seq) index is replaced by this partial index.
    index("session_input_session_pending_delivery_seq_idx")
      .on(table.session_id, table.delivery, table.admitted_seq)
      .where(sql`promoted_seq IS NULL`),
    uniqueIndex("session_input_session_admitted_seq_idx").on(table.session_id, table.admitted_seq),
    uniqueIndex("session_input_session_promoted_seq_idx").on(table.session_id, table.promoted_seq),
  ],
)

export const SessionContextEpochTable = pgTable("session_context_epoch", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  snapshot: jsonb().$type<SystemContext.Snapshot>().notNull(),
  baseline_seq: bigint({ mode: "number" }).notNull(),
})

// Cond 4 (Memo #9): T3 async-tier flush checkpoint (PART 2 signed DDL).
// Derived bookkeeping — batch + checkpoint advance share ONE async
// transaction (HARD rule, Memo #2). PG-only: no SQLite counterpart exists
// in schema.gen.ts (the SQLite projection path does not use this table).
// The SchemaTables type makes this entry optional so the SQLite namespace
// can omit it (see schema.pg.ts).
export const SessionProjectionCheckpointTable = pgTable("session_projection_checkpoint", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  applied_seq: bigint({ mode: "number" }).notNull(),
  time_updated: epochTimestamp().notNull(),
})
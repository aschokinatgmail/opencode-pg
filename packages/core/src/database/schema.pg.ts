// Runtime schema namespace — dialect-appropriate table objects.
//
// Consumers yield `Database.Schema` and access tables through it (e.g.
// `schema.EventTable`). The database layer provides either the SQLite or PG
// table objects based on which backend is active (DATABASE_URL set → PG).
//
// This is the wiring seam for plan decision #2: existing static imports
// (`import { EventTable } from "./event/sql"`) are replaced by
// `yield* Database.Schema` accesses one consumer at a time. Step 2 wires
// event.ts as proof; remaining consumers (projector.ts, session/store.ts,
// session/input.ts, etc.) are listed in the handoff note and rewired in
// subsequent steps.
//
// Cond 3/4 (Memo #9): `SchemaTables` is typed from the SQLite table objects
// (the original/primary backend) with `SessionProjectionCheckpointTable` as
// an OPTIONAL field. The checkpoint table exists only in PG (PART 2 signed
// DDL, T3 async-tier flush) — there is no SQLite counterpart in
// schema.gen.ts. Making it optional lets the SQLite namespace omit it while
// the PG namespace provides it. Consumers that need the checkpoint table
// must narrow to the PG namespace or check for its presence; this is
// acceptable because the checkpoint is only consumed by the PG-specific
// flush pool (Step 5). The cast at PG namespace assembly is documented at
// the assembly site (schema-pg-namespace.ts).

import { Context } from "effect"
import type { EventTable as EventTableSqlite, EventSequenceTable as EventSequenceTableSqlite } from "../event/sql"
import type { SessionTable as SessionTableSqlite, MessageTable as MessageTableSqlite, PartTable as PartTableSqlite, TodoTable as TodoTableSqlite, SessionMessageTable as SessionMessageTableSqlite, SessionInputTable as SessionInputTableSqlite, SessionContextEpochTable as SessionContextEpochTableSqlite } from "../session/sql"
import type { ProjectTable as ProjectTableSqlite, ProjectDirectoryTable as ProjectDirectoryTableSqlite } from "../project/sql"
import type { AccountTable as AccountTableSqlite, AccountStateTable as AccountStateTableSqlite, ControlAccountTable as ControlAccountTableSqlite } from "../account/sql"
import type { CredentialTable as CredentialTableSqlite } from "../credential/sql"
import type { PermissionTable as PermissionTableSqlite } from "../permission/sql"
import type { SessionShareTable as SessionShareTableSqlite } from "../share/sql"
import type { WorkspaceTable as WorkspaceTableSqlite } from "../control-plane/workspace.sql"
import type { SessionProjectionCheckpointTable as SessionProjectionCheckpointTableSqlite } from "../session/sql"

export type SchemaTables = {
  EventTable: typeof EventTableSqlite
  EventSequenceTable: typeof EventSequenceTableSqlite
  SessionTable: typeof SessionTableSqlite
  MessageTable: typeof MessageTableSqlite
  PartTable: typeof PartTableSqlite
  TodoTable: typeof TodoTableSqlite
  SessionMessageTable: typeof SessionMessageTableSqlite
  SessionInputTable: typeof SessionInputTableSqlite
  SessionContextEpochTable: typeof SessionContextEpochTableSqlite
  ProjectTable: typeof ProjectTableSqlite
  ProjectDirectoryTable: typeof ProjectDirectoryTableSqlite
  AccountTable: typeof AccountTableSqlite
  AccountStateTable: typeof AccountStateTableSqlite
  ControlAccountTable: typeof ControlAccountTableSqlite
  CredentialTable: typeof CredentialTableSqlite
  PermissionTable: typeof PermissionTableSqlite
  SessionShareTable: typeof SessionShareTableSqlite
  WorkspaceTable: typeof WorkspaceTableSqlite
  // T3 (Memo #2): async-tier flush checkpoint. Now defined in BOTH dialect
  // siblings (session/sql.ts + session/sql.pg.ts). Non-optional: both
  // namespaces provide it. Under SQLite the checkpoint is written
  // synchronously (two-tier collapses to single-tier); under PG it is
  // written by the deferred flush tier.
  SessionProjectionCheckpointTable: typeof SessionProjectionCheckpointTableSqlite
}

export class Schema extends Context.Service<Schema, SchemaTables>()("@opencode-ai/core/database/DatabaseSchema") {}
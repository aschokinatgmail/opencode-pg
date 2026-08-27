// SQLite schema namespace — the SQLite table objects assembled into the
// SchemaTables shape so the Database layer can provide them as a
// Database.Schema service. This is the SQLite side of the dual-dialect
// schema seam; the PG side lives in the *.pg.ts sibling files and will be
// assembled into an equivalent namespace when the PG path is fully wired.

import type { SchemaTables } from "./database/schema.pg"
import { EventTable, EventSequenceTable } from "./event/sql"
import {
  SessionTable,
  MessageTable,
  PartTable,
  TodoTable,
  SessionMessageTable,
  SessionInputTable,
  SessionContextEpochTable,
  SessionProjectionCheckpointTable,
} from "./session/sql"
import { ProjectTable, ProjectDirectoryTable } from "./project/sql"
import { AccountTable, AccountStateTable, ControlAccountTable } from "./account/sql"
import { CredentialTable } from "./credential/sql"
import { PermissionTable } from "./permission/sql"
import { SessionShareTable } from "./share/sql"
import { WorkspaceTable } from "./control-plane/workspace.sql"

export const namespace: SchemaTables = {
  EventTable,
  EventSequenceTable,
  SessionTable,
  MessageTable,
  PartTable,
  TodoTable,
  SessionMessageTable,
  SessionInputTable,
  SessionContextEpochTable,
  ProjectTable,
  ProjectDirectoryTable,
  AccountTable,
  AccountStateTable,
  ControlAccountTable,
  CredentialTable,
  PermissionTable,
  SessionShareTable,
  WorkspaceTable,
  SessionProjectionCheckpointTable,
}
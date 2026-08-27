// Cond 3 (Memo #9): PG schema namespace — the PG table objects assembled
// into the SchemaTables shape so the Database layer can provide them as a
// Database.Schema service when DATABASE_URL is set. Mirrors the SQLite
// namespace (schema-sqlite-namespace.ts) but sources from the *.sql.pg.ts
// siblings.
//
// The PG table objects are different TypeScript types than their SQLite
// counterparts (drizzle-orm pg-core vs sqlite-core base classes), but the
// SchemaTables type is declared from the SQLite types. The PG namespace
// satisfies the same field set structurally at the query-builder level; the
// cast here is at the assembly boundary only (`as unknown as SchemaTables`,
// not `as any`). This mirrors the accepted erasure at the database.ts
// service boundary (Memo #9 §8.5: "pgDb as unknown as DatabaseShape —
// type-level only, ACCEPTED"). The cast is safe because the query builder
// API is identical across Drizzle dialects; only the column/table base
// classes differ, and those are erased at the SqlClient boundary the
// bridge consumes.

import type { SchemaTables } from "./database/schema.pg"
import { EventTable, EventSequenceTable } from "./event/sql.pg"
import {
  SessionTable,
  MessageTable,
  PartTable,
  TodoTable,
  SessionMessageTable,
  SessionInputTable,
  SessionContextEpochTable,
  SessionProjectionCheckpointTable,
} from "./session/sql.pg"
import { ProjectTable, ProjectDirectoryTable } from "./project/sql.pg"
import { AccountTable, AccountStateTable, ControlAccountTable } from "./account/sql.pg"
import { CredentialTable } from "./credential/sql.pg"
import { PermissionTable } from "./permission/sql.pg"
import { SessionShareTable } from "./share/sql.pg"
import { WorkspaceTable } from "./control-plane/workspace.sql.pg"

const pgNamespace = {
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

export const namespace: SchemaTables = pgNamespace as unknown as SchemaTables
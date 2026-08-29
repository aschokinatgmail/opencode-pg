// FM-21 (Condition C): app-layer seam for dialect-correct table objects.
//
// Never import `*/sql` table objects directly in this package — those are
// SQLite-bound at module scope and emit SQLite-dialect SQL even when the
// Database service runs on PostgreSQL (Decision Memo #19, Ruling 4). Yield
// the `Database.Schema` service instead and reference tables through it;
// core dispatches the namespace by dialect (`databaseUrl` set → PG tables,
// else SQLite), mirroring the core consumer pattern (core session.ts,
// event.ts). `SchemaNode` provides the service inside layer graphs.
export * as DatabaseSchema from "@opencode-ai/core/database/schema.pg"
export { node as SchemaNode } from "@opencode-ai/core/schema-node"

import { pgTable, text, jsonb, primaryKey } from "drizzle-orm/pg-core"
import * as DatabasePath from "../database/path.pg"
import { epochTimestamp } from "../database/schema.sql.pg"
import { ProjectSchema } from "./schema"

export const ProjectTable = pgTable("project", {
  id: text().$type<ProjectSchema.ID>().primaryKey(),
  worktree: DatabasePath.absoluteColumn().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  time_created: epochTimestamp()
    .notNull()
    .$default(() => Date.now()),
  time_updated: epochTimestamp()
    .notNull()
    .$onUpdate(() => Date.now()),
  time_initialized: epochTimestamp(),
  sandboxes: DatabasePath.absoluteArrayColumn().notNull(),
  commands: jsonb().$type<{ start?: string }>(),
})

export const ProjectDirectoryTable = pgTable(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: DatabasePath.absoluteColumn().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">(),
    strategy: text(),
    time_created: epochTimestamp()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)
import { pgTable, text, integer, boolean, primaryKey } from "drizzle-orm/pg-core"

import { AccountV2 } from "../account"
import { Timestamps, epochTimestamp } from "../database/schema.sql.pg"

export const AccountTable = pgTable("account", {
  id: text().$type<AccountV2.ID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccountV2.AccessToken>().notNull(),
  refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
  token_expiry: epochTimestamp(),
  ...Timestamps,
})

export const AccountStateTable = pgTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountV2.ID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<AccountV2.OrgID>(),
})

// LEGACY
export const ControlAccountTable = pgTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().$type<AccountV2.AccessToken>().notNull(),
    refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
    token_expiry: epochTimestamp(),
    active: boolean()
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)
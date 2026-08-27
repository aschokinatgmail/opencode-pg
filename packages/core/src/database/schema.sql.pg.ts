import { customType } from "drizzle-orm/pg-core"

// H-1 fix (Memo #12, T-A): epoch-millis PG timestamp column. Storage is
// timestamptz (signed DDL unchanged; "timestamp with time zone" is the same
// PG type under its drizzle spelling). The JS-side contract is the SQLite
// one — epoch-millis NUMBERS in both directions (schema.sql.ts:3-10).
// Accepts number | Date | string on write defensively; always reads back
// as a number (postgres-js hands timestamptz back as Date).
export const epochTimestamp = customType<{
  data: number
  driverData: string
  driverOutput: Date | string
}>({
  dataType() {
    return "timestamp with time zone"
  },
  toDriver(value) {
    const v = value as number | Date | string
    if (typeof v === "number") return new Date(v).toISOString()
    if (v instanceof Date) return v.toISOString()
    return v
  },
  fromDriver(value) {
    return value instanceof Date ? value.getTime() : Date.parse(value)
  },
})

export const Timestamps = {
  time_created: epochTimestamp()
    .notNull()
    .$default(() => Date.now()),
  time_updated: epochTimestamp()
    .notNull()
    .$onUpdate(() => Date.now()),
}
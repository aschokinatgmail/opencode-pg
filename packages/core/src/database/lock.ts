export * as Lock from "./lock"

import { isPg } from "./database"

// Cond 4 (Memo #14): confine the dialect-conditional erasure to ONE shared
// typed helper with a single documented internal cast. Replaces the four
// `(q: any)` sites (event.ts:268-270; input.ts:289-291,318-320).
//
// Precedents: channelName single-definition (Memo #1 Cond 1), toDriver
// single-cast (Memo #13 Ruling 2). The cast is `as unknown as` — not
// `as any` — and is safe because under PG the query builder IS a PG select
// builder that has `.for()`; under SQLite the helper is a pure identity
// passthrough (no cast, no `.for()` call). The generic type T is preserved
// so downstream inference (`.get()`, `.all()`) survives.
//
// `any` downstream = reject (Memo #14 Cond 4).

// Minimal interface for the PG select builder's `.for()` method. Under PG
// the runtime query builder IS a PG select builder (database.ts casts the
// PG db to DatabaseShape); this captures only the method we need, with the
// return type bound to the caller's generic T so downstream inference
// (`.get()`, `.all()`) survives.
interface PgLockable<T> {
  for(strength: "update", config?: { skipLocked?: boolean }): T
}

// Apply `FOR UPDATE` under PG; identity under SQLite.
export function forUpdate<T>(query: T): T {
  if (!isPg) return query
  // Single internal cast: T is the SQLite-typed select builder, but under
  // PG it's actually a PG select builder with `.for()`.
  return (query as unknown as PgLockable<T>).for("update")
}

// Apply `FOR UPDATE SKIP LOCKED` under PG; identity under SQLite.
export function forUpdateSkipLocked<T>(query: T): T {
  if (!isPg) return query
  return (query as unknown as PgLockable<T>).for("update", { skipLocked: true })
}
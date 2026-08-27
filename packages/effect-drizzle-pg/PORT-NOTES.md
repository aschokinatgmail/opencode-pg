# PORT-NOTES — effect-drizzle-pg

1:1 port of `packages/effect-drizzle-sqlite` → `packages/effect-drizzle-pg`. This file documents every deviation from the SQLite wrapper, with file:line cites and reasons.

## Naming map

| SQLite wrapper | PG wrapper |
|---|---|
| `SQLite*` | `Pg*` |
| `EffectSQLite*` | `EffectPg*` |
| `sqlite-core` | `pg-core` |
| `effect-sqlite` | `effect-pg` |
| `SQLiteAsyncDialect` | `PgDialect` |
| `SQLiteTable` | `PgTable` |
| `SQLiteViewBase` | `PgViewBase` |
| `SQLiteColumn` | `PgColumn` |
| `SQLiteTransactionConfig` | `PgTransactionConfig` |
| `SQLiteInsertConfig` / `SQLiteUpdateConfig` / `SQLiteDeleteConfig` / `SQLiteSelectConfig` | `PgInsertConfig` / `PgUpdateConfig` / `PgDeleteConfig` / `PgSelectConfig` |
| `SQLiteSelectQueryBuilderBase` | `PgSelectBase` (see deviation #1) |
| `SQLiteExecuteMethod` | `PgExecuteMethod` (local alias; see deviation #2) |
| `extractUsedTable` from `drizzle-orm/sqlite-core/utils` | `extractUsedTable` from `drizzle-orm/pg-core/utils` |
| `sqlite_master` / `pragma_table_info` | `information_schema.tables` / `information_schema.columns` |
| `effect_sql_${id}` savepoint | `effect_pg_${id}` savepoint |

## Deviations

### 1. `PgEffectSelectBase` extends `PgSelectBase`, not a `*QueryBuilderBase`

**SQLite source**: `src/sqlite-core/effect/select.ts` — `SQLiteEffectSelectBase` extends `SQLiteSelectQueryBuilderBase` (an abstract base in upstream `drizzle-orm/sqlite-core/query-builders/select` that does NOT have `from()`/`prepare()`/`run()`/`all()`/`get()`/`values()`/`execute`). The SQLite wrapper's `SQLiteEffectSelectBuilder.from()` constructs a fully-configured `SQLiteEffectSelectBase` directly.

**PG port**: `src/pg-core/effect/select.ts` — `PgEffectSelectBase` extends `PgSelectBase` (the concrete base in `drizzle-orm/pg-core/query-builders/select`). In drizzle-orm@1.0.0-rc.2, `PgSelectBase` is concrete and has `from()`/`getSQL()`/`toSQL()`/`$withCache()` baked in, but does NOT have `prepare()`/`run()`/`all()`/`get()`/`values()`/`execute()` — those are added by the Effect wrapper.

**Reason**: RC2's PG query builders are structured differently from SQLite's. `PgSelectBase` plays the role that `SQLiteSelectQueryBuilderBase` + `SQLiteSelectBase` play together. The Effect wrapper adds the execution methods on top.

**Constructor difference**: `PgSelectBase`'s constructor accepts `{ fields, session, dialect, withList, distinct, tagged }` — it does NOT accept `table` or `isPartialSelect` (those are set by the inherited `from()` method). The `PgEffectSelectBase` constructor overrides this to accept `{ table, fields, isPartialSelect, session, dialect, withList, distinct }`, calls `super({ fields, session, dialect, withList, distinct })`, then replicates the `PgSelectBase.from()` setup logic (setting `config.table`, `config.fields`, `isPartialSelect`, `tableName`, `joinsNotNullableMap`, `usedTables`, `this._`) so the builder can construct a fully-configured Effect-yieldable select without calling the inherited `from()` (which returns the wrong type for the Effect wrapper). See `src/pg-core/effect/select.ts` lines 38-66.

### 2. `PgSession.prepareQuery` signature differs from `SQLiteSession.prepareQuery`

**SQLite source**: `drizzle-orm/sqlite-core/session` — `SQLiteSession.prepareQuery(query, fields, executeMethod, customResultMapper, queryMetadata, cacheConfig)` uses an `executeMethod: "run" | "all" | "get"` vocabulary.

**PG port**: `drizzle-orm/pg-core/session` — `PgSession.prepareQuery(query, mode, name, mapper, queryMetadata, cacheConfig)` uses a `mode: "arrays" | "objects" | "raw"` vocabulary and a `name` parameter.

**Decision**: The Effect wrapper keeps the SQLite-style `executeMethod` vocabulary (`"run" | "all" | "get" | "values"`) internally because it translates to the generic `SqlClient` statement API (`statement.withoutTransform`, `statement.values`, etc.), not to `PgSession`'s mode-based API. The `PgEffectSession` abstract class declares `prepareQuery` with the `executeMethod: "run" | "all" | "get"` signature (mirroring the SQLite wrapper), and the concrete `EffectPgSession` implements it by calling `this.client.unsafe(query.sql, params)` on the generic `SqlClient`. This keeps the bridge dialect-generic per plan decision #2. See `src/pg-core/effect/session.ts` lines 28-35, 175-195; `src/effect-pg/session.ts` lines 40-67.

### 3. Deferred-constraint quirk (HOT SPOT — mandatory analysis)

**SQLite source**: `src/effect-sqlite/session.ts` lines 157-163 (the `withTransaction` method's commit branch):

```ts
? this.executeTransactionStatement(connection, "commit").pipe(
    // SQLite keeps the transaction open after deferred constraint commit failures.
    Effect.catch((error) =>
      this.executeTransactionStatement(connection, "rollback").pipe(
        Effect.catch(() => Effect.void),
        Effect.andThen(Effect.fail(error)),
      ),
    ),
  )
```

**What it does**: When `COMMIT` fails on SQLite due to a deferred foreign-key constraint violation (constraints deferred via `BEGIN DEFERRED` are only checked at `COMMIT` time), SQLite does NOT auto-rollback the transaction — the transaction remains open but in a failed state. The code explicitly issues `ROLLBACK` to clean up, swallows any error from the rollback (the transaction may already be in a state where rollback itself errors), then fails with the original commit error.

**PG port**: `src/effect-pg/session.ts` lines 113-125 — identical structure preserved:

```ts
? this.executeTransactionStatement(connection, "commit").pipe(
    // PG auto-rollbacks on commit failure (deferred constraint violations abort
    // the transaction). The explicit rollback is a no-op safety net: if the
    // transaction is already aborted, ROLLBACK succeeds; if not, it would
    // error, which we swallow. See PORT-NOTES.md for the full analysis.
    Effect.catch((error) =>
      this.executeTransactionStatement(connection, "rollback").pipe(
        Effect.catch(() => Effect.void),
        Effect.andThen(Effect.fail(error)),
      ),
    ),
  )
```

**Analysis — does PG need an equivalent, a simplification, or nothing?**

- **PG constraint deferral model**: PG supports `DEFERRABLE INITIALLY DEFERRED` constraints (per-constraint, declared in the schema). When such a constraint is violated, the error is raised at `COMMIT` time.
- **PG transaction abort semantics**: Unlike SQLite, when any statement (including `COMMIT`) fails in a PG transaction, PG **automatically aborts the entire transaction** — the transaction enters an "aborted" state where all subsequent statements fail with `current transaction is aborted, commands ignored until end of transaction block`, and the transaction is rolled back when the connection returns to the pool.
- **Therefore**: The explicit `ROLLBACK` after a failed `COMMIT` is **unnecessary in PG** — PG has already aborted and will roll back the transaction. However, issuing `ROLLBACK` on an already-aborted transaction is **harmless**: it succeeds (PG accepts `ROLLBACK` on an aborted transaction and cleans up). If the transaction were somehow NOT aborted (a theoretical edge case), the `ROLLBACK` would error, which the inner `Effect.catch(() => Effect.void)` swallows.
- **Decision**: **Preserved the structure 1:1** for parity. The explicit `ROLLBACK` is a no-op safety net in PG, not a correctness requirement. Removing it would be a simplification, but keeping it maintains the 1:1 mandate and is harmless. The comment documents the semantic difference.

**PG savepoint semantics**: PG's `ROLLBACK TO SAVEPOINT` and `RELEASE SAVEPOINT` semantics match the SQLite wrapper's nested-transaction model exactly. `ROLLBACK TO SAVEPOINT effect_pg_${id}` rolls back to the savepoint but does not remove it; the wrapper follows with `RELEASE SAVEPOINT effect_pg_${id}` to remove it (matching the SQLite wrapper's `rollback to savepoint effect_sql_${id}` + `release savepoint effect_sql_${id}` pattern). This is correct for PG.

### 4. `BEGIN` syntax differs

**SQLite source**: `src/effect-sqlite/session.ts` line ~140 — `begin ${config?.behavior ?? "deferred"}` where `behavior` is `"deferred" | "immediate" | "exclusive"`.

**PG port**: `src/effect-pg/session.ts` lines 143-154 — `buildBegin(config)` constructs `BEGIN ISOLATION LEVEL X, READ ONLY|WRITE, DEFERRABLE|NOT DEFERRABLE` from `PgTransactionConfig` (`isolationLevel`, `accessMode`, `deferrable`). PG has no equivalent of SQLite's `BEGIN DEFERRED` (constraint deferral is per-constraint via `DEFERRABLE INITIALLY DEFERRED`, not per-transaction). The `deferrable` flag in `PgTransactionConfig` controls whether the transaction itself is deferrable (a PG-specific feature for deferred constraint checking across the whole transaction), which is the closest semantic analog.

### 5. Migration journal table column types

**SQLite source**: `src/sqlite-core/effect/session.ts` lines ~345-353 — journal table uses `id INTEGER PRIMARY KEY`, `created_at numeric`, `applied_at TEXT`.

**PG port**: `src/pg-core/effect/session.ts` lines ~360-368 — journal table uses `id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`, `created_at bigint`, `applied_at timestamptz`. Per plan decision #3: `timestamptz` everywhere. `BIGINT GENERATED BY DEFAULT AS IDENTITY` is the PG equivalent of SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT`. `created_at` stays `bigint` (matches the `folderMillis` numeric value drizzle stores).

### 6. Up-migration introspection probes

**SQLite source**: `src/up-migrations/effect-sqlite.ts` — uses `sqlite_master` for table-exists probe and `pragma_table_info` for column-shape probe.

**PG port**: `src/up-migrations/pg.ts` + `src/up-migrations/effect-pg.ts` — uses `information_schema.tables` (filtered by `table_schema = current_schema()`) for table-exists probe and `information_schema.columns` (same schema filter) for column-shape probe. The `current_schema()` filter ensures we only look in the current search path, matching SQLite's single-database model. The backfill ALTER statements use PG syntax (`ALTER TABLE ... ADD COLUMN`) and the `applied_at` column is `timestamptz` (per deviation #5).

### 7. `PgView` vs `SQLiteView` in count builder

**SQLite source**: `src/sqlite-core/effect/count.ts` — `buildSQLiteEmbeddedCount`/`buildSQLiteCount` accept `SQLiteTable | SQLiteView | SQL | SQLWrapper`.

**PG port**: `src/pg-core/effect/count.ts` — `buildPgEmbeddedCount`/`buildPgCount` accept `PgTable | PgView | SQL | SQLWrapper`. `PgView` is imported from `drizzle-orm/pg-core/view` (the concrete view type, matching how the SQLite wrapper imports `SQLiteView` from `drizzle-orm/sqlite-core/view`).

### 8. `@effect/sql-pg` devDependency for tests

**SQLite source**: `@effect/sql-sqlite-bun` is a devDependency for tests.

**PG port**: `@effect/sql-pg` is a devDependency for tests. This package provides a `SqlClient` layer for PG. The production postgres-js client layer (plan decision #1) lands in `packages/core` (Step 2), not here. The `@effect/sql-pg` package is only used to provide a `SqlClient` for the test suite; the runtime code in `src/` remains generic over `effect/unstable/sql/SqlClient`.

**Version note**: The catalog pins `@effect/sql-pg` at `4.0.0-beta.83` (matching the `effect` version), NOT `0.53.0`. The `0.x` line of `@effect/sql-pg` depends on the separate `@effect/sql` package (pre-merge into `effect/unstable/sql`), which provides a different `SqlClient` Context tag (`@effect/sql/SqlClient`) than the one this bridge depends on (`effect/unstable/sql/SqlClient`). The `4.0.0-beta.*` line depends directly on `effect` and provides `effect/unstable/sql/SqlClient`, making it compatible with this bridge.

### 9. `withReplicas` uses `any` casts (inherited from SQLite wrapper)

Both the SQLite and PG `withReplicas` functions use `any` casts for the replica-delegation methods. This is inherited 1:1 from the SQLite wrapper (which itself inherits it from upstream drizzle-orm). The `any` usage is confined to this one helper function and matches the upstream pattern; it is not introduced by this port.

### 10. `PgSelectBase.$withCache` return type

**SQLite source**: `SQLiteSelectQueryBuilderBase.$withCache` returns `SQLiteSelectWithout<this, TDynamic, "$withCache">`.

**PG port**: `PgSelectBase.$withCache` returns `this`. The `PgEffectSelectBase` overrides `$withCache` to set `this.cacheConfig` and return `this` (matching the SQLite Effect wrapper's behavior). The return type difference is upstream (RC2's PG base returns `this`; the SQLite base returns a `*Without` type). The Effect wrapper's override returns `this` in both cases, so the observable behavior is identical.

### 11. FM-25 deviation repair: RC2 codec parity in `orderSelectedFields` / `mapResultRow` (Memo #12, B-A)

**Root cause**: The vendored `orderSelectedFields` (`src/internal/drizzle-utils.ts`) and `mapResultRow` shims predated RC2's codec layer. RC2 moved bigint decode OUT of columns (`PgBigInt53` has no `mapFromDriverValue`; base is `noop`) INTO a codec registry (`genericPgCodecs["bigint:number"].normalize = Number`, `pg-core/codecs.cjs`) that RC2's own `orderSelectedFields(fields, pathPrefix, codecs)` + `mapResultRow`/`makeJitQueryMapper` apply via per-field `codec(rawValue, arrayDimensions)`. The vendored shims dropped the `codecs` param (entries were `{path, field}` only) and `mapResultRow` called `mapFromDriverValue(rawValue)` bare. Result: `bigint({mode:"number"})` columns read back as STRINGS through `select` AND `.returning()` on both jit (default, `driver.ts:61`) and non-jit paths — `session_message.seq`, `session_input.admitted_seq` runtime-proven; `SessionInput.find` decode failed on the string shape.

**Repair (B-A, per §10.2 SURFACE A′)**:
- `src/internal/drizzle-utils.ts`: construct `pgCodecs = new CodecsCollection(resolvePgTypeAlias, effectPgCodecs)` once from drizzle's own exports (`drizzle-orm/codecs` `CodecsCollection` + `drizzle-orm/effect-postgres/codecs` `effectPgCodecs` + `drizzle-orm/pg-core/codecs` `resolvePgTypeAlias`). Import path spiked against `drizzle-orm@1.0.0-rc.2` exports map — runtime + types confirmed (fallback level 1 of the memo's sanctioned chain; no local mirror needed).
- `orderSelectedFields(fields, pathPrefix?, codecs = pgCodecs)`: Column entries now attach `codec: codecs.get(column, "normalize")` + `arrayDimensions: column.dimensions`; SQL/Aliased/Subquery entries stay `{path, field}`. Matches RC2 `utils.cjs` `orderSelectedFields` shape.
- `mapResultRow`: `decoder.mapFromDriverValue(codec ? codec(rawValue, arrayDimensions) : rawValue)` per RC2 shape; existing joins-nullify logic preserved.
- Threaded `pgCodecs` through all four call sites: `select.ts:259`, `insert.ts:256`, `update.ts:317`, `delete.ts:175`.
- JIT path needs no code change: once entries carry `codec`, RC2's `makeJitQueryMapper` (imported unchanged from `drizzle-orm/utils`) emits the codec call itself.

**Acceptance**: `pgCodecs.get(bigint({mode:"number"}) column, "normalize") === Number` — spiked. `bigint({mode:"number"})` round-trips as NUMBER via `select` AND `.returning()` on both jit-enabled and jit-disabled paths (regression tests in `test/bigint-codec.test.ts`).

**Rejected alternatives**: B-B (consumer-side `Number(row.x)` casts) — rejected per memo; consumers are already typed to numbers, `.returning()` sites would still miss, and it churns the codebase to compensate for a driver-layer defect. B-A′ (custom `bigintNumber` column) — acceptable only as a hot-fallback if the import had blocked; not needed (level 1 import succeeded).

### 12. FM-26: onConflict RC2-alignment (body-only builder methods, dialect-owned prefix)

**Root cause**: The SQLite wrapper's `onConflictDoNothing`/`onConflictDoUpdate` methods (effect-drizzle-sqlite `src/sqlite-core/effect/insert.ts:261-270`) push PREFIX-INCLUDED fragments into an `onConflict?: SQL[]` array. RC2's SQLite dialect joins that array with no prefix (`sqlite-core/dialect.cjs:247`: `sql.join(onConflict)`), so the methods MUST prepend ` on conflict ` themselves. The PG port copied those method bodies across the dialect boundary without adapting to RC2's PG contract, which is a scalar `onConflict?: SQL` (`pg-core/query-builders/insert.cjs:99-146`, `insert.d.ts:23`) and whose dialect PREPENDS the prefix (`pg-core/dialect.cjs:283`: `onConflict ? sql\` on conflict ${onConflict}\` : void 0`). Result: double prefix `on conflict on conflict …` — invalid SQL on every PG upsert.

**Repair (retroactive, Memo #13 Ruling 3)**: `src/pg-core/effect/insert.ts:260-286` (DoNothing + DoUpdate) now stores the clause BODY ONLY, matching RC2's PG builder assembly exactly. The prefix is owned by RC2's own `PgDialect.buildInsertQuery` (driver.ts:56 instantiates `new PgDialect()`); the bridge does not vendor the prefix. Conflict-target rendering uses `this.effectDialect.escapeName(column.name)` + `sql.raw(...)` — identical to RC2's PG builder (`pg-core/query-builders/insert.cjs:99-146`), producing unqualified `("col")` targets. No remaining byte-level divergence.

**Blast radius**: 9 core call sites across 7 files (event.ts:334, projector.ts:280/331/385, input.ts:122, context-epoch.ts:157, session.ts:226, directories.ts:74-81, permission/saved.ts:69) — every PG upsert would have emitted invalid SQL pre-fix.

**Reference**: Memo #13 Ruling 3, FM-26 in PART 4 failure-mode table.
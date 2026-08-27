# Effect Drizzle PG

This package vendors a Drizzle Effect PostgreSQL adapter for this repo. It is a 1:1 port of `packages/effect-drizzle-sqlite`, mirrored under `Pg*` names with `pg-core` in place of `sqlite-core`.

- Keep this package generic: Drizzle + Effect + PostgreSQL only.
- Do not add opencode-specific tables, paths, migrations, post-commit hooks, or domain storage APIs here.
- Runtime code should depend on generic `effect/unstable/sql/SqlClient`, not a specific PostgreSQL driver.
- Concrete PostgreSQL clients such as `@effect/sql-pg` belong in tests or examples unless this package intentionally adds a driver-specific helper.
- Preserve Drizzle adapter naming and behavior where possible so this can be replaced by upstream `drizzle-orm/effect-pg` later.
- If touching copied Drizzle internals, compare with current `drizzle-orm@1.0.0-rc.2` declarations and runtime JS.
- If touching Effect APIs, verify against the effect-smol reference.

Useful entry points:

- `src/effect-pg/driver.ts`: creates the Effect-backed Drizzle database with `make` and `makeWithDefaults`.
- `src/effect-pg/session.ts`: adapts generic Effect `SqlClient` execution and transactions to Drizzle PG sessions.
- `src/pg-core/effect/*`: Effect-yieldable PostgreSQL query builders.
- `src/internal/drizzle-utils.ts`: local typed shims for Drizzle runtime internals that RC2 does not expose in declarations.
- `PORT-NOTES.md`: documents every deviation from the SQLite wrapper, including the deferred-constraint analysis.

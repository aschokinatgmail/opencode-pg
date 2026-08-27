# Step 8 — opencode PG staging service image.
#
# Multi-stage build: compiles the opencode binary from source (bun build --compile),
# then copies the blessed .opencode/db-migrations/ directory alongside it so the
# PG migration runner (migration.pg.ts) can read 0000_init.sql at runtime.
#
# The migration runner resolves migrationsDir() via import.meta.url:
#   resolve(here, "../../../../.opencode/db-migrations")
# In a Bun-compiled binary, import.meta.url resolves to /.opencode/db-migrations/
# on the real filesystem — the build-stage COPY (~:92 below) is the staging source
# for the runtime COPY (~:128), which places the directory at that exact path in
# the runtime image. The compiled binary reads the files from the real filesystem,
# not from a virtual filesystem.
#
# Plan: pg-backend-staging.md Step 8 — "Extend existing Dockerfile pattern."
# Memo #10 Cond 5: COPY .opencode/db-migrations to the resolved runtime path +
# dir-exists precheck with actionable error before readFile.

# --- Stage 1: build the opencode binary -------------------------------------

FROM oven/bun:1.3 AS build

WORKDIR /app

# node-gyp needs python3, make, g++ for native trustedDependencies
# (tree-sitter-powershell, tree-sitter-bash, node-pty, etc.).
# git is needed by packages/script/src/index.ts to determine the release channel.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for install caching. Every workspace package
# declared in root package.json (packages/*, packages/console/*, packages/stats/*,
# packages/sdk/js, packages/slack) must have its manifest present before
# `bun install --frozen-lockfile`, or bun fails with "Workspace not found".
COPY package.json bun.lock bunfig.toml ./
# patchedDependencies in package.json reference patches/*.patch; bun install
# fails if the patches directory is missing.
COPY patches/ patches/
COPY packages/opencode/package.json packages/opencode/
COPY packages/core/package.json packages/core/
# Root postinstall runs `bun run --cwd packages/core fix-node-pty` during
# `bun install`, so the script must be present before install.
COPY packages/core/script/fix-node-pty.ts packages/core/script/fix-node-pty.ts
COPY packages/effect-drizzle-pg/package.json packages/effect-drizzle-pg/
COPY packages/effect-drizzle-sqlite/package.json packages/effect-drizzle-sqlite/
COPY packages/effect-sqlite-node/package.json packages/effect-sqlite-node/
COPY packages/schema/package.json packages/schema/
COPY packages/plugin/package.json packages/plugin/
COPY packages/llm/package.json packages/llm/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/sdk-next/package.json packages/sdk-next/
COPY packages/script/package.json packages/script/
COPY packages/codemode/package.json packages/codemode/
COPY packages/http-recorder/package.json packages/http-recorder/
COPY packages/httpapi-codegen/package.json packages/httpapi-codegen/
COPY packages/server/package.json packages/server/
COPY packages/tui/package.json packages/tui/
COPY packages/ui/package.json packages/ui/
COPY packages/client/package.json packages/client/
COPY packages/cli/package.json packages/cli/
COPY packages/app/package.json packages/app/
COPY packages/desktop/package.json packages/desktop/
COPY packages/web/package.json packages/web/
COPY packages/enterprise/package.json packages/enterprise/
COPY packages/function/package.json packages/function/
COPY packages/session-ui/package.json packages/session-ui/
COPY packages/storybook/package.json packages/storybook/
COPY packages/slack/package.json packages/slack/
COPY packages/console/app/package.json packages/console/app/
COPY packages/console/core/package.json packages/console/core/
COPY packages/console/function/package.json packages/console/function/
COPY packages/console/mail/package.json packages/console/mail/
COPY packages/console/resource/package.json packages/console/resource/
COPY packages/console/support/package.json packages/console/support/
COPY packages/stats/app/package.json packages/stats/app/
COPY packages/stats/core/package.json packages/stats/core/
COPY packages/stats/server/package.json packages/stats/server/
# packages/app and packages/session-ui depend on a local tarball via file: dep.
COPY packages/app/vendor/ packages/app/vendor/

# Install dependencies (platform-native for the build host).
RUN bun install --frozen-lockfile

# Copy the full source tree.
COPY packages/ packages/

# Copy the blessed migrations directory (Memo #7 Condition 1: byte-identical
# single source of truth). This is the staging source for the runtime COPY
# (~:128); the compiled binary resolves migrationsDir() to
# /.opencode/db-migrations/ on the real filesystem.
COPY .opencode/db-migrations/ .opencode/db-migrations/
# packages/script/src/index.ts reads .github/TEAM_MEMBERS during build.
COPY .github/TEAM_MEMBERS .github/TEAM_MEMBERS

# Build the opencode binary for the current platform (linux).
# --single builds only for the current host arch; --skip-embed-web-ui avoids
# the web UI bundle (not needed for a headless PG staging server).
# --skip-install skips re-installing platform-specific native deps.
# OPENCODE_CHANNEL=latest skips the `git branch --show-current` fallback
# (no .git in the build context — .dockerignore excludes it).
ARG OPENCODE_CHANNEL=latest
ENV OPENCODE_CHANNEL=${OPENCODE_CHANNEL}
RUN cd packages/opencode && bun run script/build.ts --single --skip-embed-web-ui --skip-install

# --- Stage 2: runtime image -------------------------------------------------
# Debian-slim (not Alpine) because the compiled Bun binary is linked against
# glibc from the oven/bun:1.3 build stage; musl-based Alpine would fail with
# "not found" (dynamic linker mismatch).
FROM debian:bookworm-slim AS runtime

# Disable the runtime transpiler cache (ephemeral containers — cache is useless).
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

RUN apt-get update && apt-get install -y --no-install-recommends libgcc-s1 libstdc++6 ripgrep ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary. The build script outputs to dist/<name>/bin/opencode.
# The exact name depends on host arch; use a glob to find it.
COPY --from=build /app/packages/opencode/dist/*/bin/opencode /usr/local/bin/opencode

# Verify the binary runs.
RUN opencode --version

# The migration runner resolves migrationsDir() from import.meta.url, which in
# a Bun-compiled binary resolves to /.opencode/db-migrations/ on the real
# filesystem (not bunfs). COPY the blessed migrations to that exact path.
COPY --from=build /app/.opencode/db-migrations/ /.opencode/db-migrations/

# Entrypoint: run the opencode server. The migration runner executes
# automatically on boot (database.ts pgLayerInit → DatabaseMigrationPg.apply),
# under pg_advisory_lock(727274) via client.reserve (Memo #5). The boot
# readiness barrier is the advisory lock itself — the first container to boot
# acquires the lock and applies 0000_init.sql; subsequent containers probe
# information_schema, find 'session' present, and skip to replay-only path.
ENTRYPOINT ["opencode"]
CMD ["serve"]
-- initdb script: loaded by postgres:17-alpine via docker-entrypoint-initdb.d
-- Creates pg_stat_statements extension at cluster init time.
-- Stats populate only when shared_preload_libraries includes pg_stat_statements
-- (set in the compose command: -c shared_preload_libraries=pg_stat_statements).
-- The extension is also created inside 0000_init.sql via a guarded DO block;
-- this initdb script is the early-init equivalent for fresh clusters.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
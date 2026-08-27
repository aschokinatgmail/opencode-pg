import { Layer } from "effect"
import * as DatabaseSchema from "./database/schema.pg"
import * as SchemaSqliteNamespace from "./schema-sqlite-namespace"
import * as SchemaPgNamespace from "./schema-pg-namespace"
import { makeGlobalNode } from "./effect/app-node"
import { databaseUrl } from "./database/database"

const namespace = databaseUrl ? SchemaPgNamespace.namespace : SchemaSqliteNamespace.namespace

export const node = makeGlobalNode({
  service: DatabaseSchema.Schema,
  layer: Layer.succeed(DatabaseSchema.Schema, namespace as unknown as InstanceType<typeof DatabaseSchema.Schema>),
  deps: [],
})
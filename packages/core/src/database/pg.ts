export * as Pg from "./pg"

import { Context } from "effect"
import type { EffectPgDatabase } from "@opencode-ai/effect-drizzle-pg"

export type DrizzleClient = EffectPgDatabase
export class Native extends Context.Service<Native, unknown>()("@opencode-ai/core/database/PgNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@opencode-ai/core/database/PgDrizzle") {}
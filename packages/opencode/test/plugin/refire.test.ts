import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Config } from "@/config/config"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

// Cross-module observation channel: plugin sources push into a shared record so
// the test can assert call order and payload identity across module boundaries.
declare global {
  var __refireTest: { calls: Array<{ tag: string; name: string; model?: string }> }
}

function resetChannel() {
  ;(globalThis as { __refireTest?: unknown }).__refireTest = { seen: [], expected: undefined }
}

function withProject<A, E, R>(sources: Array<{ filename: string; source: string }>, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.all(
      [
        ...sources.map(({ filename, source }) =>
          Effect.promise(() => Bun.write(path.join(test.directory, filename), source)),
        ),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: sources.map(({ filename }) => pathToFileURL(path.join(test.directory, filename)).href),
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

function pluginSource(input: { name: string; config?: string; dispose?: boolean }) {
  const lines = [
    "export default async () => ({",
    ...(input.config !== undefined
      ? [`  config: async (cfg) => { ${input.config} },`]
      : [`  config: async (cfg) => { globalThis.__refireTest.calls.push({ tag: "config", name: ${JSON.stringify(input.name)}, model: cfg?.model }) },`]),
    ...(input.dispose === true
      ? [`  dispose: async () => { globalThis.__refireTest.calls.push({ tag: "dispose", name: ${JSON.stringify(input.name)} }) },`]
      : []),
    "})",
    "",
  ]
  return lines.join("\n")
}

describe("Plugin.refireConfig", () => {
  it.instance("re-fires config hooks of the current hooks list without running hook.dispose", () =>
    withProject(
      [
        { filename: "plugin-a.ts", source: pluginSource({ name: "a" }) },
        { filename: "plugin-b.ts", source: pluginSource({ name: "b", dispose: true }) },
      ],
      Effect.gen(function* () {
        ;(globalThis as { __refireTest?: unknown }).__refireTest = { calls: [] }
        const plugin = yield* Plugin.Service
        yield* plugin.init()
        ;(globalThis as { __refireTest?: unknown }).__refireTest = { calls: [] }

        yield* plugin.refireConfig({ model: "refire/model" } as Config.Info)

        const calls = (globalThis as { __refireTest: { calls: Array<{ tag: string; name: string; model?: string }> } })
          .__refireTest.calls
        expect(calls).toEqual([
          { tag: "config", name: "a", model: "refire/model" },
          { tag: "config", name: "b", model: "refire/model" },
        ])
        expect(calls.filter((call) => call.tag === "dispose")).toEqual([])
      }),
    ),
  )

  it.instance("passes the exact fresh config object to every hook", () =>
    withProject(
      [
        {
          filename: "plugin-identity.ts",
          source: pluginSource({
            name: "identity",
            config: `globalThis.__refireTest.calls.push({ tag: "config", name: "identity", model: cfg?.model })`,
          }),
        },
      ],
      Effect.gen(function* () {
        ;(globalThis as { __refireTest?: unknown }).__refireTest = { calls: [] }
        const plugin = yield* Plugin.Service
        yield* plugin.init()
        ;(globalThis as { __refireTest?: unknown }).__refireTest = { calls: [] }

        const expected = { model: "object/model" } as Config.Info
        yield* plugin.refireConfig(expected)

        const calls = (globalThis as { __refireTest: { calls: Array<{ tag: string; name: string; model?: string }> } })
          .__refireTest.calls
        expect(calls).toEqual([{ tag: "config", name: "identity", model: "object/model" }])
      }),
    ),
  )
})

import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { GlobalBus } from "@/bus/global"
import { reloadInstanceConfig } from "@/server/routes/instance/httpapi/handlers/instance"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Plugin } from "@/plugin"
import type { InstanceContext } from "@/project/instance-context"

const freshConfig = { model: "fresh/model" } as Config.Info

const calls = {
  reload: 0,
  refire: [] as Array<Config.Info>,
  agentReload: 0,
  events: [] as Array<{ type: string; directory?: string; project?: string }>,
}

const ctx: InstanceContext = {
  directory: "/proj/instance-dir",
  worktree: "/proj/instance-dir",
  project: {
    id: "project_test" as InstanceContext["project"]["id"],
    worktree: "/proj/instance-dir",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}

const configService: Config.Interface = {
  get: () => Effect.succeed(freshConfig),
  getGlobal: () => Effect.succeed({}),
  getConsoleState: () => Effect.succeed({} as never),
  update: () => Effect.void,
  updateGlobal: () => Effect.succeed({ info: freshConfig, changed: false }),
  invalidate: () => Effect.void,
  reload: Effect.fn("TestConfig.reload")(function* () {
    calls.reload += 1
    return freshConfig
  }),
  directories: () => Effect.succeed([]),
  waitForDependencies: () => Effect.void,
}

const pluginService: Plugin.Interface = {
  trigger: ((_name: unknown, _input: unknown, output: unknown) =>
    Effect.succeed(output)) as Plugin.Interface["trigger"],
  list: () => Effect.succeed([]),
  init: () => Effect.void,
  refireConfig: (cfg) => {
    calls.refire.push(cfg)
    return Effect.void
  },
}

const agentService: Agent.Interface = {
  get: () => Effect.succeed({} as Agent.Info),
  list: () => Effect.succeed([]),
  defaultInfo: () => Effect.succeed({} as Agent.Info),
  defaultAgent: () => Effect.succeed("build"),
  reload: Effect.fn("TestAgent.reload")(function* () {
    calls.agentReload += 1
  }),
  generate: () => Effect.succeed({ identifier: "x", whenToUse: "x", systemPrompt: "x" }),
}

describe("reloadConfig handler", () => {
  test("invalidates config, refires with the fresh object, invalidates agents, emits once, returns true", () => {
    const listener = (event: { directory?: string; project?: string; payload: { type: string } }) => {
      calls.events.push({ type: event.payload.type, directory: event.directory, project: event.project })
    }
    GlobalBus.on("event", listener)

    return Effect.runPromise(
      reloadInstanceConfig({ config: configService, plugin: pluginService, agent: agentService, ctx })(),
    ).then((result) => {
      GlobalBus.off("event", listener)
      expect(result).toBe(true)
      expect(calls.reload).toBe(1)
      expect(calls.refire).toEqual([freshConfig])
      expect(calls.agentReload).toBe(1)
      expect(calls.events).toEqual([
        { type: "server.instance.reloaded", directory: "/proj/instance-dir", project: "project_test" },
      ])
    })
  })

  test("runs config.reload before refireConfig before agent.reload in one ordered list", () => {
    const order: string[] = []
    const configServiceOrdered: Config.Interface = {
      ...configService,
      reload: Effect.fn("TestConfig.reloadOrdered")(function* () {
        order.push("config")
        return freshConfig
      }),
    }
    const pluginServiceOrdered: Plugin.Interface = {
      ...pluginService,
      refireConfig: (cfg) => {
        order.push("refire")
        calls.refire.push(cfg)
        return Effect.void
      },
    }
    const agentServiceOrdered: Agent.Interface = {
      ...agentService,
      reload: Effect.fn("TestAgent.reloadOrdered")(function* () {
        order.push("agent")
      }),
    }

    return Effect.runPromise(
      reloadInstanceConfig({
        config: configServiceOrdered,
        plugin: pluginServiceOrdered,
        agent: agentServiceOrdered,
        ctx,
      })(),
    ).then((result) => {
      expect(result).toBe(true)
      expect(order).toEqual(["config", "refire", "agent"])
    })
  })

  test("serves a nested reload-config call for the same directory without recursing, then clears the guard", () => {
    let configReloads = 0
    let refires = 0
    let nestedResult: boolean | undefined
    const configServiceNested: Config.Interface = {
      ...configService,
      reload: Effect.fn("TestConfig.reloadNested")(function* () {
        configReloads += 1
        return freshConfig
      }),
    }
    const pluginServiceNested: Plugin.Interface = {
      ...pluginService,
      refireConfig: (cfg) => {
        refires += 1
        // Synchronously invoke the exported function again with the same input:
        // the guard must serve the nested call immediately (no recursion).
        nestedResult = Effect.runSync(
          reloadInstanceConfig({
            config: configServiceNested,
            plugin: pluginServiceNested,
            agent: agentService,
            ctx,
          })(),
        )
        return Effect.void
      },
    }

    return Effect.runPromise(
      reloadInstanceConfig({
        config: configServiceNested,
        plugin: pluginServiceNested,
        agent: agentService,
        ctx,
      })(),
    ).then((result) => {
      expect(result).toBe(true)
      expect(nestedResult).toBe(true)
      expect(configReloads).toBe(1)
      expect(refires).toBe(1)
      // Guard cleared after completion: a sequential second run reloads again.
      return Effect.runPromise(
        reloadInstanceConfig({
          config: configServiceNested,
          plugin: pluginServiceNested,
          agent: agentService,
          ctx,
        })(),
      ).then((second) => {
        expect(second).toBe(true)
        expect(configReloads).toBe(2)
        expect(refires).toBe(2)
      })
    })
  })
})

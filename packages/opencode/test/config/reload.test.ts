import { test, expect, describe } from "bun:test"
import { Config } from "@/config/config"
import { assertFreshReload } from "@/config/config"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Npm } from "@opencode-ai/core/npm"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Env } from "../../src/env"
import { TestInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { Filesystem } from "@/util/filesystem"
import path from "path"

const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)

const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const configLayer = LayerNode.compile(
  LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]),
  [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [httpClient, Layer.succeed(HttpClient.HttpClient, unexpectedHttp)],
  ],
)

const it = testEffect(configLayer)

const writeConfigEffect = (dir: string, config: object) =>
  Effect.promise(() => Filesystem.write(path.join(dir, "opencode.json"), JSON.stringify(config)))

describe("Config.reload", () => {
  test("returns the fresh object when it differs from the invalidated object", () => {
    const previous = { model: "old/model" } as ConfigV1.Info
    const fresh = { model: "new/model" } as ConfigV1.Info
    expect(assertFreshReload(previous, fresh)).toBe(fresh)
  })

  test("throws when the reloaded object is reference-equal to the invalidated object", () => {
    const previous = { model: "stale/model" } as ConfigV1.Info
    expect(() => assertFreshReload(previous, previous)).toThrow(
      "config reload returned the same object identity as the invalidated cache; refusing stale reload",
    )
  })

  it.instance("invalidates the per-instance cache and returns a fresh object from disk", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeConfigEffect(test.directory, {
        $schema: "https://opencode.ai/config.json",
        model: "first/model",
      })
      const old = yield* Config.use.get()
      expect(old.model).toBe("first/model")

      yield* writeConfigEffect(test.directory, {
        $schema: "https://opencode.ai/config.json",
        model: "second/model",
      })
      const fresh = yield* Config.use.reload()
      expect(fresh.model).toBe("second/model")
      expect(fresh).not.toBe(old)
    }),
  )
})

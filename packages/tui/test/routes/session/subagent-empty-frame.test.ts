import { describe, expect, test } from "bun:test"
import { emptySubagentFrame } from "../../../src/routes/session/subagent-empty-frame"
import { errorMessage } from "../../../src/util/error"
import type { Session, Message, AssistantMessage } from "@opencode-ai/sdk/v2"

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    slug: "1",
    projectID: "proj_1",
    directory: "/tmp",
    title: "test (@general subagent)",
    version: "1",
    time: { created: 0, updated: 0 },
    ...overrides,
  }
}

const emptyMessages: Message[] = []

describe("AR1 emptySubagentFrame", () => {
  test("returns undefined when messages are present", () => {
    expect(emptySubagentFrame({ messages: [{ id: "m1" } as Message], session: session({ parentID: "ses_parent" }) })).toBeUndefined()
  })

  test("returns undefined when session has no parentID (not a subagent)", () => {
    expect(emptySubagentFrame({ messages: emptyMessages, session: session({ parentID: undefined }) })).toBeUndefined()
  })

  test("returns undefined when session is missing", () => {
    expect(emptySubagentFrame({ messages: emptyMessages, session: undefined })).toBeUndefined()
  })

  test("returns frame sourced from session.info when empty subagent", () => {
    const s = session({
      parentID: "ses_parent",
      agent: "general",
      model: { id: "test-model", providerID: "test" },
    })
    const frame = emptySubagentFrame({ messages: emptyMessages, session: s })
    expect(frame).toEqual({
      parentID: "ses_parent",
      title: "test (@general subagent)",
      agent: "general",
      model: { id: "test-model", providerID: "test" },
    })
  })

  test("frame includes variant when present", () => {
    const s = session({
      parentID: "ses_parent",
      model: { id: "test-model", providerID: "test", variant: "high" },
    })
    const frame = emptySubagentFrame({ messages: emptyMessages, session: s })
    expect(frame?.model?.variant).toBe("high")
  })

  // AR1 non-orphan variant (Step 9): a subagent session that EXISTS with
  // messages (non-orphan), where the assistant message carries a persisted
  // error (B2). emptySubagentFrame must return undefined (normal render
  // path handles it), and the normal render path's errorMessage must
  // produce a non-blank string — the error is rendered, not blank.
  test("non-orphan subagent with persisted assistant error: frame undefined, errorMessage non-blank", () => {
    const s = session({ parentID: "ses_parent", agent: "general" })
    const assistantWithError: AssistantMessage = {
      id: "m_err",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 0 },
      error: { name: "APIError", data: { message: "provider blew up", isRetryable: false } },
      parentID: "ses_parent",
      modelID: "test-model",
      providerID: "test",
      mode: "",
      agent: "general",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }

    // Non-orphan: messages present → emptySubagentFrame returns undefined
    // (the normal render path renders the error, not the empty frame).
    expect(emptySubagentFrame({ messages: [assistantWithError], session: s })).toBeUndefined()

    // The normal render path's errorMessage produces a non-blank string
    // for the persisted error — the error IS rendered, not blank.
    const rendered = errorMessage(assistantWithError.error)
    expect(rendered).toBeDefined()
    expect(rendered!.length).toBeGreaterThan(0)
    expect(rendered).toContain("provider blew up")
  })
})
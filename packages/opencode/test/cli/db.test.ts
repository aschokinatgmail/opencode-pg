import { describe, expect, test } from "bun:test"

import {
  redactUrl,
  blobSizeExpr,
  printRows,
  printSessionsPanel,
  PG_SESSIONS_PANEL_QUERY,
  SQLITE_SESSIONS_PANEL_QUERY,
  type SessionPanelRow,
} from "../../src/cli/cmd/db"

function captureLog(fn: () => void): string[] {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (msg: string) => lines.push(msg)
  try {
    fn()
  } finally {
    console.log = originalLog
  }
  return lines
}

describe("db redactUrl", () => {
  test("redacts the password in a postgres URL", () => {
    const url = "postgresql://user:secret@host:5432/opencode"
    const redacted = redactUrl(url)
    expect(redacted).not.toContain("secret")
    expect(redacted).toContain("***")
    expect(redacted).toContain("user")
    expect(redacted).toContain("host:5432")
    expect(redacted).toContain("opencode")
  })

  test("redacts the password in a postgres URL with query params", () => {
    const url = "postgresql://user:secret@host:5432/opencode?sslmode=require"
    const redacted = redactUrl(url)
    expect(redacted).not.toContain("secret")
    expect(redacted).toContain("***")
    expect(redacted).toContain("sslmode=require")
  })

  test("returns the URL unchanged when no userinfo is present", () => {
    const url = "postgresql://host:5432/opencode"
    expect(redactUrl(url)).toBe(url)
  })

  test("returns the input unchanged for non-URL strings", () => {
    expect(redactUrl("not a url")).toBe("not a url")
  })

  test("handles username-only URLs (no password to redact)", () => {
    const url = "postgresql://user@host:5432/opencode"
    const redacted = redactUrl(url)
    expect(redacted).toContain("user")
    expect(redacted).not.toContain("***")
  })
})

describe("db blobSizeExpr dialect-split", () => {
  // The dialect-split is determined by Database.isPg at module load time
  // (database.ts:49). These tests assert the query strings contain the
  // correct dialect-specific expression, not the runtime value of
  // blobSizeExpr() (which depends on env at import time).

  test("PG_SESSIONS_PANEL_QUERY uses the PG dialect expression", () => {
    expect(PG_SESSIONS_PANEL_QUERY).toContain("length(CAST(data AS text))")
    expect(PG_SESSIONS_PANEL_QUERY).not.toContain("length(data)")
  })

  test("SQLITE_SESSIONS_PANEL_QUERY uses the SQLite dialect expression", () => {
    expect(SQLITE_SESSIONS_PANEL_QUERY).toContain("length(data)")
    // The PG expression must NOT leak into the SQLite query.
    expect(SQLITE_SESSIONS_PANEL_QUERY).not.toContain("CAST(data AS text)")
  })

  test("blobSizeExpr returns a string (dialect determined at import time)", () => {
    const expr = blobSizeExpr()
    expect(expr).toBeOneOf(["length(CAST(data AS text))", "length(data)"])
  })
})

describe("db printRows", () => {
  test("prints JSON format", () => {
    const lines = captureLog(() => printRows([{ a: 1, b: 2 }], "json"))
    expect(lines).toEqual([JSON.stringify([{ a: 1, b: 2 }], null, 2)])
  })

  test("prints TSV format with header", () => {
    const lines = captureLog(() => printRows([{ a: 1, b: 2 }, { a: 3, b: 4 }], "tsv"))
    expect(lines).toEqual(["a\tb", "1\t2", "3\t4"])
  })

  test("prints nothing for empty rows in TSV", () => {
    const lines = captureLog(() => printRows([], "tsv"))
    expect(lines).toEqual([])
  })

  test("prints empty JSON array for empty rows", () => {
    const lines = captureLog(() => printRows([], "json"))
    expect(lines).toEqual(["[]"])
  })
})

describe("db printSessionsPanel", () => {
  test("prints (none) for empty rows", () => {
    const lines = captureLog(() => printSessionsPanel([], { full: true }))
    expect(lines).toEqual(["sessions: (none)"])
  })

  test("prints full panel for PG (drain_owner, projection_lag)", () => {
    const rows: SessionPanelRow[] = [
      {
        session_id: "ses_001",
        drain_owner: "proc_1",
        projection_lag: 5,
        pending_queued: 2,
        pending_steer: 1,
        is_subagent: 0,
        zero_message: 0,
        blob_size_message: 1024,
        blob_size_part: 2048,
        blob_size_session_message: 4096,
      },
    ]
    const lines = captureLog(() => printSessionsPanel(rows, { full: true }))
    expect(lines).toContain("sessions: 1")
    expect(lines).toContain("  ses_001")
    expect(lines).toContain("    drain_owner: proc_1")
    expect(lines).toContain("    projection_lag: 5")
    expect(lines).toContain("    pending_queued: 2")
    expect(lines).toContain("    pending_steer: 1")
    expect(lines).toContain("    is_subagent: no")
    expect(lines).toContain("    zero_message: no")
    expect(lines.some((l) => l.includes("blob_size: message=1024 part=2048 session_message=4096"))).toBe(true)
  })

  test("prints degraded panel for SQLite (n/a for drain_owner, projection_lag)", () => {
    const rows: SessionPanelRow[] = [
      {
        session_id: "ses_002",
        drain_owner: null,
        projection_lag: null,
        pending_queued: 0,
        pending_steer: 0,
        is_subagent: 1,
        zero_message: 1,
        blob_size_message: 0,
        blob_size_part: 0,
        blob_size_session_message: 0,
      },
    ]
    const lines = captureLog(() => printSessionsPanel(rows, { full: false }))
    expect(lines).toContain("sessions: 1")
    expect(lines).toContain("    drain_owner: (sqlite: n/a)")
    expect(lines).toContain("    projection_lag: (sqlite: n/a)")
    expect(lines).toContain("    is_subagent: yes")
    expect(lines).toContain("    zero_message: ANOMALY")
  })
})
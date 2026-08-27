import type { Session, Message } from "@opencode-ai/sdk/v2"

// AR1: never-blank render contract. Decides whether to render an explainable
// failure frame for an empty subagent transcript instead of a blank. The frame
// is sourced from session.info (model, parentID) — it must never be a lie: if
// there is no parentID the session is not a subagent and we keep the existing
// blank behavior (Oracle Gate 2 condition).
export interface EmptySubagentFrame {
  parentID: string
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
}

export function emptySubagentFrame(input: {
  messages: Message[]
  session: Session | undefined
}): EmptySubagentFrame | undefined {
  if (input.messages.length > 0) return undefined
  const session = input.session
  if (!session?.parentID) return undefined
  return {
    parentID: session.parentID,
    title: session.title,
    agent: session.agent,
    model: session.model,
  }
}
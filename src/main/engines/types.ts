import type { ApprovalMode, EngineId } from '../../shared/types'

export interface TurnOpts {
  prompt: string
  /** Extra system-level instructions (memory brief, agent role). */
  system?: string
  model?: string
  effort?: string
  approval: ApprovalMode
  /** Engine-side session id from a previous turn, to continue that conversation. */
  resumeId?: string
  /** `{"mcpServers":{…}}` JSON: plugin servers and the browser panel bridge, for engines that take MCP per run. */
  mcpConfig?: string
  /** A plain text answer (Auto's classifier): no tools, no MCP, nothing kept in the engine's session history. */
  textOnly?: boolean
}

/** Normalized stream events, whatever the engine. */
export type EngineEvent =
  | { type: 'session'; id: string }
  /** delta: a streamed chunk that continues the previous text event rather than a new message. */
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool'; name: string; file?: string }
  | { type: 'result'; text?: string; costUsd?: number; isError?: boolean }
  | { type: 'error'; message: string }

export interface Invocation {
  args: string[]
  /** Written to stdin then closed. Prompts go here when the engine supports it: no argv length limits, no shell quoting. */
  stdin?: string
}

export interface EngineAdapter {
  id: EngineId
  label: string
  /** Executable names tried in order; the first found on PATH is used. */
  bins: string[]
  installHint: string
  models: string[]
  efforts: string[]
  /** Can continue a conversation from resumeId. Otherwise callers replay recent history in the prompt. */
  resumes?: boolean
  /** Builds a non-interactive streaming invocation. Absent → terminal-only engine. */
  build?(o: TurnOpts): Invocation
  /** Parses one stdout line (JSONL). Unknown lines yield []. */
  parse?(line: string): EngineEvent[]
}

/** System text rides in the prompt itself: works for every engine and keeps argv short (Windows limits it to ~8k). */
export const withSystem = (o: TurnOpts) => (o.system ? `${o.system}\n\n---\n\n${o.prompt}` : o.prompt)

export function tryJson(line: string): Record<string, unknown> | null {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  try {
    return JSON.parse(t) as Record<string, unknown>
  } catch {
    return null
  }
}

// Chat run mode, as in vi3ecode's composer: Build (the default) or Plan, a read-only turn that ends in a plan.
import type { ChatMessage, EngineId } from './types'

/** Engines the original offers Plan for (Antigravity is terminal-only here). */
export const PLAN_ENGINES: EngineId[] = ['claude', 'codex', 'cursor']

export const canPlan = (engine: EngineId) => PLAN_ENGINES.includes(engine)

const PLAN_NOTE =
  '[Plan mode: analyze in read-only mode and produce an implementation plan. Do not edit files or run commands that change anything; end with the plan, its steps and the files they touch.]'
const BUILD_NOTE =
  '[System note: plan mode has ended for this conversation. Earlier plan-mode restrictions no longer apply; you are in normal build mode under the user\'s approval policy.]'

/** The text an engine gets for a user message: Plan turns carry the plan instruction, the first Build turn after one says plan mode is over. */
export function withRunMode(msg: Pick<ChatMessage, 'text' | 'mode'>, before: ChatMessage[]): string {
  if (msg.mode === 'plan') return `${PLAN_NOTE}\n\n${msg.text}`
  const prev = [...before].reverse().find((m) => m.role === 'user' && m.status !== 'steered')
  return prev?.mode === 'plan' ? `${BUILD_NOTE}\n\n${msg.text}` : msg.text
}

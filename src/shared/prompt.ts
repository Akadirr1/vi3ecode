// Pure prompt building and turn-ending protocol for chat and agent mode.
import type { Agent, ApprovalMode, ChatMessage, Team, TeamTurn } from './types'

const HISTORY_CHARS = 12_000

/** Prompt for engines that cannot resume (or after an engine switch): replay recent history. */
export function withHistory(history: ChatMessage[], text: string): string {
  const lines: string[] = []
  let size = 0
  for (const m of [...history].reverse()) {
    if (m.role === 'system' || !m.text.trim()) continue
    const line = `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.trim()}`
    if (size + line.length > HISTORY_CHARS) break
    lines.unshift(line)
    size += line.length
  }
  if (!lines.length) return text
  return `<conversation-so-far>\n${lines.join('\n\n')}\n</conversation-so-far>\n\n${text}`
}

// ---- agent mode ----

export interface TurnEnd {
  handoff?: { to: string; note: string }
  done?: string
}

const MARKER = /^[\s>*_`#-]*(HANDOFF|DONE)\s*[*_`]*\s*[:：]\s*(.*)$/i

/**
 * Reads the protocol line a turn must end with: `HANDOFF: <Name> — <note>` or `DONE: <summary>`.
 * The last marker in the final lines wins; `names` lets multi-word agent names match.
 */
export function parseTurnEnd(text: string, names: string[]): TurnEnd {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  for (const line of lines.slice(-15).reverse()) {
    const m = MARKER.exec(line)
    if (!m) continue
    const rest = m[2].replace(/[*_`]+$/g, '').trim()
    if (m[1].toUpperCase() === 'DONE') return { done: rest || 'Done.' }
    const body = rest.replace(/^(to\s+)?@?/i, '')
    const sorted = [...names].sort((a, b) => b.length - a.length)
    const hit = sorted.find((n) => body.toLowerCase().startsWith(n.toLowerCase()) && !/[\w]/.test(body.charAt(n.length)))
    const to = hit ?? (body.split(/\s*[—–:,-]\s*|\s+/)[0] ?? '')
    const note = body
      .slice(to.length)
      .replace(/^[\s*_`]*[—–:,-]*\s*/, '')
      .trim()
    return { handoff: { to, note } }
  }
  return {}
}

export function findAgent(team: Team, name: string): Agent | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return (
    team.agents.find((a) => a.name.toLowerCase() === n) ??
    team.agents.find((a) => a.id.toLowerCase() === n) ??
    team.agents.find((a) => a.role.toLowerCase() === n)
  )
}

export const leadOf = (team: Team): Agent => team.agents.find((a) => a.lead) ?? team.agents[0]

export type Next = { kind: 'handoff'; agentId: string; note: string } | { kind: 'done'; summary: string } | { kind: 'wait'; reason: string }

/** Routing rules: only the lead finishes; anything unclear goes back to the lead; a lead that does not route waits for the user. */
export function decideNext(team: Team, speaker: Agent, end: TurnEnd): Next {
  const lead = leadOf(team)
  const isLead = speaker.id === lead.id
  if (end.done !== undefined) {
    if (isLead) return { kind: 'done', summary: end.done }
    return { kind: 'handoff', agentId: lead.id, note: `${speaker.name} reports done: ${end.done}` }
  }
  if (end.handoff) {
    const target = findAgent(team, end.handoff.to)
    if (target && target.id !== speaker.id) return { kind: 'handoff', agentId: target.id, note: end.handoff.note }
    if (isLead) return { kind: 'wait', reason: target ? 'The lead handed off to itself.' : `Unknown teammate "${end.handoff.to}".` }
    return { kind: 'handoff', agentId: lead.id, note: `${speaker.name} handed off to "${end.handoff.to}", which is not a teammate: ${end.handoff.note}` }
  }
  if (isLead) return { kind: 'wait', reason: 'The lead ended without a handoff.' }
  return { kind: 'handoff', agentId: lead.id, note: `${speaker.name} finished without naming who goes next.` }
}

const PERMISSION_TEXT: Record<ApprovalMode, string> = {
  'read-only': 'read-only: you must not modify files or run commands that change state.',
  supervised: 'supervised: you may edit files inside this project; risky commands are refused.',
  auto: 'auto: you may edit files and run commands without asking.'
}

const TRANSCRIPT_CHARS = 10_000
const TURN_CHARS = 1_800

export function buildTeamPrompt(o: { team: Team; agent: Agent; goal: string; turns: TeamTurn[]; note?: string; from?: string }): string {
  const lead = leadOf(o.team)
  const roster = o.team.agents
    .map((a) => `- ${a.name} (${a.role || 'teammate'})${a.id === lead.id ? ' [lead]' : ''}: ${a.instructions.split('\n')[0]}`)
    .join('\n')

  const blocks: string[] = []
  let size = 0
  for (const t of [...o.turns].reverse()) {
    if (t.status === 'running') continue
    const text = t.text.length > TURN_CHARS ? `${t.text.slice(0, TURN_CHARS)}… [truncated]` : t.text
    const files = t.filesTouched.length ? `\n(files touched: ${t.filesTouched.slice(0, 20).join(', ')})` : ''
    const block = `### ${t.agentName}${t.error ? ' (failed)' : ''}\n${text || t.error || '(no output)'}${files}`
    if (size + block.length > TRANSCRIPT_CHARS) {
      blocks.unshift('(earlier turns omitted)')
      break
    }
    blocks.unshift(block)
    size += block.length
  }

  const isLead = o.agent.id === lead.id
  const ask = o.note
    ? `${o.from ?? 'A teammate'} handed off to you: ${o.note}`
    : isLead && o.turns.length === 0
      ? 'You go first: split the goal into tracks and hand the first one to the right teammate.'
      : 'It is your turn.'

  return [
    `# Team mode`,
    `You are ${o.agent.name}, the ${o.agent.role || 'teammate'} on a software team working in this repository. The team shares one goal and one transcript; teammates take turns and hand work to each other.`,
    ``,
    `## Team`,
    roster,
    ``,
    `## You`,
    o.agent.instructions || '(no extra instructions)',
    `Permission: ${PERMISSION_TEXT[o.agent.permission]}`,
    ``,
    `## Goal`,
    o.goal,
    ``,
    `## Transcript so far`,
    blocks.length ? blocks.join('\n\n') : '(nothing yet)',
    ``,
    `## Your turn`,
    ask,
    `Do only your part, then end your reply with exactly one final line:`,
    `HANDOFF: <teammate name> — <what they should do next>`,
    isLead
      ? `or, once the goal is achieved and verified:\nDONE: <one-line summary>`
      : `If you believe the goal is complete, hand off to ${lead.name} instead of finishing it yourself.`
  ].join('\n')
}

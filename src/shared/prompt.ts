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

const MARKER = /^[\s>*_`#-]*(HANDOFF|DONE)[*_`]*\s*[:：][*_`]*\s*(.*)$/i

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

/** Who `agent` may hand off to: its allowed list, or everyone else when the list is empty. */
export const handoffTargets = (team: Team, agent: Agent): Agent[] =>
  team.agents.filter((a) => a.id !== agent.id && (agent.handoffs.length === 0 || agent.handoffs.includes(a.id)))

/**
 * Routing rules: only the lead finishes the goal. With return-to-lead on, anything unclear (no marker,
 * unknown or disallowed target, a teammate's DONE) goes back to the lead; off, the chain pauses for the user
 * (a teammate's DONE then finishes the thread). A lead that does not route waits for the user.
 */
export function decideNext(team: Team, speaker: Agent, end: TurnEnd): Next {
  const lead = leadOf(team)
  const isLead = speaker.id === lead.id
  const back = (note: string): Next =>
    team.routing.returnToLead && !isLead ? { kind: 'handoff', agentId: lead.id, note } : { kind: 'wait', reason: note }
  if (end.done !== undefined) {
    if (isLead || !team.routing.returnToLead) return { kind: 'done', summary: end.done }
    return { kind: 'handoff', agentId: lead.id, note: `${speaker.name} reports done: ${end.done}` }
  }
  if (end.handoff) {
    const target = findAgent(team, end.handoff.to)
    if (!target) return back(`${speaker.name} handed off to "${end.handoff.to}", which is not a teammate: ${end.handoff.note}`)
    if (target.id === speaker.id) return back(`${speaker.name} handed off to itself.`)
    if (!handoffTargets(team, speaker).some((a) => a.id === target.id)) {
      return back(`${speaker.name} may not hand off to ${target.name}: ${end.handoff.note}`)
    }
    return { kind: 'handoff', agentId: target.id, note: end.handoff.note }
  }
  return isLead ? { kind: 'wait', reason: 'The lead ended without a handoff.' } : back(`${speaker.name} finished without naming who goes next.`)
}

const PERMISSION_TEXT: Record<ApprovalMode, string> = {
  'read-only': 'read-only: you must not modify files or run commands that change state.',
  ask: 'ask: actions that need permission wait for the user to approve them.',
  edits: 'edits: you may edit files inside this project; other actions may need approval.',
  full: 'full: you may edit files and run commands without asking.'
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
    const block =
      t.kind === 'user'
        ? `### User${t.to ? ` → ${t.to}` : ''}\n${text}`
        : `### ${t.agentName}${t.error ? ' (failed)' : ''}\n${text || t.error || '(no output)'}${files}`
    if (size + block.length > TRANSCRIPT_CHARS) {
      blocks.unshift('(earlier turns omitted)')
      break
    }
    blocks.unshift(block)
    size += block.length
  }

  const isLead = o.agent.id === lead.id
  const targets = handoffTargets(o.team, o.agent).map((a) => a.name)
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
    `You may hand off to: ${targets.join(', ') || '(nobody)'}.`,
    isLead
      ? `or, once the goal is achieved and verified:\nDONE: <one-line summary>`
      : `If you believe the goal is complete, hand off to ${lead.name} instead of finishing it yourself.`
  ].join('\n')
}

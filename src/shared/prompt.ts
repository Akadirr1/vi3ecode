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
// Protocol (same grammar as vi3ecode): the LAST line of an agent reply is exactly one of
//   @handoff <id>[, <id2>…]: <one-line brief>   (two or more ids start a parallel wave)
//   @done: <one-line summary>
//   @ask-user: <question, or {"questions":[…]} JSON>
// Older "HANDOFF: Name — note" / "DONE: …" lines are still understood.

export interface TurnEnd {
  handoff?: { to: string[]; note: string }
  done?: string
  ask?: string
}

const AT_LINE = /^[\s>*_`]*@(handoff|done|ask-user)\b\s*([^:]*?)\s*:\s*(.*)$/i
const LEGACY = /^[\s>*_`#-]*(HANDOFF|DONE)[*_`]*\s*[:：][*_`]*\s*(.*)$/i

/** Agent ids or names in a target list; `dev~2` addresses a copy of `dev`, which we treat as `dev`. */
const splitTargets = (list: string) =>
  list
    .split(',')
    .map((x) => x.trim().replace(/^@/, '').replace(/~\d+$/, ''))
    .filter(Boolean)

export function parseTurnEnd(text: string, names: string[]): TurnEnd {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  for (const [i, line] of lines.slice(-15).reverse().entries()) {
    const at = AT_LINE.exec(line)
    if (at) {
      const kind = at[1].toLowerCase()
      const rest = at[3].replace(/[*_`]+$/g, '').trim()
      if (kind === 'done') return { done: rest || 'Done.' }
      if (kind === 'ask-user') return { ask: askText(rest) }
      const to = splitTargets(at[2])
      if (to.length) return { handoff: { to, note: rest } }
      continue
    }
    // Legacy lines count only as the very last line: a "**Done:** x" status line mid-report is not an ending.
    const m = i === 0 ? LEGACY.exec(line) : null
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
    return { handoff: { to: [to], note } }
  }
  return {}
}

/** `@ask-user` carries plain text or {"questions":[{question, options:[{label}]}]}; flatten to readable text. */
function askText(raw: string): string {
  try {
    const j = JSON.parse(raw) as { questions?: { question?: string; options?: { label?: string }[] }[] }
    if (Array.isArray(j.questions) && j.questions.length) {
      return j.questions
        .map((q) => {
          const opts = (q.options ?? []).map((o) => o.label).filter(Boolean)
          return `${q.question ?? ''}${opts.length ? ` (${opts.join(' / ')})` : ''}`
        })
        .join('\n')
    }
  } catch {
    // plain text question
  }
  return raw || 'The agent has a question.'
}

export function findAgent(team: Team, name: string): Agent | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return (
    team.agents.find((a) => a.id.toLowerCase() === n) ??
    team.agents.find((a) => a.name.toLowerCase() === n) ??
    team.agents.find((a) => a.role.toLowerCase() === n)
  )
}

export const leadOf = (team: Team): Agent => team.agents.find((a) => a.lead) ?? team.agents[0]

export type Next =
  | { kind: 'handoff'; agentIds: string[]; note: string }
  | { kind: 'done'; summary: string }
  | { kind: 'wait'; reason: string }
  | { kind: 'ask'; question: string }

/** Who `agent` may hand off to: its allowed list, or everyone else when the list is empty. */
export const handoffTargets = (team: Team, agent: Agent): Agent[] =>
  team.agents.filter((a) => a.id !== agent.id && (agent.handoffs.length === 0 || agent.handoffs.includes(a.id)))

/**
 * Routing rules: only the lead finishes the goal. With return-to-lead on, anything unclear (no protocol
 * line, unknown or disallowed target, a teammate's @done) goes back to the lead; off, the chain pauses for
 * the user (a teammate's @done then finishes the thread). A lead with no protocol line waits for the user.
 */
export function decideNext(team: Team, speaker: Agent, end: TurnEnd): Next {
  const lead = leadOf(team)
  const isLead = speaker.id === lead.id
  const back = (note: string): Next =>
    team.routing.returnToLead && !isLead ? { kind: 'handoff', agentIds: [lead.id], note } : { kind: 'wait', reason: note }
  if (end.ask !== undefined) return { kind: 'ask', question: end.ask }
  if (end.done !== undefined) {
    if (isLead || !team.routing.returnToLead) return { kind: 'done', summary: end.done }
    return { kind: 'handoff', agentIds: [lead.id], note: `${speaker.name} reports done: ${end.done}` }
  }
  if (end.handoff) {
    const allowed = handoffTargets(team, speaker)
    const ids: string[] = []
    for (const name of end.handoff.to) {
      const target = findAgent(team, name)
      if (!target) return back(`${speaker.name} handed off to "${name}", which is not a teammate: ${end.handoff.note}`)
      if (target.id === speaker.id) return back(`${speaker.name} handed off to itself.`)
      if (!allowed.some((a) => a.id === target.id)) return back(`${speaker.name} may not hand off to ${target.name}: ${end.handoff.note}`)
      if (!ids.includes(target.id)) ids.push(target.id)
    }
    return { kind: 'handoff', agentIds: ids, note: end.handoff.note }
  }
  return isLead ? { kind: 'wait', reason: 'The lead ended without a protocol line.' } : back(`${speaker.name} finished without a protocol line.`)
}

const PERMISSION_TEXT: Record<ApprovalMode, string> = {
  'read-only': 'read-only: you must not modify files or run commands that change state.',
  ask: 'ask: actions that need permission wait for the user to approve them.',
  edits: 'edits: you may edit files inside this project; other actions may need approval.',
  full: 'full: you may edit files and run commands without asking.'
}

/** Per-turn budget for the thread lines we send (vi3ecode caps a turn at 180,000 bytes). */
const THREAD_CHARS = 60_000
const LINE_CHARS = 8_000

const authorOf = (t: TeamTurn) => (t.kind === 'user' ? (t.to ? `User → ${t.to}` : 'User') : t.agentName)

function threadLines(turns: TeamTurn[]): string[] {
  const lines: string[] = []
  let size = 0
  let dropped = 0
  for (const t of [...turns].reverse()) {
    if (t.status === 'running') continue
    const raw = t.text || t.error || '(no output)'
    const text = raw.length > LINE_CHARS ? `${raw.slice(0, LINE_CHARS)}… [truncated]` : raw
    const files = t.filesTouched.length ? `\n(files touched: ${t.filesTouched.slice(0, 20).join(', ')})` : ''
    const line = `[${authorOf(t)}] ${text}${files}`
    if (size + line.length > THREAD_CHARS) {
      dropped++
      continue
    }
    lines.unshift(line)
    size += line.length
  }
  if (dropped) lines.unshift(`(... ${dropped} older line(s) dropped - over the turn size budget)`)
  return lines
}

/**
 * The message for one agent turn. First turn of an agent session: persona, team, protocol and the whole
 * thread. A resumed session (`since` = index of the agent's previous turn) only gets what is new.
 */
export function buildTeamPrompt(o: {
  team: Team
  agent: Agent
  goal: string
  turns: TeamTurn[]
  note?: string
  from?: string
  since?: number
  wave?: string[]
}): string {
  const lead = leadOf(o.team)
  const isLead = o.agent.id === lead.id
  const targets = handoffTargets(o.team, o.agent)
  const task = o.note
    ? `${o.from ?? 'A teammate'} handed off to you: ${o.note}`
    : isLead && !o.turns.some((t) => t.kind === 'agent')
      ? `Route the goal: ${o.goal}`
      : 'Continue with the goal.'
  const protocol = o.wave
    ? [
        `PARALLEL BRANCH: ${o.wave.join(', ')} work on this brief beside you. Do your part only, do not wait for them or duplicate their work.`,
        `End with exactly one last line: @done: <one-line summary>. Nothing after it.`
      ]
    : [
        `HANDOFF PROTOCOL: end your reply with exactly one protocol line as the LAST line, nothing after it:`,
        targets.length
          ? `  @handoff <id>: <one-line brief>   — you may hand off to: ${targets.map((a) => a.id).join(', ')} (two or more ids, comma separated, run in parallel)`
          : `  (you have no handoff targets)`,
        `  @done: <one-line summary>${isLead ? '   — only when the goal is achieved and verified' : `   — hands the result back to ${lead.name}`}`,
        `  @ask-user: <question>   — only when you cannot proceed without the user's answer`
      ]

  if (o.since !== undefined) {
    const fresh = threadLines(o.turns.slice(o.since + 1))
    return [`NEW IN THE THREAD SINCE YOUR LAST TURN`, fresh.length ? fresh.join('\n\n') : '(nothing new)', ``, `YOUR TASK`, task, ``, ...protocol].join('\n')
  }
  const roster = o.team.agents.map((a) => `- ${a.id} — ${a.name} (${a.role || 'teammate'})${a.id === lead.id ? ' [lead]' : ''}`).join('\n')
  const lines = threadLines(o.turns)
  return [
    `You are ${o.agent.name}, the ${o.agent.role || 'teammate'} agent on a multi-agent team working inside this repository. The team shares one thread; teammates take turns and hand work to each other.`,
    o.agent.instructions || '',
    ``,
    `TEAM`,
    roster,
    ``,
    `YOUR PERMISSION: ${PERMISSION_TEXT[o.agent.permission]}`,
    `GOAL: ${o.goal}`,
    ``,
    `THREAD SO FAR`,
    lines.length ? lines.join('\n\n') : '(nothing yet)',
    ``,
    `YOUR TASK`,
    task,
    ``,
    ...protocol
  ].join('\n')
}

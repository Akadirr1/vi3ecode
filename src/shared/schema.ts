// Sanitizers for data that crosses a trust boundary (IPC input, files a user or agent may have edited).
// They never throw on bad input: unknown fields are dropped and bad values fall back to defaults.
import type { Agent, ApprovalMode, EngineId, Flow, FlowStep, Kanban, KanbanCard, Notes, Settings, SketchStroke, Team } from './types'

export const ENGINE_IDS: EngineId[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'cursor',
  'kimi',
  'grok',
  'kiro',
  'cline',
  'command',
  'antigravity'
]
export const APPROVAL_MODES: ApprovalMode[] = ['read-only', 'ask', 'edits', 'full']

/** Values written by earlier versions (and vi3ecode's own names) mapped onto the current set. */
const APPROVAL_ALIASES: Record<string, ApprovalMode> = { supervised: 'edits', auto: 'full', readOnly: 'read-only' }
export const approvalOf = (v: unknown, fallback: ApprovalMode): ApprovalMode =>
  APPROVAL_MODES.includes(v as ApprovalMode) ? (v as ApprovalMode) : (APPROVAL_ALIASES[String(v)] ?? fallback)

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'en',
  defaultEngine: 'claude',
  approval: 'ask',
  memoryInject: true,
  memoryWriteBack: false,
  guardrails: true,
  browserTools: true,
  hiddenEngines: [],
  openProjects: []
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 100_000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback
const id = (v: unknown, i: number): string => (/^[\w-]{1,64}$/.test(str(v)) ? str(v) : `id-${i}-${Date.now().toString(36)}`)

export function sanitizeSettings(patch: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const p = isObj(patch) ? patch : {}
  const out: Settings = { ...base }
  if ('theme' in p) out.theme = oneOf(p.theme, ['system', 'dark', 'light'] as const, base.theme)
  if ('language' in p) out.language = oneOf(p.language, ['en', 'tr'] as const, base.language)
  if ('defaultEngine' in p) out.defaultEngine = oneOf(p.defaultEngine, ENGINE_IDS, base.defaultEngine)
  if ('approval' in p) out.approval = approvalOf(p.approval, base.approval)
  for (const k of ['memoryInject', 'memoryWriteBack', 'guardrails', 'browserTools'] as const) {
    if (typeof p[k] === 'boolean') out[k] = p[k] as boolean
  }
  if (Array.isArray(p.hiddenEngines)) out.hiddenEngines = p.hiddenEngines.filter((e) => ENGINE_IDS.includes(e as EngineId)) as EngineId[]
  if (Array.isArray(p.openProjects)) out.openProjects = p.openProjects.map((x) => str(x, 64)).filter(Boolean).slice(0, 30)
  return out
}

export const DEFAULT_BOARD: Kanban = {
  version: 1,
  columns: [
    { id: 'backlog', title: 'Backlog', color: 'slate', cards: [] },
    { id: 'todo', title: 'Todo', color: 'sky', cards: [] },
    { id: 'in-progress', title: 'In Progress', color: 'amber', cards: [] },
    { id: 'review', title: 'Review', color: 'violet', cards: [] },
    { id: 'done', title: 'Done', color: 'emerald', cards: [] }
  ]
}

export function sanitizeBoard(raw: unknown): Kanban {
  if (!isObj(raw) || !Array.isArray(raw.columns)) return structuredClone(DEFAULT_BOARD)
  const columns = raw.columns.filter(isObj).slice(0, 20).map((c, ci) => ({
    id: id(c.id, ci),
    title: str(c.title, 80) || 'Untitled',
    // vi3ecode's colour names, or #rrggbb.
    ...(/^(#[0-9a-fA-F]{6}|slate|sky|amber|violet|rose|emerald)$/.test(str(c.color)) ? { color: str(c.color) } : {}),
    cards: (Array.isArray(c.cards) ? c.cards : []).filter(isObj).slice(0, 500).map(
      (k, ki): KanbanCard => ({
        id: id(k.id, ki),
        title: str(k.title, 300),
        body: str(k.body, 20_000),
        labels: (Array.isArray(k.labels) ? k.labels : []).map((l) => str(l, 40)).filter(Boolean).slice(0, 10),
        ...(str(k.assignee, 64) ? { assignee: str(k.assignee, 64) } : {}),
        createdAt: num(k.createdAt, Date.now())
      })
    )
  }))
  return { version: 1, columns }
}

export function sanitizeNotes(raw: unknown): Notes {
  if (!isObj(raw) || !Array.isArray(raw.notes)) return { version: 1, notes: [] }
  return {
    version: 1,
    notes: raw.notes.filter(isObj).slice(0, 1000).map((n, i) => ({
      id: id(n.id, i),
      title: str(n.title, 300),
      body: str(n.body, 200_000),
      strokes: sanitizeStrokes(n.strokes),
      updatedAt: num(n.updatedAt, Date.now())
    }))
  }
}

function sanitizeStrokes(raw: unknown): SketchStroke[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isObj)
    .slice(0, 2000)
    .map((st) => ({
      color: /^#[0-9a-fA-F]{6}$/.test(str(st.color)) ? str(st.color) : '#e6e8ec',
      width: Math.min(40, Math.max(1, num(st.width, 3))),
      points: (Array.isArray(st.points) ? st.points : []).slice(0, 20_000).map((v) => Math.round(num(v, 0) * 10) / 10)
    }))
    .filter((st) => st.points.length >= 2)
}

export const DEFAULT_TEAM: Team = {
  version: 1,
  agents: [
    {
      id: 'lead',
      name: 'Lead',
      role: 'Orchestrator',
      description: 'Splits the goal, routes work to the right agent and reports back. Never writes code itself.',
      avatar: 'portrait:0',
      color: '#34d399',
      engine: 'claude',
      permission: 'read-only',
      lead: true,
      handoffs: ['analyst', 'dev', 'qa', 'designer'],
      instructions: 'You coordinate the team. Answer small read-only questions yourself; otherwise split the goal into steps and hand each to the most capable teammate with a concrete brief. Never bounce the request back to the user: assume the obvious interpretation and say so. Declare the goal done only after QA has signed off.'
    },
    {
      id: 'analyst',
      name: 'Analyst',
      role: 'Requirements',
      description: 'Maps the code a goal touches and writes the acceptance criteria.',
      avatar: 'portrait:1',
      color: '#60a5fa',
      engine: 'claude',
      permission: 'read-only',
      handoffs: ['lead', 'dev'],
      instructions: 'Map the code the goal touches: files, dependencies, hidden coupling. Turn the goal into acceptance criteria. Report findings; never edit.'
    },
    {
      id: 'dev',
      name: 'Developer',
      role: 'Implementation',
      description: 'Implements the brief with tests first and the smallest change that works.',
      avatar: 'portrait:2',
      color: '#fbbf24',
      engine: 'claude',
      permission: 'edits',
      handoffs: ['lead', 'qa'],
      instructions: 'Implement the assigned track with tests first. Keep the change minimal, run the tests, and list the files you touched before handing off to QA.'
    },
    {
      id: 'qa',
      name: 'QA',
      role: 'Tests & review',
      description: 'Reviews the change and runs the tests; blocks or signs off.',
      avatar: 'portrait:3',
      color: '#a78bfa',
      engine: 'claude',
      permission: 'edits',
      handoffs: ['lead', 'dev'],
      instructions: 'Review the change against the acceptance criteria and run the tests. Block with concrete reasons and hand back to the Developer, or sign off to the Lead.'
    },
    {
      id: 'designer',
      name: 'Designer',
      role: 'UI states & copy',
      description: 'Checks the user-facing surface: states, copy, layout and accessibility.',
      avatar: 'portrait:4',
      color: '#f472b6',
      engine: 'claude',
      permission: 'read-only',
      handoffs: ['lead', 'dev'],
      instructions: 'Check the user-facing surface: empty, loading and error states, copy, layout and accessibility. Suggest concrete fixes; never edit.'
    }
  ],
  routing: { autoRelay: true, returnToLead: true, hopLimit: 12, autoApprove: false },
  budget: { turns: 0, usd: 0 }
}

export function sanitizeTeam(raw: unknown): Team {
  if (!isObj(raw) || !Array.isArray(raw.agents)) return structuredClone(DEFAULT_TEAM)
  const agents = raw.agents.filter(isObj).slice(0, 50).map(
    (a, i): Agent => ({
      id: id(a.id, i),
      name: str(a.name, 40).trim() || `Agent ${i + 1}`,
      role: str(a.role, 60),
      description: str(a.description, 300),
      avatar: str(a.avatar, 16) || `glyph:${i % 12}`,
      color: /^#[0-9a-fA-F]{6}$/.test(str(a.color)) ? str(a.color) : '#a4abb8',
      engine: oneOf(a.engine, ENGINE_IDS, 'claude'),
      model: str(a.model, 80) || undefined,
      effort: str(a.effort, 20) || undefined,
      permission: approvalOf(a.permission, 'read-only'),
      instructions: str(a.instructions, 50_000), // room for long vi3ecode prompts: a save must not cut them
      lead: a.lead === true || undefined,
      handoffs: (Array.isArray(a.handoffs) ? a.handoffs : []).map((h) => str(h, 64)).filter(Boolean)
    })
  )
  if (agents.length === 0) return structuredClone(DEFAULT_TEAM)
  const r = isObj(raw.routing) ? raw.routing : {}
  const b = isObj(raw.budget) ? raw.budget : {}
  const routing = {
    autoRelay: typeof r.autoRelay === 'boolean' ? r.autoRelay : DEFAULT_TEAM.routing.autoRelay,
    returnToLead: typeof r.returnToLead === 'boolean' ? r.returnToLead : DEFAULT_TEAM.routing.returnToLead,
    hopLimit: Math.min(50, Math.max(1, Math.round(num(r.hopLimit, DEFAULT_TEAM.routing.hopLimit)))),
    autoApprove: r.autoApprove === true
  }
  const budget = {
    turns: Math.min(500, Math.max(0, Math.round(num(b.turns, 0)))),
    usd: Math.min(1000, Math.max(0, num(b.usd, 0)))
  }
  // Exactly one lead: the first flagged one, else the first agent.
  const leadIdx = Math.max(0, agents.findIndex((a) => a.lead))
  agents.forEach((a, i) => (a.lead = i === leadIdx || undefined))
  // Names route handoffs, so they must be unique.
  const names = new Set<string>()
  const ids = new Set<string>()
  for (const a of agents) {
    let name = a.name
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${a.name} ${n}`
    a.name = name
    names.add(name.toLowerCase())
    let aid = a.id
    for (let n = 2; ids.has(aid); n++) aid = `${a.id}-${n}`
    a.id = aid
    ids.add(aid)
  }
  // Allowed handoff targets must name agents that still exist.
  const known = new Set(agents.map((a) => a.id))
  for (const a of agents) a.handoffs = a.handoffs.filter((h) => known.has(h) && h !== a.id)
  return { version: 1, agents, routing, budget }
}

export function sanitizeFlow(raw: unknown): Flow {
  const f = isObj(raw) ? raw : {}
  const steps = (Array.isArray(f.steps) ? f.steps : []).filter(isObj).slice(0, 40).map(
    (st, i): FlowStep => ({
      id: id(st.id, i),
      kind: oneOf(st.kind, ['task', 'review', 'gate'] as const, 'task'),
      title: str(st.title, 120) || `Step ${i + 1}`,
      prompt: str(st.prompt, 20_000),
      ...(ENGINE_IDS.includes(st.engine as EngineId) ? { engine: st.engine as EngineId } : {}),
      ...(str(st.model, 80) ? { model: str(st.model, 80) } : {}),
      ...(st.approval !== undefined ? { approval: approvalOf(st.approval, 'edits') } : {})
    })
  )
  return { version: 1, id: id(f.id, 0), name: str(f.name, 120) || 'Untitled flow', goal: str(f.goal, 20_000), steps, updatedAt: num(f.updatedAt, Date.now()) }
}

// Sanitizers for data that crosses a trust boundary (IPC input, files a user or agent may have edited).
// They never throw on bad input: unknown fields are dropped and bad values fall back to defaults.
import type { Agent, ApprovalMode, EngineId, Kanban, KanbanCard, Notes, Settings, Team } from './types'

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
export const APPROVAL_MODES: ApprovalMode[] = ['read-only', 'supervised', 'auto']

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultEngine: 'claude',
  approval: 'supervised',
  memoryInject: true,
  memoryWriteBack: false,
  autoHandoff: true,
  hopCap: 8,
  budgetUsd: 2,
  hiddenEngines: []
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
  if ('defaultEngine' in p) out.defaultEngine = oneOf(p.defaultEngine, ENGINE_IDS, base.defaultEngine)
  if ('approval' in p) out.approval = oneOf(p.approval, APPROVAL_MODES, base.approval)
  for (const k of ['memoryInject', 'memoryWriteBack', 'autoHandoff'] as const) {
    if (typeof p[k] === 'boolean') out[k] = p[k] as boolean
  }
  if ('hopCap' in p) out.hopCap = Math.min(50, Math.max(1, Math.round(num(p.hopCap, base.hopCap))))
  if ('budgetUsd' in p) out.budgetUsd = Math.min(1000, Math.max(0, num(p.budgetUsd, base.budgetUsd)))
  if (Array.isArray(p.hiddenEngines)) out.hiddenEngines = p.hiddenEngines.filter((e) => ENGINE_IDS.includes(e as EngineId)) as EngineId[]
  return out
}

export const DEFAULT_BOARD: Kanban = {
  version: 1,
  columns: [
    { id: 'backlog', title: 'Backlog', cards: [] },
    { id: 'doing', title: 'In progress', cards: [] },
    { id: 'review', title: 'Review', cards: [] },
    { id: 'done', title: 'Done', cards: [] }
  ]
}

export function sanitizeBoard(raw: unknown): Kanban {
  if (!isObj(raw) || !Array.isArray(raw.columns)) return structuredClone(DEFAULT_BOARD)
  const columns = raw.columns.filter(isObj).slice(0, 20).map((c, ci) => ({
    id: id(c.id, ci),
    title: str(c.title, 80) || 'Untitled',
    cards: (Array.isArray(c.cards) ? c.cards : []).filter(isObj).slice(0, 500).map(
      (k, ki): KanbanCard => ({
        id: id(k.id, ki),
        title: str(k.title, 300),
        body: str(k.body, 20_000),
        labels: (Array.isArray(k.labels) ? k.labels : []).map((l) => str(l, 40)).filter(Boolean).slice(0, 10),
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
      updatedAt: num(n.updatedAt, Date.now())
    }))
  }
}

export const DEFAULT_TEAM: Team = {
  version: 1,
  agents: [
    {
      id: 'lead',
      name: 'Lead',
      role: 'orchestrator',
      avatar: '🧭',
      color: '#5eead4',
      engine: 'claude',
      permission: 'read-only',
      lead: true,
      instructions: 'Split the goal into tracks, decide who works next, and declare the goal done when QA has signed off.'
    },
    {
      id: 'analyst',
      name: 'Analyst',
      role: 'discovery',
      avatar: '🔎',
      color: '#93c5fd',
      engine: 'claude',
      permission: 'read-only',
      instructions: 'Map the code the goal touches: files, dependencies, hidden coupling. Report findings, do not edit.'
    },
    {
      id: 'developer',
      name: 'Developer',
      role: 'implementation',
      avatar: '🛠',
      color: '#fcd34d',
      engine: 'claude',
      permission: 'supervised',
      instructions: 'Implement the assigned track with tests first. Keep the change minimal and explain what you touched.'
    },
    {
      id: 'qa',
      name: 'QA',
      role: 'tests & review',
      avatar: '✅',
      color: '#86efac',
      engine: 'claude',
      permission: 'read-only',
      instructions: 'Review the change and run the tests. Block with concrete reasons, or sign off.'
    },
    {
      id: 'designer',
      name: 'Designer',
      role: 'interface',
      avatar: '🎨',
      color: '#f9a8d4',
      engine: 'claude',
      permission: 'read-only',
      instructions: 'Check the user-facing surface: copy, layout, accessibility. Suggest concrete fixes.'
    }
  ]
}

export function sanitizeTeam(raw: unknown): Team {
  if (!isObj(raw) || !Array.isArray(raw.agents)) return structuredClone(DEFAULT_TEAM)
  const agents = raw.agents.filter(isObj).slice(0, 12).map(
    (a, i): Agent => ({
      id: id(a.id, i),
      name: str(a.name, 40).trim() || `Agent ${i + 1}`,
      role: str(a.role, 60),
      avatar: str(a.avatar, 8) || '🤖',
      color: /^#[0-9a-fA-F]{6}$/.test(str(a.color)) ? str(a.color) : '#a4abb8',
      engine: oneOf(a.engine, ENGINE_IDS, 'claude'),
      model: str(a.model, 80) || undefined,
      permission: oneOf(a.permission, APPROVAL_MODES, 'read-only'),
      instructions: str(a.instructions, 4000),
      lead: a.lead === true || undefined
    })
  )
  if (agents.length === 0) return structuredClone(DEFAULT_TEAM)
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
  return { version: 1, agents }
}

// On-disk formats under .vi3ecode/, kept in the same shape vi3ecode writes so a project opens in either app.
// The in-app types stay as they are; these functions translate at the file boundary.
import type { Agent, ApprovalMode, Kanban, KanbanCard, Team } from './types'
import { DEFAULT_TEAM, sanitizeBoard, sanitizeTeam } from './schema'

type DiskPermission = 'readOnly' | 'ask' | 'edits' | 'full'
const PERM_TO_DISK: Record<ApprovalMode, DiskPermission> = { 'read-only': 'readOnly', ask: 'ask', edits: 'edits', full: 'full' }

/** 'portrait:3' ↔ 'portrait-04' (vi3ecode numbers sprites from 01). */
export function spriteToDisk(avatar: string): string {
  const m = /^(portrait|glyph):(\d+)$/.exec(avatar)
  return m ? `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}` : avatar
}

export function spriteFromDisk(sprite: string): string {
  const m = /^(portrait|glyph)-(\d+)$/.exec(sprite)
  return m ? `${m[1]}:${Number(m[2]) - 1}` : sprite
}

/** .vi3ecode/agents.json */
export function teamToDisk(team: Team, projectId: string): unknown {
  return {
    version: 1,
    projectId,
    updatedAt: new Date().toISOString(),
    agents: team.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      engine: a.engine,
      ...(a.model ? { model: a.model } : {}),
      ...(a.effort ? { effort: a.effort } : {}),
      color: a.color,
      sprite: spriteToDisk(a.avatar),
      prompt: a.instructions,
      tools: [],
      handoffs: a.handoffs,
      paused: false,
      permission: PERM_TO_DISK[a.permission],
      instanceCount: 1,
      ...(a.lead ? { lead: true } : {})
    })),
    settings: {
      autoRelay: team.routing.autoRelay,
      autoApprove: team.routing.autoApprove,
      autoApproveParallelResults: false,
      returnToLead: team.routing.returnToLead,
      supervision: true,
      maxSupervisionTurns: 12,
      maxAutoRelayHops: team.routing.hopLimit,
      budget: { maxTurns: team.budget.turns || null, maxCostUsd: team.budget.usd || null }
    }
  }
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Reads agents.json (vi3ecode shape) or our older team.json shape; anything invalid falls back to defaults. */
export function teamFromDisk(raw: unknown): Team {
  const r = obj(raw)
  if (!('settings' in r)) return sanitizeTeam(raw) // older team.json written by this app
  const s = obj(r.settings)
  const budget = obj(s.budget)
  const agents = (Array.isArray(r.agents) ? r.agents : []).map((x) => {
    const a = obj(x)
    return {
      ...a,
      avatar: typeof a.sprite === 'string' ? spriteFromDisk(a.sprite) : a.avatar,
      instructions: a.prompt ?? a.instructions,
      lead: a.lead === true || a.id === 'lead'
    } as unknown as Agent
  })
  // Exactly one lead: an explicit flag wins over the conventional `lead` id.
  if (agents.filter((a) => a.lead).length > 1) {
    const flagged = (Array.isArray(r.agents) ? r.agents : []).findIndex((x) => obj(x).lead === true)
    agents.forEach((a, i) => (a.lead = i === Math.max(0, flagged)))
  }
  return sanitizeTeam({
    agents,
    routing: {
      autoRelay: s.autoRelay ?? DEFAULT_TEAM.routing.autoRelay,
      returnToLead: s.returnToLead ?? DEFAULT_TEAM.routing.returnToLead,
      hopLimit: s.maxAutoRelayHops ?? DEFAULT_TEAM.routing.hopLimit,
      autoApprove: s.autoApprove === true
    },
    budget: { turns: budget.maxTurns ?? 0, usd: budget.maxCostUsd ?? 0 }
  })
}

/** .vi3ecode/kanban.json: flat cards with a columnId, as vi3ecode writes it. */
export function boardToDisk(board: Kanban, projectId: string): unknown {
  return {
    version: 1,
    projectId,
    columns: board.columns.map((c) => ({ id: c.id, title: c.title, ...(c.color ? { color: c.color } : {}) })),
    cards: board.columns.flatMap((c) =>
      c.cards.map((k) => ({
        id: k.id,
        columnId: c.id,
        title: k.title,
        description: k.body,
        ...(k.assignee ? { assignee: k.assignee } : {}),
        labels: k.labels,
        createdAt: k.createdAt
      }))
    )
  }
}

export function boardFromDisk(raw: unknown): Kanban {
  const r = obj(raw)
  if (!Array.isArray(r.cards)) return sanitizeBoard(raw) // nested shape (older files) or missing
  const columns = (Array.isArray(r.columns) ? r.columns : []).map((c) => ({ ...obj(c), cards: [] as KanbanCard[] })) as ({ id?: unknown; cards: KanbanCard[] } & Record<string, unknown>)[]
  for (const x of r.cards) {
    const k = obj(x)
    const col = columns.find((c) => c.id === k.columnId) ?? columns[0]
    col?.cards.push({ ...k, body: k.description ?? k.body } as unknown as KanbanCard)
  }
  return sanitizeBoard({ columns })
}

// On-disk formats under .vi3ecode/, kept in the same shape vi3ecode writes so a project opens in either app.
// The in-app types stay as they are; these functions translate at the file boundary.
import type { Agent, ApprovalMode, Kanban, KanbanCard, Notes, SketchStroke, Team } from './types'
import { DEFAULT_TEAM, sanitizeBoard, sanitizeNotes, sanitizeTeam } from './schema'

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** The previous on-disk entry with the same id, so fields we do not model (vi3ecode's or future ones) survive a save. */
const byId = (list: unknown): Map<string, Record<string, unknown>> =>
  new Map((Array.isArray(list) ? list : []).map((x) => [String(obj(x).id), obj(x)]))
const nowIso = () => new Date().toISOString()

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

/** .vi3ecode/agents.json; `prev` is the file as it is on disk now (its unknown fields are kept). */
export function teamToDisk(team: Team, projectId: string, prev: unknown = null): unknown {
  const p = obj(prev)
  const prevAgents = byId(p.agents)
  const prevSettings = obj(p.settings)
  return {
    ...p,
    version: 1,
    projectId,
    updatedAt: nowIso(),
    agents: team.agents.map((a) => ({
      tools: [],
      ...prevAgents.get(a.id),
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
      handoffs: a.handoffs,
      permission: PERM_TO_DISK[a.permission],
      ...(a.lead ? { lead: true } : {}),
      paused: !!a.paused,
      instanceCount: a.instanceCount && a.instanceCount > 1 ? a.instanceCount : undefined
    })),
    settings: {
      autoApproveParallelResults: false,
      supervision: true,
      maxSupervisionTurns: 12,
      ...prevSettings,
      autoRelay: team.routing.autoRelay,
      autoApprove: team.routing.autoApprove,
      returnToLead: team.routing.returnToLead,
      maxAutoRelayHops: team.routing.hopLimit,
      budget: { ...obj(prevSettings.budget), maxTurns: team.budget.turns || null, maxCostUsd: team.budget.usd || null }
    }
  }
}


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

/** .vi3ecode/kanban.json: flat cards with a columnId, as vi3ecode writes it; unknown fields of `prev` are kept. */
export function boardToDisk(board: Kanban, projectId: string, prev: unknown = null): unknown {
  const p = obj(prev)
  const cols = byId(p.columns)
  const cards = byId(p.cards)
  const now = nowIso()
  return {
    ...p,
    version: 1,
    projectId,
    createdAt: p.createdAt ?? now,
    updatedAt: now,
    columns: board.columns.map((c) => ({ createdAt: now, ...cols.get(c.id), id: c.id, title: c.title, ...(c.color ? { color: c.color } : {}), updatedAt: now })),
    cards: board.columns.flatMap((c) =>
      c.cards.map((k) => {
        const old = cards.get(k.id)
        const changed = !old || old.columnId !== c.id || old.title !== k.title || old.description !== k.body
        return {
          ...old,
          id: k.id,
          columnId: c.id,
          title: k.title,
          description: k.body,
          ...(k.assignee ? { assignee: k.assignee } : { assignee: undefined }),
          labels: k.labels,
          createdAt: old?.createdAt ?? k.createdAt,
          updatedAt: changed ? now : (old?.updatedAt ?? now)
        }
      })
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

/** .vi3ecode/notes.json in vi3ecode's shape: `content` + `kind` ("note" | "sketch"), sketch strokes as "draw" elements. */
export function notesToDisk(notes: Notes, projectId: string, prev: unknown = null): unknown {
  const p = obj(prev)
  const old = byId(p.notes)
  const now = nowIso()
  const ours = new Set(notes.notes.map((n) => n.id))
  return {
    ...p,
    version: 1,
    projectId,
    createdAt: p.createdAt ?? now,
    updatedAt: now,
    notes: [
      ...notes.notes.map((n) => {
        const o = old.get(n.id)
        const sketch = obj(o?.sketch)
        // Elements we cannot draw (rect, arrow, text…) stay as they were; our freehand strokes replace the "draw" ones.
        const others = (Array.isArray(sketch.elements) ? sketch.elements : []).filter((e) => obj(e).type !== 'draw')
        const draws = n.strokes.map((st) => ({ type: 'draw', color: st.color, width: st.width, points: st.points }))
        return {
          pinned: false,
          ...o,
          id: n.id,
          title: n.title,
          content: n.body,
          kind: o?.kind === 'sketch' || (!n.body && draws.length) ? 'sketch' : 'note',
          ...(draws.length || others.length ? { sketch: { view: { offsetX: 60, offsetY: 48, zoom: 1 }, bg: 'dark', ...sketch, elements: [...others, ...draws] } } : {}),
          createdAt: o?.createdAt ?? new Date(n.updatedAt).toISOString(),
          updatedAt: new Date(n.updatedAt).toISOString()
        }
      }),
      // Entries we never loaded (unknown kinds) are not ours to drop.
      ...(Array.isArray(p.notes) ? p.notes : []).filter((x) => !ours.has(String(obj(x).id)) && !['note', 'sketch'].includes(String(obj(x).kind)))
    ]
  }
}

export function notesFromDisk(raw: unknown): Notes {
  const r = obj(raw)
  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .map(obj)
    .filter((n) => n.kind === undefined || n.kind === 'note' || n.kind === 'sketch')
    .map((n) => {
      const sketch = obj(n.sketch)
      const strokes = (Array.isArray(sketch.elements) ? sketch.elements : [])
        .map(obj)
        .filter((e) => e.type === 'draw' && Array.isArray(e.points))
        .map((e) => ({ color: e.color, width: e.width, points: e.points }) as SketchStroke)
      const ts = typeof n.updatedAt === 'string' ? Date.parse(n.updatedAt) : n.updatedAt
      return { ...n, body: n.content ?? n.body, strokes: Array.isArray(n.strokes) ? n.strokes : strokes, updatedAt: ts }
    })
  return sanitizeNotes({ notes })
}

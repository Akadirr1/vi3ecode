import { describe, expect, it } from 'vitest'
import { boardFromDisk, boardToDisk, notesFromDisk, notesToDisk, spriteFromDisk, spriteToDisk, teamFromDisk, teamToDisk } from '../src/shared/formats'
import { DEFAULT_BOARD, DEFAULT_TEAM } from '../src/shared/schema'

describe('agents.json', () => {
  it('round-trips the team through the vi3ecode shape', () => {
    const disk = teamToDisk(DEFAULT_TEAM, 'p1') as { agents: { permission: string; sprite: string; prompt: string }[]; settings: { maxAutoRelayHops: number } }
    expect(disk.agents[0]).toMatchObject({ permission: 'readOnly', sprite: 'portrait-01' })
    expect(disk.agents[0].prompt).toBe(DEFAULT_TEAM.agents[0].instructions)
    expect(disk.settings.maxAutoRelayHops).toBe(12)
    expect(teamFromDisk(JSON.parse(JSON.stringify(disk)))).toEqual(DEFAULT_TEAM)
  })
  it('reads a vi3ecode-written file: lead by id, budget nulls, unknown fields ignored', () => {
    const t = teamFromDisk({
      version: 1,
      agents: [
        { id: 'lead', name: 'Lead', role: 'Orchestrator', engine: 'claude', permission: 'readOnly', sprite: 'portrait-03', prompt: 'route', handoffs: ['dev'], serviceTier: 'x' },
        { id: 'dev', name: 'Developer', role: 'Implementation', engine: 'codex', permission: 'edits', sprite: 'glyph-12', handoffs: [] }
      ],
      settings: { autoRelay: false, returnToLead: true, maxAutoRelayHops: 7, budget: { maxTurns: null, maxCostUsd: 3 } }
    })
    expect(t.agents.map((a) => [a.id, a.lead, a.permission, a.avatar])).toEqual([
      ['lead', true, 'read-only', 'portrait:2'],
      ['dev', undefined, 'edits', 'glyph:11']
    ])
    expect(t.routing).toEqual({ autoRelay: false, returnToLead: true, hopLimit: 7, autoApprove: false })
    expect(t.budget).toEqual({ turns: 0, usd: 3 })
  })
  it('keeps vi3ecode fields we do not edit (tools, paused, copies, settings)', () => {
    const prev = {
      version: 1,
      name: 'Product team',
      agents: [{ id: 'lead', name: 'Lead', role: 'Orchestrator', engine: 'claude', permission: 'readOnly', sprite: 'portrait-01', prompt: 'p', handoffs: [], tools: ['route', 'summarize'], paused: true, instanceCount: 2, serviceTier: 'priority' }],
      settings: { autoRelay: true, returnToLead: true, maxAutoRelayHops: 12, supervision: false, autoPickRecommendedMinutes: 30, budget: { maxTurns: null, maxCostUsd: null } }
    }
    const disk = teamToDisk(teamFromDisk(prev), 'p1', prev) as { name: string; agents: Record<string, unknown>[]; settings: Record<string, unknown> }
    expect(disk.name).toBe('Product team')
    expect(disk.agents[0]).toMatchObject({ tools: ['route', 'summarize'], paused: true, instanceCount: 2, serviceTier: 'priority', prompt: 'p' })
    expect(disk.settings).toMatchObject({ supervision: false, autoPickRecommendedMinutes: 30 })
  })
  it('maps sprite names both ways', () => {
    expect(spriteToDisk('glyph:0')).toBe('glyph-01')
    expect(spriteFromDisk('portrait-12')).toBe('portrait:11')
    expect(spriteToDisk('🤖')).toBe('🤖')
  })
})

describe('kanban.json', () => {
  it('writes flat cards with columnId and reads them back', () => {
    const board = structuredClone(DEFAULT_BOARD)
    board.columns[1].cards.push({ id: 'c1', title: 'Fix menu', body: 'mobile', labels: ['ui'], assignee: 'dev', createdAt: 1 })
    const disk = boardToDisk(board, 'p1') as { columns: { color: string }[]; cards: { columnId: string; description: string }[] }
    expect(disk.cards).toEqual([expect.objectContaining({ id: 'c1', columnId: 'todo', title: 'Fix menu', description: 'mobile', assignee: 'dev', labels: ['ui'], createdAt: 1 })])
    expect(disk.columns.map((c) => c.color)).toEqual(['slate', 'sky', 'amber', 'violet', 'emerald'])
    expect(boardFromDisk(JSON.parse(JSON.stringify(disk)))).toEqual(board)
  })
  it('keeps fields it does not model when saving over an existing file', () => {
    const prev = { version: 1, projectId: 'p1', extra: 1, columns: [{ id: 'todo', title: 'Todo', color: 'sky', createdAt: 'x' }], cards: [{ id: 'c1', columnId: 'todo', title: 'T', description: '', labels: [], priority: 'high' }] }
    const board = boardFromDisk(prev)
    const disk = boardToDisk(board, 'p1', prev) as { extra: number; columns: { createdAt: string }[]; cards: { priority: string }[] }
    expect(disk.extra).toBe(1)
    expect(disk.columns[0].createdAt).toBe('x')
    expect(disk.cards[0].priority).toBe('high')
  })
  it('still reads the older nested shape', () => {
    expect(boardFromDisk({ columns: [{ id: 'a', title: 'A', cards: [{ id: 'k', title: 'T' }] }] }).columns[0].cards[0].title).toBe('T')
  })
})

describe('notes.json', () => {
  it('reads and writes vi3ecode notes (content/kind) and keeps what we cannot draw', () => {
    const prev = {
      version: 1,
      projectId: 'p1',
      notes: [
        { id: 'n1', title: 'Plan', content: 'ship it', kind: 'note', pinned: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
        { id: 's1', title: 'Flow', content: '', kind: 'sketch', sketch: { elements: [{ type: 'rect', x: 1 }, { type: 'draw', color: '#ff0000', width: 3, points: [1, 2, 3, 4] }], view: { zoom: 2 }, bg: 'dark' } },
        { id: 'x1', kind: 'canvas-v9', title: 'future' }
      ]
    }
    const notes = notesFromDisk(prev)
    expect(notes.notes.map((n) => [n.id, n.body, n.strokes.length])).toEqual([['n1', 'ship it', 0], ['s1', '', 1]])
    notes.notes[0].body = 'ship it today'
    const disk = notesToDisk(notes, 'p1', prev) as { notes: Record<string, unknown>[] }
    expect(disk.notes[0]).toMatchObject({ id: 'n1', content: 'ship it today', kind: 'note', pinned: true, createdAt: '2026-10-01T00:00:00.000Z' })
    expect(disk.notes[1]).toMatchObject({ kind: 'sketch', sketch: { view: { zoom: 2 }, elements: [{ type: 'rect', x: 1 }, { type: 'draw', points: [1, 2, 3, 4] }] } })
    expect(disk.notes[2]).toEqual({ id: 'x1', kind: 'canvas-v9', title: 'future' })
  })
  it('still reads our older body/strokes shape', () => {
    expect(notesFromDisk({ version: 1, notes: [{ id: 'a', title: 't', body: 'b', strokes: [], updatedAt: 5 }] }).notes[0].body).toBe('b')
  })
})

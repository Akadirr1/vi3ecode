import { describe, expect, it } from 'vitest'
import { boardFromDisk, boardToDisk, spriteFromDisk, spriteToDisk, teamFromDisk, teamToDisk } from '../src/shared/formats'
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
    const disk = boardToDisk(board, 'p1') as { cards: { columnId: string; description: string }[] }
    expect(disk.cards).toEqual([{ id: 'c1', columnId: 'todo', title: 'Fix menu', description: 'mobile', assignee: 'dev', labels: ['ui'], createdAt: 1 }])
    expect(boardFromDisk(JSON.parse(JSON.stringify(disk)))).toEqual(board)
  })
  it('still reads the older nested shape', () => {
    expect(boardFromDisk({ columns: [{ id: 'a', title: 'A', cards: [{ id: 'k', title: 'T' }] }] }).columns[0].cards[0].title).toBe('T')
  })
})

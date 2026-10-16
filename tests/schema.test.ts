import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_TEAM, sanitizeBoard, sanitizeFlow, sanitizeNotes, sanitizeSettings, sanitizeTeam } from '../src/shared/schema'

describe('sanitizeSettings', () => {
  it('applies valid fields and migrates old approval names', () => {
    const s = sanitizeSettings({ theme: 'light', language: 'tr', approval: 'supervised', hiddenEngines: ['codex', 'bogus'] })
    expect(s).toMatchObject({ theme: 'light', language: 'tr', approval: 'edits', hiddenEngines: ['codex'] })
    expect(sanitizeSettings({ approval: 'auto' }).approval).toBe('full')
  })
  it('ignores invalid values and unknown keys', () => {
    const s = sanitizeSettings({ theme: 'neon', approval: 'yolo', extra: 1 } as never)
    expect(s).toEqual(DEFAULT_SETTINGS)
  })
})

describe('sanitizeBoard / sanitizeNotes', () => {
  it('defaults a missing board and drops junk cards', () => {
    expect(sanitizeBoard(null).columns.map((c) => c.id)).toEqual(['backlog', 'doing', 'review', 'done'])
    const b = sanitizeBoard({ columns: [{ id: 'c', title: 'C', cards: [{ id: 'k', title: 'T', labels: ['x', 3, ''] }, 'junk'] }] })
    expect(b.columns[0].cards).toHaveLength(1)
    expect(b.columns[0].cards[0].labels).toEqual(['x'])
  })
  it('rejects ids with path characters', () => {
    const n = sanitizeNotes({ notes: [{ id: '../../etc', title: 't', body: 'b' }] })
    expect(n.notes[0].id).not.toContain('/')
  })
})

describe('team routing, budget and handoffs', () => {
  it('clamps routing and budget and drops unknown handoff targets', () => {
    const t = sanitizeTeam({
      agents: [
        { id: 'a', name: 'A', lead: true, handoffs: ['b', 'ghost', 'a'], permission: 'supervised' },
        { id: 'b', name: 'B' }
      ],
      routing: { hopLimit: 999, autoRelay: false },
      budget: { turns: -3, usd: 5 }
    })
    expect(t.agents[0].handoffs).toEqual(['b'])
    expect(t.agents[0].permission).toBe('edits')
    expect(t.routing).toEqual({ autoRelay: false, returnToLead: true, hopLimit: 50, autoApprove: false })
    expect(t.budget).toEqual({ turns: 0, usd: 5 })
    expect(DEFAULT_TEAM.agents.every((a) => Array.isArray(a.handoffs))).toBe(true)
  })
})

describe('sanitizeFlow', () => {
  it('keeps known step kinds and drops bad engines', () => {
    const f = sanitizeFlow({ id: 'f1', name: 'Ship', steps: [{ kind: 'gate', title: 'OK?' }, { kind: 'weird', engine: 'nope', approval: 'auto' }] })
    expect(f.steps.map((s) => s.kind)).toEqual(['gate', 'task'])
    expect(f.steps[1].engine).toBeUndefined()
    expect(f.steps[1].approval).toBe('full')
  })
})

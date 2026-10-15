import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeBoard, sanitizeNotes, sanitizeSettings } from '../src/shared/schema'

describe('sanitizeSettings', () => {
  it('applies valid fields and clamps numbers', () => {
    const s = sanitizeSettings({ theme: 'light', hopCap: 999, budgetUsd: -5, autoHandoff: false, hiddenEngines: ['codex', 'bogus'] })
    expect(s).toMatchObject({ theme: 'light', hopCap: 50, budgetUsd: 0, autoHandoff: false, hiddenEngines: ['codex'] })
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

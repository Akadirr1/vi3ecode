import { describe, expect, it } from 'vitest'
import { buildBrief, buildIndex, extractLinks, parseNote, serializeNote, slugify } from '../src/shared/memory'
import type { MemoryNote } from '../src/shared/types'

const note = (over: Partial<MemoryNote>): MemoryNote => ({
  slug: 'n',
  title: 'N',
  type: 'fact',
  tags: [],
  body: '',
  created: '2026-10-01',
  updated: '2026-10-01',
  links: [],
  ...over
})

describe('memory notes', () => {
  it('round-trips through serialize/parse, including awkward titles', () => {
    const n = note({ slug: 'auth-cookie', title: 'Cookie: keep "sid"', type: 'decision', tags: ['auth', 'cookies'], body: 'Keep the old name one release. See [[session-store]].' })
    const back = parseNote('auth-cookie', serializeNote(n))
    expect(back).toEqual({ ...n, links: ['session-store'] })
  })
  it('defaults unknown types to fact and tolerates missing frontmatter', () => {
    expect(parseNote('x', '---\ntype: nonsense\n---\nbody').type).toBe('fact')
    expect(parseNote('x', 'plain body')).toMatchObject({ title: 'x', body: 'plain body' })
  })
  it('slugifies titles including Turkish letters', () => {
    expect(slugify('Oturum Yönetimi — ılık Çözüm!')).toBe('oturum-yonetimi-ilik-cozum')
    expect(slugify('***')).toBe('note')
  })
  it('extracts wiki links with aliases', () => {
    expect(extractLinks('[[Session Store|store]] and [[api-keys#x]] and [[Session Store]]')).toEqual(['session-store', 'api-keys'])
  })
})

describe('index and brief', () => {
  const notes = [
    note({ slug: 'w', title: 'Never log tokens', type: 'warning', body: 'Strip them.' }),
    note({ slug: 'f', title: 'Uses Vite', type: 'fact', body: 'Build tool.' })
  ]
  it('groups the index by type, warnings first', () => {
    const idx = buildIndex(notes)
    expect(idx.indexOf('## warning')).toBeLessThan(idx.indexOf('## fact'))
    expect(idx).toContain('- [[w]] Never log tokens — Strip them.')
  })
  it('caps the brief and lists what did not fit', () => {
    const many = Array.from({ length: 40 }, (_, i) => note({ slug: `n${i}`, title: `Note ${i}`, body: 'x'.repeat(400) }))
    const brief = buildBrief(many, 3000)
    expect(brief.length).toBeLessThanOrEqual(3000)
    expect(brief).toMatch(/Also in the vault|more notes/)
    expect(buildBrief([])).toBe('')
  })
})

import { parseMemoryWrites } from '../src/shared/memory'

describe('MEMORY_WRITE lines', () => {
  it('parses valid lines and skips malformed ones', () => {
    const text = [
      'Done with the refactor.',
      'MEMORY_WRITE {"title":"Session cookie","content":"Keep sid one release.","type":"decision","tags":["auth"]}',
      'MEMORY_WRITE {not json}',
      '`MEMORY_WRITE {"title":"Flaky test","content":"retry e2e once","type":"lesson_learned"}`',
      'MEMORY_WRITE {"title":"","content":"x"}'
    ].join('\n')
    expect(parseMemoryWrites(text)).toEqual([
      { title: 'Session cookie', content: 'Keep sid one release.', type: 'decision', tags: ['auth'] },
      { title: 'Flaky test', content: 'retry e2e once', type: 'lesson', tags: [] }
    ])
  })
})

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJson, writeJson } from '../src/main/fsutil'
import { sanitizeTeam } from '../src/shared/schema'

describe('readJson', () => {
  it('keeps a file it cannot parse, so the next save cannot destroy it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vi3e-fs-'))
    const file = join(dir, 'state.json')
    writeFileSync(file, '{"projects": [1, 2,]}')
    expect(readJson(file, { projects: [] })).toEqual({ projects: [] })
    const kept = readdirSync(dir).filter((f) => f.startsWith('state.json.unreadable-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]), 'utf8')).toBe('{"projects": [1, 2,]}')
    // Reading it again, or reading the copy, keeps nothing new.
    readJson(file, null)
    readJson(join(dir, kept[0]), null)
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it('will not replace a file it could not read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vi3e-fs-'))
    const file = join(dir, 'agents.json')
    mkdirSync(file) // reading a directory fails with something other than "not found"
    expect(readJson(file, 'fb')).toBe('fb')
    expect(() => writeJson(file, { a: 1 })).toThrow(/could not be read/)
    rmdirSync(file)
    writeFileSync(file, '{"a":0}')
    expect(readJson(file, null)).toEqual({ a: 0 }) // a successful read lifts the block
    writeJson(file, { a: 1 })
    expect(readJson(file, null)).toEqual({ a: 1 })
  })

  it('reads valid files and makes no copy for a missing or empty one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vi3e-fs-'))
    writeFileSync(join(dir, 'ok.json'), '{"a":1}')
    writeFileSync(join(dir, 'empty.json'), '')
    expect(readJson(join(dir, 'ok.json'), null)).toEqual({ a: 1 })
    expect(readJson(join(dir, 'missing.json'), 'fb')).toBe('fb')
    expect(readJson(join(dir, 'empty.json'), 'fb')).toBe('fb')
    expect(readdirSync(dir).sort()).toEqual(['empty.json', 'ok.json'])
  })
})

describe('sanitizeTeam limits', () => {
  it("keeps what vi3ecode itself allows (name 60, role 80, description 4000, 64 agents)", () => {
    const long = (n: number) => 'x'.repeat(n)
    const agents = Array.from({ length: 70 }, (_, i) => ({ id: `a${i}`, name: i ? `A${i}` : long(60), role: long(80), description: long(4000) }))
    const t = sanitizeTeam({ agents })
    expect(t.agents).toHaveLength(64)
    expect(t.agents[0].name).toHaveLength(60)
    expect(t.agents[0].role).toHaveLength(80)
    expect(t.agents[0].description).toHaveLength(4000)
    expect(sanitizeTeam({ agents: [{ id: 'a', name: long(70) }] }).agents[0].name).toHaveLength(60)
  })
})

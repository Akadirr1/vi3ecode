import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const project = mkdtempSync(join(tmpdir(), 'vi3e-links-'))
const outside = mkdtempSync(join(tmpdir(), 'vi3e-outside-'))
vi.mock('../src/main/store', () => ({ getProject: (id: string) => ({ id, name: 'p', path: project, addedAt: 0 }) }))
const { dataDir, listMemory } = await import('../src/main/project')
const { skillsApi } = await import('../src/main/skills')

// Symlinks need extra rights on Windows; the check itself is platform-independent.
describe.skipIf(process.platform === 'win32')('.vi3ecode symlinks', () => {
  it('refuses a folder or file that links outside the project', () => {
    mkdirSync(join(project, '.vi3ecode'), { recursive: true })
    symlinkSync(outside, join(project, '.vi3ecode', 'captures'))
    expect(() => dataDir('p', 'captures', '.gitignore')).toThrow(/outside the project/)
    writeFileSync(join(outside, 'bashrc'), 'x')
    symlinkSync(join(outside, 'bashrc'), join(project, '.vi3ecode', 'kanban.json'))
    expect(() => dataDir('p', 'kanban.json')).toThrow(/outside the project/)
    expect(dataDir('p', 'notes.json')).toBe(join(project, '.vi3ecode', 'notes.json'))
  })
  it('does not read memory notes that are symlinks', () => {
    const entries = join(project, '.vi3ecode', 'memory', 'entries')
    mkdirSync(entries, { recursive: true })
    writeFileSync(join(entries, 'real.md'), '---\ntitle: Real\ntype: fact\n---\nbody\n')
    writeFileSync(join(outside, 'secret.md'), 'secret')
    symlinkSync(join(outside, 'secret.md'), join(entries, 'leak.md'))
    expect(listMemory('p').map((n) => n.slug)).toEqual(['real'])
  })
  it('does not read a skill whose SKILL.md is a symlink', async () => {
    const dir = join(project, '.vi3ecode', 'skills')
    mkdirSync(join(dir, 'ok'), { recursive: true })
    writeFileSync(join(dir, 'ok', 'SKILL.md'), '---\nname: ok\ndescription: fine\n---\nbody\n')
    mkdirSync(join(dir, 'leak'))
    writeFileSync(join(outside, 'id_rsa'), 'PRIVATE KEY')
    symlinkSync(join(outside, 'id_rsa'), join(dir, 'leak', 'SKILL.md'))
    expect((await skillsApi.list('p')).map((s) => s.name)).toEqual(['ok'])
  })
})

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BLOCK_BEGIN, BLOCK_END, parseSkillMd, serializeSkillMd, withSkillsBlock } from '../src/shared/skills'

const project = mkdtempSync(join(tmpdir(), 'vi3e-skills-'))
vi.mock('../src/main/store', () => ({ getProject: (id: string) => ({ id, name: 'p', path: project, addedAt: 0 }) }))
const { skillsApi } = await import('../src/main/skills')

const doc = { name: 'deploy-check', description: 'Use when: shipping "prod"', body: '# Steps\n\n1. run it' }

describe('SKILL.md', () => {
  it('round-trips a description YAML would otherwise misread', () => {
    const md = serializeSkillMd(doc)
    expect(md).toContain('description: "Use when: shipping \\"prod\\""')
    expect(parseSkillMd(md)).toEqual({ description: doc.description, body: doc.body })
  })
  it('reads single-quoted and plain values, and files without frontmatter', () => {
    expect(parseSkillMd("---\nname: x\ndescription: 'it''s'\n---\nbody").description).toBe("it's")
    expect(parseSkillMd('---\ndescription: plain text\n---\n\nbody\n')).toEqual({ description: 'plain text', body: 'body' })
    expect(parseSkillMd('just a body')).toEqual({ description: '', body: 'just a body' })
  })
})

describe('AGENTS.md block', () => {
  const user = '# Project rules\n\nBe nice.\n'
  it('appends, replaces and removes without touching the rest', () => {
    const added = withSkillsBlock(user, [doc])
    expect(added.startsWith(user)).toBe(true)
    expect(added).toContain('`.vi3ecode/skills/deploy-check/SKILL.md`')
    const withTail = added + '\n## After\nkeep me\n'
    const replaced = withSkillsBlock(withTail, [{ ...doc, name: 'other' }])
    expect(replaced).toContain('**other**')
    expect(replaced).not.toContain('**deploy-check**')
    expect(replaced.endsWith('\n## After\nkeep me\n')).toBe(true)
    expect(withSkillsBlock(added, [])).toBe(user)
    expect(withSkillsBlock(withSkillsBlock('', [doc]), [])).toBe('')
    expect(withSkillsBlock(user, [])).toBe(user)
  })
  it('refuses broken markers', () => {
    expect(() => withSkillsBlock(`${BLOCK_BEGIN}\nx`, [doc])).toThrow()
    expect(() => withSkillsBlock(`${BLOCK_END}\n${BLOCK_BEGIN}`, [doc])).toThrow()
    expect(() => withSkillsBlock(`${BLOCK_BEGIN}${BLOCK_END}${BLOCK_BEGIN}${BLOCK_END}`, [])).toThrow()
  })
})

describe('skills store', () => {
  it('saves, installs for every engine, uninstalls and removes', async () => {
    writeFileSync(join(project, 'AGENTS.md'), '# Mine\n')
    const saved = await skillsApi.save('p1', doc)
    expect(saved.installed).toBe(false)
    expect(existsSync(join(project, '.vi3ecode/skills/deploy-check/SKILL.md'))).toBe(true)

    const list = await skillsApi.setInstalled('p1', 'deploy-check', true)
    expect(list).toEqual([{ ...doc, installed: true }])
    expect(readFileSync(join(project, '.claude/skills/deploy-check/SKILL.md'), 'utf8')).toBe(serializeSkillMd(doc))
    expect(existsSync(join(project, '.opencode/skill/deploy-check/SKILL.md'))).toBe(true)
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('**deploy-check**')

    // An edit to an installed skill reaches the copies.
    await skillsApi.save('p1', { ...doc, body: 'v2' })
    expect(readFileSync(join(project, '.claude/skills/deploy-check/SKILL.md'), 'utf8')).toContain('v2')

    await skillsApi.setInstalled('p1', 'deploy-check', false)
    expect(existsSync(join(project, '.claude/skills/deploy-check'))).toBe(false)
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toBe('# Mine\n')

    mkdirSync(join(project, '.vi3ecode/skills/deploy-check/references'))
    await skillsApi.remove('p1', 'deploy-check')
    expect(existsSync(join(project, '.vi3ecode/skills/deploy-check/SKILL.md'))).toBe(false)
    expect(existsSync(join(project, '.vi3ecode/skills/deploy-check/references'))).toBe(true)
    expect(await skillsApi.list('p1')).toEqual([])
  })
  it('rejects unsafe names', async () => {
    await expect(skillsApi.save('p1', { ...doc, name: '../evil' })).rejects.toThrow()
    await expect(skillsApi.setInstalled('p1', 'A b', true)).rejects.toThrow()
  })
})

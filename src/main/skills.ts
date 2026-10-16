// Skills: .vi3ecode/skills/<name>/SKILL.md is the source. Installing copies it where each engine looks
// (.claude/skills, .opencode/skill) and lists it in a marked AGENTS.md block for Codex, Cursor and Kimi.
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Skill } from '../shared/types'
import { oneLine, parseSkillMd, serializeSkillMd, SKILL_NAME_RE, withSkillsBlock, type SkillDoc } from '../shared/skills'
import { getProject } from './store'
import { writeFileAtomic } from './fsutil'

const source = (root: string, name: string) => join(root, '.vi3ecode', 'skills', name, 'SKILL.md')
const copies = (root: string, name: string) => [join(root, '.claude', 'skills', name, 'SKILL.md'), join(root, '.opencode', 'skill', name, 'SKILL.md')]

function checkName(name: string): string {
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) throw new Error('Skill names use a-z, 0-9 and hyphens (up to 64 characters).')
  return name
}

function read(root: string, name: string): SkillDoc | null {
  try {
    return { name, ...parseSkillMd(readFileSync(source(root, name), 'utf8')) }
  } catch {
    return null
  }
}

function listSkills(root: string): Skill[] {
  let names: string[] = []
  try {
    names = readdirSync(join(root, '.vi3ecode', 'skills')).filter((n) => SKILL_NAME_RE.test(n))
  } catch {
    return []
  }
  return names
    .map((n) => read(root, n))
    .filter((s): s is SkillDoc => !!s)
    .map((s) => ({ ...s, installed: existsSync(copies(root, s.name)[0]) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Removes the file and its folder when that leaves it empty; other files a user put there stay. */
function removeFile(path: string): void {
  rmSync(path, { force: true })
  try {
    rmdirSync(dirname(path))
  } catch {
    // not empty or already gone
  }
}

function syncAgentsMd(root: string): void {
  const file = join(root, 'AGENTS.md')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const next = withSkillsBlock(current, listSkills(root).filter((s) => s.installed))
  if (next === current) return
  if (next) writeFileAtomic(file, next)
  else rmSync(file, { force: true })
}

function install(root: string, s: SkillDoc): void {
  const md = serializeSkillMd(s)
  for (const p of copies(root, s.name)) writeFileAtomic(p, md)
}

export const skillsApi = {
  async list(projectId: string): Promise<Skill[]> {
    return listSkills(getProject(projectId).path)
  },
  async save(projectId: string, skill: Omit<Skill, 'installed'>): Promise<Skill> {
    const root = getProject(projectId).path
    const s: SkillDoc = {
      name: checkName(skill?.name),
      description: oneLine(String(skill.description ?? '')).slice(0, 500),
      body: String(skill.body ?? '').slice(0, 100_000)
    }
    writeFileAtomic(source(root, s.name), serializeSkillMd(s))
    const installed = existsSync(copies(root, s.name)[0])
    // Keep installed copies and the AGENTS.md line in step with the edit.
    if (installed) {
      install(root, s)
      syncAgentsMd(root)
    }
    return { ...s, body: s.body.trim(), installed }
  },
  async remove(projectId: string, name: string): Promise<void> {
    const root = getProject(projectId).path
    checkName(name)
    for (const p of copies(root, name)) removeFile(p)
    removeFile(source(root, name))
    syncAgentsMd(root)
  },
  async setInstalled(projectId: string, name: string, installed: boolean): Promise<Skill[]> {
    const root = getProject(projectId).path
    const s = read(root, checkName(name))
    if (!s) throw new Error(`No skill named ${name}`)
    if (installed) install(root, s)
    else for (const p of copies(root, name)) removeFile(p)
    syncAgentsMd(root)
    return listSkills(root)
  }
}

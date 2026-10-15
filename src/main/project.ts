// Files under <project>/.vi3ecode/ — committed with the repo: board, notes, team, memory vault.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Kanban, MemoryNote, Notes, Team } from '../shared/types'
import { MEMORY_TYPES } from '../shared/types'
import { sanitizeBoard, sanitizeNotes, sanitizeTeam } from '../shared/schema'
import { buildIndex, extractLinks, parseNote, serializeNote, SLUG_RE } from '../shared/memory'
import { getProject } from './store'
import { readJson, writeFileAtomic, writeJson } from './fsutil'

export const dataDir = (projectId: string, ...parts: string[]) => join(getProject(projectId).path, '.vi3ecode', ...parts)

export const boardApi = {
  async get(projectId: string): Promise<Kanban> {
    return sanitizeBoard(readJson(dataDir(projectId, 'kanban.json'), null))
  },
  async save(projectId: string, board: Kanban): Promise<Kanban> {
    const clean = sanitizeBoard(board)
    writeJson(dataDir(projectId, 'kanban.json'), clean)
    return clean
  }
}

export const notesApi = {
  async get(projectId: string): Promise<Notes> {
    return sanitizeNotes(readJson(dataDir(projectId, 'notes.json'), null))
  },
  async save(projectId: string, notes: Notes): Promise<Notes> {
    const clean = sanitizeNotes(notes)
    writeJson(dataDir(projectId, 'notes.json'), clean)
    return clean
  }
}

export function readTeam(projectId: string): Team {
  return sanitizeTeam(readJson(dataDir(projectId, 'team.json'), null))
}

export function writeTeam(projectId: string, team: Team): Team {
  const clean = sanitizeTeam(team)
  writeJson(dataDir(projectId, 'team.json'), clean)
  return clean
}

export function listMemory(projectId: string): MemoryNote[] {
  const dir = dataDir(projectId, 'memory')
  let files: string[] = []
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  return files
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md' && SLUG_RE.test(f.slice(0, -3)))
    .map((f) => parseNote(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')))
}

/** Regenerate MEMORY.md; also called after a turn because agents may write notes themselves. */
export function reindexMemory(projectId: string): MemoryNote[] {
  const notes = listMemory(projectId)
  if (notes.length) writeFileAtomic(dataDir(projectId, 'memory', 'MEMORY.md'), buildIndex(notes))
  return notes
}

const today = () => new Date().toISOString().slice(0, 10)

export const memoryApi = {
  async list(projectId: string): Promise<MemoryNote[]> {
    return listMemory(projectId)
  },
  async save(
    projectId: string,
    note: Omit<MemoryNote, 'links' | 'created' | 'updated'> & { created?: string }
  ): Promise<MemoryNote> {
    if (!SLUG_RE.test(note.slug)) throw new Error('Invalid note slug')
    const type = MEMORY_TYPES.includes(note.type) ? note.type : 'fact'
    const full: MemoryNote = {
      slug: note.slug,
      title: String(note.title || note.slug).slice(0, 200),
      type,
      tags: (Array.isArray(note.tags) ? note.tags : []).map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 12),
      body: String(note.body ?? '').slice(0, 100_000),
      created: /^\d{4}-\d{2}-\d{2}$/.test(note.created ?? '') ? note.created! : today(),
      updated: today(),
      links: []
    }
    full.links = extractLinks(full.body)
    mkdirSync(dataDir(projectId, 'memory'), { recursive: true })
    writeFileAtomic(dataDir(projectId, 'memory', `${full.slug}.md`), serializeNote(full))
    reindexMemory(projectId)
    return full
  },
  async remove(projectId: string, slug: string): Promise<void> {
    if (!SLUG_RE.test(slug)) throw new Error('Invalid note slug')
    rmSync(dataDir(projectId, 'memory', `${slug}.md`), { force: true })
    const notes = reindexMemory(projectId)
    if (!notes.length) rmSync(dataDir(projectId, 'memory', 'MEMORY.md'), { force: true })
  }
}

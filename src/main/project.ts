// Files under <project>/.vi3ecode/ — committed with the repo: board, notes, team, memory vault.
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Kanban, MemoryNote, Notes, Team } from '../shared/types'
import { MEMORY_TYPES } from '../shared/types'
import { sanitizeBoard, sanitizeNotes, sanitizeTeam } from '../shared/schema'
import { boardFromDisk, boardToDisk, notesFromDisk, notesToDisk, teamFromDisk, teamToDisk } from '../shared/formats'
import { buildIndex, extractLinks, parseMemoryWrites, parseNote, serializeNote, slugify, SLUG_RE } from '../shared/memory'
import { getProject } from './store'
import { readJson, writeFileAtomic, writeJson } from './fsutil'

/** A path under <project>/.vi3ecode. A symlink committed there must not make us read or write outside the project. */
export function dataDir(projectId: string, ...parts: string[]): string {
  const root = getProject(projectId).path
  const p = join(root, '.vi3ecode', ...parts)
  let top: string
  try {
    top = realpathSync(root)
  } catch {
    return p // the project folder is gone: nothing there to link anywhere
  }
  let real = p
  for (let dir = p; ; dir = dirname(dir)) {
    try {
      real = join(realpathSync(dir), relative(dir, p)) // the deepest part that exists, resolved
      break
    } catch {
      if (dir === dirname(dir)) break
    }
  }
  if (!real.startsWith(top + sep)) throw new Error('.vi3ecode/ links outside the project')
  return p
}

export const boardApi = {
  async get(projectId: string): Promise<Kanban> {
    return boardFromDisk(readJson(dataDir(projectId, 'kanban.json'), null))
  },
  async save(projectId: string, board: Kanban): Promise<Kanban> {
    const clean = sanitizeBoard(board)
    const file = dataDir(projectId, 'kanban.json')
    writeJson(file, boardToDisk(clean, projectId, readJson(file, null)))
    return clean
  }
}

export const notesApi = {
  async get(projectId: string): Promise<Notes> {
    return notesFromDisk(readJson(dataDir(projectId, 'notes.json'), null))
  },
  async save(projectId: string, notes: Notes): Promise<Notes> {
    const clean = sanitizeNotes(notes)
    const file = dataDir(projectId, 'notes.json')
    writeJson(file, notesToDisk(clean, projectId, readJson(file, null)))
    return clean
  }
}

/** The team lives in .vi3ecode/agents.json (vi3ecode's file); team.json is read once for older projects. */
export function readTeam(projectId: string): Team {
  const disk = readJson<unknown>(dataDir(projectId, 'agents.json'), null) ?? readJson<unknown>(dataDir(projectId, 'team.json'), null)
  return teamFromDisk(disk)
}

export function writeTeam(projectId: string, team: Team): Team {
  const clean = sanitizeTeam(team)
  const file = dataDir(projectId, 'agents.json')
  writeJson(file, teamToDisk(clean, projectId, readJson(file, null)))
  return clean
}

const mdFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md' && SLUG_RE.test(f.slice(0, -3)) && !lstatSync(join(dir, f)).isSymbolicLink())
  } catch {
    return []
  }
}

/** Notes live in .vi3ecode/memory/entries/<slug>.md (vi3ecode's layout); flat memory/<slug>.md is still read. */
export function listMemory(projectId: string): MemoryNote[] {
  const notes = new Map<string, MemoryNote>()
  for (const dir of [dataDir(projectId, 'memory'), dataDir(projectId, 'memory', 'entries')]) {
    for (const f of mdFiles(dir)) notes.set(f.slice(0, -3), parseNote(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')))
  }
  return [...notes.values()]
}

/** Regenerate MEMORY.md and index.json; also called after a turn because agents may write notes themselves. */
export function reindexMemory(projectId: string): MemoryNote[] {
  const notes = listMemory(projectId)
  if (notes.length) {
    writeFileAtomic(dataDir(projectId, 'memory', 'MEMORY.md'), buildIndex(notes))
    writeJson(dataDir(projectId, 'memory', 'index.json'), {
      version: 1,
      entries: notes.map((n) => ({ slug: n.slug, title: n.title, type: n.type, tags: n.tags, links: n.links, updated: n.updated }))
    })
  }
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
    mkdirSync(dataDir(projectId, 'memory', 'entries'), { recursive: true })
    writeFileAtomic(dataDir(projectId, 'memory', 'entries', `${full.slug}.md`), serializeNote(full))
    rmSync(dataDir(projectId, 'memory', `${full.slug}.md`), { force: true }) // migrate a flat legacy copy
    reindexMemory(projectId)
    return full
  },
  async remove(projectId: string, slug: string): Promise<void> {
    if (!SLUG_RE.test(slug)) throw new Error('Invalid note slug')
    rmSync(dataDir(projectId, 'memory', `${slug}.md`), { force: true })
    rmSync(dataDir(projectId, 'memory', 'entries', `${slug}.md`), { force: true })
    const notes = reindexMemory(projectId)
    if (!notes.length) {
      rmSync(dataDir(projectId, 'memory', 'MEMORY.md'), { force: true })
      rmSync(dataDir(projectId, 'memory', 'index.json'), { force: true })
    }
  }
}

/** Agents with write-back on end lines with `MEMORY_WRITE {"title","content","type","tags"}`; store each as a note. */
export async function applyMemoryWrites(projectId: string, text: string): Promise<number> {
  const writes = parseMemoryWrites(text)
  if (!writes.length) return 0
  const taken = new Set(listMemory(projectId).map((n) => n.slug))
  for (const w of writes) {
    let slug = slugify(w.title)
    for (let n = 2; taken.has(slug); n++) slug = `${slugify(w.title).slice(0, 60)}-${n}`
    taken.add(slug)
    await memoryApi.save(projectId, { slug, title: w.title, type: w.type, tags: w.tags, body: w.content })
  }
  return writes.length
}

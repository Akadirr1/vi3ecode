// Explorer: read-only listing and preview of files inside a project. Every path from the renderer
// is resolved against the project root and rejected if it escapes it.
import { lstatSync, openSync, readSync, closeSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { FileContent, FileEntry } from '../shared/types'
import { getProject } from './store'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store'])
const MAX_READ = 512 * 1024

/** Absolute path for `rel` inside the project, or throws. Follows symlinks before checking. */
export function insideProject(projectId: string, rel: string): string {
  const root = realpathSync(getProject(projectId).path)
  const abs = resolve(root, String(rel ?? '').replace(/^[/\\]+/, ''))
  let real = abs
  try {
    real = realpathSync(abs)
  } catch {
    // does not exist yet; the lexical check below still applies
  }
  for (const p of [abs, real]) {
    if (p !== root && !p.startsWith(root + sep)) throw new Error('Path is outside the project')
  }
  return real
}

const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/')

export const filesApi = {
  async list(projectId: string, dir: string): Promise<FileEntry[]> {
    const root = realpathSync(getProject(projectId).path)
    const abs = insideProject(projectId, dir)
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => !HIDDEN.has(d.name))
      .map((d) => {
        const full = join(abs, d.name)
        let size: number | undefined
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) {
          try {
            isDir = lstatSync(realpathSync(full)).isDirectory()
          } catch {
            // dangling link: show as a file
          }
        } else if (!isDir) size = lstatSync(full).size
        return { name: d.name, path: toRel(root, full), dir: isDir, size }
      })
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  },
  async read(projectId: string, path: string): Promise<FileContent> {
    const abs = insideProject(projectId, path)
    const size = lstatSync(abs).size
    const fd = openSync(abs, 'r')
    try {
      const buf = Buffer.alloc(Math.min(size, MAX_READ))
      readSync(fd, buf, 0, buf.length, 0)
      const binary = buf.subarray(0, 8000).includes(0)
      return { text: binary ? '' : buf.toString('utf8'), binary, truncated: size > MAX_READ, size }
    } finally {
      closeSync(fd)
    }
  }
}

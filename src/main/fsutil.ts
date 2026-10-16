import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Write via temp file + rename so a crash mid-write never leaves a truncated file. */
export function writeFileAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  // Random name + 'wx': a file or symlink planted at a guessable temp path is never written through.
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, data, { encoding: 'utf8', flag: 'wx' })
  renameSync(tmp, path)
}

/**
 * `p` if, with every symlink in the part that exists resolved, it stays inside `root`: a symlink committed to a
 * repo must not make the app read or write outside the project.
 */
export function assertInside(root: string, p: string): string {
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
  if (real !== top && !real.startsWith(top + sep)) throw new Error(`${relative(root, p)} links outside the project`)
  return p
}

export function writeJson(path: string, data: unknown): void {
  writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n')
}

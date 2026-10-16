import { randomBytes } from 'node:crypto'
import { constants, copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/** Files whose last read failed for a reason other than not existing; writeJson will not replace them. */
const unreadable = new Set<string>()

/**
 * Missing file: the fallback. A file that exists but cannot be parsed is copied aside first (once per version),
 * since the save that follows replaces it. One that cannot be read at all (permissions, a lock) is left alone and
 * may not be overwritten until a later read succeeds.
 */
export function readJson<T>(path: string, fallback: T): T {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') unreadable.add(path)
    return fallback
  }
  unreadable.delete(path)
  try {
    return JSON.parse(text) as T
  } catch {
    if (text.trim()) keepAside(path)
    return fallback
  }
}


function keepAside(path: string): void {
  if (/\.unreadable-\d+$/.test(path)) return // never a copy of a copy
  try {
    const to = `${path}.unreadable-${Math.round(statSync(path).mtimeMs)}`
    copyFileSync(path, to, constants.COPYFILE_EXCL) // this version is already kept when it exists
    console.warn(`vi3ecode: could not parse ${path}; kept a copy as ${to}`)
  } catch {
    // already kept, or nothing more we can do; the caller still gets its fallback
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
  if (unreadable.has(path)) throw new Error(`${path} could not be read, so it was not replaced. Check its permissions or close the program holding it, then try again.`)
  writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n')
}

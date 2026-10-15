import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, path)
}

export function writeJson(path: string, data: unknown): void {
  writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n')
}

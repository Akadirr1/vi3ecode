import spawn from 'cross-spawn'
import { accessSync, constants, readFileSync } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path'
import type { EngineId, EngineInfo, EngineUsage } from '../../shared/types'
import type { EngineAdapter } from './types'
import { getSettings } from '../store'
import { claude } from './claude'
import { codex } from './codex'
import { gemini } from './gemini'
import { opencode } from './opencode'
import { cursor } from './cursor'

// Terminal-only engines: detected and launchable in a terminal pane, no headless contract yet.
const terminalOnly = (id: EngineId, label: string, bins: string[], installHint: string, models: string[] = [], efforts: string[] = []): EngineAdapter => ({
  id,
  label,
  bins,
  installHint,
  models,
  efforts
})

export const ADAPTERS: EngineAdapter[] = [
  claude,
  codex,
  gemini,
  opencode,
  cursor,
  terminalOnly('kimi', 'Kimi', ['kimi'], 'Install the Kimi Code CLI (`kimi`) and sign in once', ['kimi-code/k3', 'kimi-code/k3-256k', 'kimi-code/kimi-for-coding']),
  terminalOnly('grok', 'Grok', ['grok'], 'npm install -g @xai-official/grok'),
  terminalOnly('kiro', 'Kiro CLI', ['kiro-cli'], 'curl -fsSL https://cli.kiro.dev/install | bash'),
  terminalOnly('cline', 'Cline', ['cline'], 'npm install -g cline'),
  terminalOnly('command', 'Command Code', ['command-code'], 'npm install -g command-code', [], ['low', 'medium', 'high', 'xhigh', 'max']),
  terminalOnly('antigravity', 'Google Antigravity', ['agy'], 'Install Google Antigravity and enable its `agy` command', [], ['low', 'medium', 'high'])
]

export function getAdapter(id: EngineId): EngineAdapter {
  const a = ADAPTERS.find((x) => x.id === id)
  if (!a) throw new Error(`Unknown engine: ${id}`)
  return a
}

/** PATH lookup without spawning a shell; honours PATHEXT on Windows. */
export function findOnPath(bin: string, env = process.env): string | null {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').concat('') : ['']
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    // A relative entry ("." or "") would resolve against the project folder.
    if (!dir || !isAbsolute(dir)) continue
    for (const ext of exts) {
      const p = join(dir, bin + ext)
      try {
        accessSync(p, constants.X_OK)
        return p
      } catch {
        // keep looking
      }
    }
  }
  return null
}

function version(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(bin, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const t = setTimeout(() => child.kill(), 5000)
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolve(undefined))
    child.on('close', () => {
      clearTimeout(t)
      resolve(/\d+\.\d+[\w.-]*/.exec(out)?.[0])
    })
  })
}

let cache: EngineInfo[] | null = null
const found = new Map<EngineId, string>()
const usage = new Map<EngineId, EngineUsage>()

const resolveBin = (a: EngineAdapter) => a.bins.map((b) => findOnPath(b)).find((p): p is string => !!p)

/**
 * Absolute path of an engine's executable. Never a bare name: on Windows a bare name is looked up in the
 * spawn's cwd (the project) first, where a cloned repo could plant claude.cmd. Not on PATH → a path that
 * fails with ENOENT, which callers already report as "not found".
 */
export function binOf(a: EngineAdapter): string {
  const path = found.get(a.id) ?? resolveBin(a)
  if (path) found.set(a.id, path)
  return path ?? join(dirname(process.execPath), 'not-on-path', a.bins[0])
}

/**
 * What to actually spawn for an executable. On Windows an npm `.cmd` shim is unwrapped to the script it
 * runs: through cmd.exe a prompt or JSON argument with quotes, `%` or newlines gets cut or even run as a
 * command. Anything else is spawned as is.
 */
export function spawnTarget(bin: string): { command: string; args: string[] } {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(bin)) return { command: bin, args: [] }
  let shim = ''
  try {
    shim = readFileSync(bin, 'utf8')
  } catch {
    return { command: bin, args: [] }
  }
  const rel = shimScript(shim)
  if (!rel) return { command: bin, args: [] }
  const target = join(dirname(bin), rel)
  if (/\.exe$/i.test(target)) return { command: target, args: [] }
  const local = join(dirname(bin), 'node.exe')
  // Without node on PATH the shim's bare `node` would be looked up in the project first: fail with ENOENT instead.
  const node = isFile(local) ? local : (findOnPath('node') ?? join(dirname(process.execPath), 'not-on-path', 'node'))
  return { command: node, args: [target] }
}

/** The file an npm cmd-shim runs, relative to the shim: `"%dp0%\node_modules\pkg\cli.js" %*` (or a native .exe). */
export function shimScript(shim: string): string | null {
  return /"%~?dp0%?\\([^"]+)"\s*%\*/i.exec(shim)?.[1] ?? null
}

function isFile(p: string): boolean {
  try {
    accessSync(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Latest rate-limit window an engine reported (Claude Code streams it with every turn). */
export function setUsage(id: EngineId, info: Record<string, unknown>): void {
  usage.set(id, {
    status: typeof info.status === 'string' ? info.status : undefined,
    window: typeof info.rateLimitType === 'string' ? info.rateLimitType : undefined,
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined,
    updatedAt: Date.now()
  })
}

async function detect(): Promise<EngineInfo[]> {
  const hidden = getSettings().hiddenEngines
  return Promise.all(
    ADAPTERS.map(async (a): Promise<EngineInfo> => {
      const enabled = !hidden.includes(a.id)
      // A hidden engine is not polled at all.
      const path = enabled ? resolveBin(a) : undefined
      if (path) found.set(a.id, path)
      else found.delete(a.id)
      return {
        id: a.id,
        label: a.label,
        bin: path ? basename(path, extname(path)) : a.bins[0],
        installed: !!path,
        version: path ? await version(path) : undefined,
        headless: !!a.build,
        enabled,
        installHint: a.installHint,
        models: a.models,
        efforts: a.efforts
      }
    })
  )
}

export const enginesApi = {
  async list(refresh?: boolean): Promise<EngineInfo[]> {
    if (!cache || refresh) cache = await detect()
    const hidden = getSettings().hiddenEngines
    return cache.map((e) => ({ ...e, enabled: !hidden.includes(e.id), usage: usage.get(e.id) }))
  }
}

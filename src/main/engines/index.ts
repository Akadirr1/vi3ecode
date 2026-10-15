import spawn from 'cross-spawn'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { EngineId, EngineInfo } from '../../shared/types'
import type { EngineAdapter } from './types'
import { getSettings } from '../store'
import { claude } from './claude'
import { codex } from './codex'
import { gemini } from './gemini'
import { opencode } from './opencode'
import { cursor } from './cursor'

// Terminal-only engines: detected and launchable in a terminal pane, no headless contract yet.
const terminalOnly = (id: EngineId, label: string, bin: string, installHint: string): EngineAdapter => ({ id, label, bin, installHint })

export const ADAPTERS: EngineAdapter[] = [
  claude,
  codex,
  gemini,
  opencode,
  cursor,
  terminalOnly('kimi', 'Kimi CLI', 'kimi', 'uv tool install kimi-cli'),
  terminalOnly('grok', 'Grok CLI', 'grok', 'npm install -g @vibe-kit/grok-cli'),
  terminalOnly('kiro', 'Kiro CLI', 'kiro-cli', 'curl -fsSL https://cli.kiro.dev/install | bash'),
  terminalOnly('cline', 'Cline CLI', 'cline', 'npm install -g cline'),
  terminalOnly('command', 'Command Code', 'command-code', 'npm install -g command-code'),
  terminalOnly('antigravity', 'Antigravity', 'antigravity', 'Install Google Antigravity and enable its shell command')
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
    if (!dir) continue
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

async function detect(): Promise<EngineInfo[]> {
  const hidden = getSettings().hiddenEngines
  return Promise.all(
    ADAPTERS.map(async (a): Promise<EngineInfo> => {
      const enabled = !hidden.includes(a.id)
      // A hidden engine is not polled at all.
      const path = enabled ? findOnPath(a.bin) : null
      return {
        id: a.id,
        label: a.label,
        bin: a.bin,
        installed: !!path,
        version: path ? await version(a.bin) : undefined,
        headless: !!a.build,
        enabled,
        installHint: a.installHint
      }
    })
  )
}

export const enginesApi = {
  async list(refresh?: boolean): Promise<EngineInfo[]> {
    if (!cache || refresh) cache = await detect()
    const hidden = getSettings().hiddenEngines
    return cache.map((e) => ({ ...e, enabled: !hidden.includes(e.id) }))
  }
}

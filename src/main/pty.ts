// Terminal panes: real PTYs (node-pty), rendered by xterm.js in the renderer.
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import type { EngineId, PtyInfo } from '../shared/types'
import { buildBrief } from '../shared/memory'
import { getProject, getSettings } from './store'
import { emit } from './events'
import { record, registerLive } from './activity'
import { binOf, getAdapter } from './engines'
import { dataDir, listMemory } from './project'
import { writeFileAtomic } from './fsutil'

interface Pane {
  info: PtyInfo
  proc: pty.IPty
  buffer: string
  startedAt: number
}

const BUFFER_MAX = 256 * 1024
const panes = new Map<string, Pane>()
registerLive('terminals', () => panes.size)

export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
}

const clampDim = (n: number, max: number) => (Number.isInteger(n) && n > 0 ? Math.min(n, max) : 80)

/** Quotes one word for the pane's shell: POSIX sh on macOS/Linux, PowerShell on Windows. */
export function shellQuote(arg: string, powershell = process.platform === 'win32'): string {
  if (/^[\w./:=@%+,-]+$/.test(arg)) return arg
  // PowerShell also treats typographic single quotes as quote characters.
  return powershell ? `'${arg.replace(/['‘’‚‛]/g, '$&$&')}'` : `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Interactive flags per engine CLI (each checked against that CLI's --help). */
export function engineArgs(engine: EngineId, model?: string, effort?: string): string[] {
  const m = (flag: string) => (model ? [flag, model] : [])
  const e = (flag: string) => (effort ? [flag, effort] : [])
  switch (engine) {
    case 'claude':
    case 'antigravity':
    case 'command':
    case 'grok':
      return [...m('--model'), ...e('--effort')]
    case 'codex':
      // Inline mode keeps the conversation in xterm's scrollback.
      return ['--no-alt-screen', ...m('-m'), ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : [])]
    case 'opencode':
      return m('-m')
    case 'cline':
      // Cline auto-approves every tool unless told otherwise.
      return ['--auto-approve', 'false', ...m('-m'), ...e('--thinking')]
    case 'kiro':
      return ['chat', ...m('--model')]
    default:
      return m('--model')
  }
}

/** The command line typed into an engine pane, and what the pane records about it. */
function engineLaunch(projectId: string, engine: EngineId, model?: string, effort?: string) {
  const adapter = getAdapter(engine)
  if (model !== undefined && (typeof model !== 'string' || model.length > 200 || /[\0-\x1f\x7f]/.test(model))) throw new Error('Invalid model name')
  const m = model?.trim() || undefined
  const e = effort && adapter.efforts.includes(effort) ? effort : undefined
  const args = engineArgs(engine, m, e)
  if (engine === 'claude' && getSettings().memoryInject) {
    const brief = buildBrief(listMemory(projectId))
    if (brief) {
      const file = dataDir(projectId, 'engine-inject', 'claude.md')
      writeFileAtomic(file, brief)
      // Generated on every launch; the vault itself is what gets committed.
      writeFileAtomic(dataDir(projectId, 'engine-inject', '.gitignore'), '*\n')
      args.push('--append-system-prompt-file', file)
    }
  }
  // `clear` first: the pane opens on the engine's UI rather than on the long command line typed to start it.
  // PowerShell runs a quoted path only with `&`; the full path to the .cmd also skips npm's .ps1 shim,
  // which the default Restricted execution policy refuses to run.
  const call = process.platform === 'win32' ? '& ' : ''
  const command = `clear; ${call}${[binOf(adapter), ...args].map((a) => shellQuote(a)).join(' ')}`
  return { command, label: adapter.label, model: m, effort: e }
}

export const ptyApi = {
  async create(
    projectId: string,
    opts: { cols: number; rows: number; engine?: EngineId; model?: string; effort?: string; command?: string; title?: string }
  ): Promise<PtyInfo> {
    const project = getProject(projectId)
    const launch = opts.engine ? engineLaunch(projectId, opts.engine, opts.model, opts.effort) : null
    const { file, args } = defaultShell()
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: clampDim(opts.cols, 500),
      rows: clampDim(opts.rows, 300),
      cwd: project.path,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    })
    const id = randomUUID()
    const n = [...panes.values()].filter((p) => p.info.projectId === projectId).length + 1
    const info: PtyInfo = { id, projectId, title: String(opts.title || launch?.label || `Terminal ${n}`).slice(0, 40) }
    if (launch) Object.assign(info, { engine: opts.engine, model: launch.model, effort: launch.effort })
    const pane: Pane = { info, proc, buffer: '', startedAt: Date.now() }
    panes.set(id, pane)
    proc.onData((data) => {
      pane.buffer = (pane.buffer + data).slice(-BUFFER_MAX)
      emit('pty:data', id, data)
    })
    proc.onExit(({ exitCode }) => {
      panes.delete(id)
      emit('pty:exit', id, exitCode)
      record({ source: 'terminal', kind: 'pane-exit', outcome: exitCode === 0 ? 'ok' : 'error', projectId, engine: info.engine, durationMs: Date.now() - pane.startedAt })
    })
    // Typed into the shell (not exec'd) so the pane drops back to a prompt when the command ends.
    const command = launch?.command ?? opts.command
    if (command) proc.write(`${command}\r`)
    record({ source: 'terminal', kind: 'pane-open', outcome: 'info', projectId, engine: info.engine })
    return info
  },
  async list(projectId: string): Promise<PtyInfo[]> {
    return [...panes.values()].filter((p) => p.info.projectId === projectId).map((p) => p.info)
  },
  async attach(id: string): Promise<string> {
    return panes.get(id)?.buffer ?? ''
  },
  async kill(id: string): Promise<void> {
    panes.get(id)?.proc.kill()
  }
}

export function writePty(id: string, data: string): void {
  if (typeof data === 'string') panes.get(id)?.proc.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  const p = panes.get(id)
  if (p) p.proc.resize(clampDim(cols, 500), clampDim(rows, 300))
}

export function killAllPtys(): void {
  for (const p of panes.values()) p.proc.kill()
  panes.clear()
}

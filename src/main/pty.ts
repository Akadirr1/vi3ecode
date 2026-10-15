// Terminal panes: real PTYs (node-pty), rendered by xterm.js in the renderer.
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import type { PtyInfo } from '../shared/types'
import { getProject } from './store'
import { emit } from './events'
import { record, registerLive } from './activity'

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

export const ptyApi = {
  async create(projectId: string, opts: { cols: number; rows: number; command?: string; title?: string }): Promise<PtyInfo> {
    const project = getProject(projectId)
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
    const pane: Pane = {
      info: { id, projectId, title: String(opts.title || `pane ${n}`).slice(0, 40) },
      proc,
      buffer: '',
      startedAt: Date.now()
    }
    panes.set(id, pane)
    proc.onData((data) => {
      pane.buffer = (pane.buffer + data).slice(-BUFFER_MAX)
      emit('pty:data', id, data)
    })
    proc.onExit(({ exitCode }) => {
      panes.delete(id)
      emit('pty:exit', id, exitCode)
      record({ source: 'terminal', kind: 'pane-exit', outcome: exitCode === 0 ? 'ok' : 'error', projectId, durationMs: Date.now() - pane.startedAt })
    })
    // Typed into the shell (not exec'd) so the pane drops back to a prompt when the command ends.
    if (opts.command) proc.write(`${opts.command}\r`)
    record({ source: 'terminal', kind: 'pane-open', outcome: 'info', projectId })
    return pane.info
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

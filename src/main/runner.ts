// Runs one non-interactive engine turn and normalizes its stream.
import spawn from 'cross-spawn'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import type { EngineAdapter, EngineEvent, TurnOpts } from './engines/types'
import { binOf } from './engines'

export interface TurnResult {
  text: string
  tools: string[]
  /** Files the engine reported writing, relative to cwd. */
  files: string[]
  costUsd?: number
  sessionId?: string
  error?: string
  stopped: boolean
  durationMs: number
}

export interface TurnHandle {
  done: Promise<TurnResult>
  stop(): void
}

export function runTurn(
  adapter: EngineAdapter,
  cwd: string,
  opts: TurnOpts,
  onEvent: (e: EngineEvent) => void = () => {}
): TurnHandle {
  if (!adapter.build || !adapter.parse) throw new Error(`${adapter.label} is terminal-only`)
  const parse = adapter.parse
  const inv = adapter.build(opts)
  const started = Date.now()
  const texts: string[] = []
  const tools: string[] = []
  const files = new Set<string>()
  let resultText: string | undefined
  let resultError = false
  let costUsd: number | undefined
  let sessionId: string | undefined
  let stderr = ''
  let stopped = false
  let spawnError: string | undefined

  const bin = binOf(adapter)
  const child: ChildProcess = spawn(bin, inv.args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // Own process group on POSIX so stop() can take the engine's children (shells, tests) down too.
    detached: process.platform !== 'win32'
  })

  let lastWasDelta = false
  const handle = (e: EngineEvent) => {
    if (e.type !== 'text') lastWasDelta = false
    if (e.type === 'text') {
      if (e.delta && lastWasDelta) texts[texts.length - 1] += e.text
      else texts.push(e.text)
      lastWasDelta = !!e.delta
    }
    else if (e.type === 'tool') {
      tools.push(e.name)
      if (e.file) files.add(isAbsolute(e.file) ? relative(cwd, e.file) : e.file)
    } else if (e.type === 'session') sessionId = e.id
    else if (e.type === 'result') {
      resultText = e.text
      resultError = !!e.isError
      if (typeof e.costUsd === 'number') costUsd = (costUsd ?? 0) + e.costUsd
    } else if (e.type === 'error') spawnError = e.message
    onEvent(e)
  }

  let buf = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      for (const e of parse(line)) handle(e)
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)))
  child.stdin?.on('error', () => {}) // engine may exit before reading stdin
  child.stdin?.end(inv.stdin ?? '')

  const done = new Promise<TurnResult>((resolve) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err.code === 'ENOENT' ? `${bin} was not found on PATH. ${adapter.installHint}` : err.message
    })
    child.on('close', (code) => {
      if (buf.trim()) for (const e of parse(buf)) handle(e)
      let text = texts.join('\n\n').trim()
      if (!text && resultText) text = resultText.trim()
      let error: string | undefined
      if (!stopped) {
        if (spawnError) error = spawnError
        else if (resultError) error = resultText || 'The engine reported an error.'
        else if (code !== 0 && code !== null) error = lastLines(stderr) || `${bin} exited with code ${code}`
        else if (code === null && !text) error = lastLines(stderr) || `${bin} was terminated`
      }
      resolve({ text, tools, files: [...files], costUsd, sessionId, error, stopped, durationMs: Date.now() - started })
    })
  })

  return {
    done,
    stop() {
      if (stopped || child.exitCode !== null) return
      stopped = true
      killTree(child)
    }
  }
}

function lastLines(s: string, n = 6): string {
  return s.trim().split('\n').slice(-n).join('\n')
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill())
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const t = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      // already gone
    }
  }, 3000)
  t.unref()
}

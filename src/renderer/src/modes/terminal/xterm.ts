// xterm.js plumbing for the pane grid: ordered output, scrollback restore, bracketed paste, fitting.
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { api } from '../../api'

export interface Live {
  term: Terminal
  fit: FitAddon
  /** Stream offset the terminal shows up to; null while attach() is in flight. */
  shown: number | null
  queue: [offset: number, data: string][]
}

export interface Registry {
  terms: Map<string, Live>
  /** Characters received per pane since this view mounted, i.e. the stream offset of its next chunk. */
  received: Map<string, number>
  /** Panes created by this mount: their whole stream was observed, so offsets line up with attach(). */
  fresh: Set<string>
  /** Intent text waiting for its pane to reach a prompt. */
  waiting: Map<string, string>
  /** Last keystroke and last output not caused by one, per pane: drives the BUSY badge. */
  typed: Map<string, number>
  output: Map<string, number>
  /** Bell detection per pane, and the end of its last output chunk. */
  activity: Map<string, Activity>
  tail: Map<string, string>
}

export const newRegistry = (): Registry => ({
  terms: new Map(),
  received: new Map(),
  fresh: new Set(),
  waiting: new Map(),
  typed: new Map(),
  output: new Map(),
  activity: new Map(),
  tail: new Map()
})

/** An engine CLI is working while it shows "esc to interrupt"; the original's thresholds. */
export interface Activity {
  thinking: boolean
  lastHintAt: number
  hintSince: number | null
  lastOutputAt: number
}
export const IDLE: Activity = { thinking: false, lastHintAt: 0, hintSince: null, lastOutputAt: 0 }
const ENTER_MS = 500
const DONE_AFTER_HINT_MS = 2500
const QUIET_MS = 1000

/** One observation of a pane; `done` is true on the step where a working pane goes quiet. */
export function observe(a: Activity, o: { hint: boolean; output: boolean; at: number }): { next: Activity; done: boolean } {
  const lastOutputAt = o.output ? o.at : a.lastOutputAt
  const lastHintAt = o.hint ? o.at : a.lastHintAt
  const hintSince = o.hint ? (a.hintSince ?? o.at) : null
  if (o.hint) return { next: { thinking: a.thinking || o.at - hintSince! >= ENTER_MS, lastHintAt, hintSince, lastOutputAt }, done: false }
  const done = a.thinking && o.at - lastHintAt > DONE_AFTER_HINT_MS && o.at - lastOutputAt > QUIET_MS
  return { next: { thinking: a.thinking && !done, lastHintAt, hintSince, lastOutputAt }, done }
}

const CSI = /(?:\x1b\[|\x9b)[0-9;?]*[ -/]*[@-~]/g
export const streamHint = (text: string) => /interrupt/i.test(text.replace(CSI, ''))

/** The status line in the bottom 8 rows, where engine CLIs draw it. */
export function screenHint(term: Terminal): boolean {
  const b = term.buffer.active
  let text = ''
  for (let y = Math.max(0, term.rows - 8); y < term.rows; y++) text += (b.getLine(b.baseY + y)?.translateToString(true) ?? '') + '\n'
  return /interrupt/i.test(text)
}

const PANE_CHROME = { width: 30, height: 56 } // host inset + scrollbar, pane header

/** Size for a pane created before its xterm exists, so the shell's first prompt isn't drawn at 80 columns. */
export function estimateSize(grid: HTMLElement | null, cols: number, rows: number) {
  const c = document.createElement('canvas').getContext('2d')
  if (!c || !grid?.clientWidth) return { cols: 80, rows: 24 }
  c.font = `13px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`
  const m = c.measureText('W')
  const lineHeight = Math.ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
  return {
    cols: Math.max(20, Math.floor((grid.clientWidth / cols - PANE_CHROME.width) / m.width)),
    rows: Math.max(5, Math.floor((grid.clientHeight / rows - PANE_CHROME.height) / lineHeight))
  }
}

export function fitPane(id: string, el: HTMLElement, live: Live) {
  if (!el.offsetWidth || !el.offsetHeight) return // hidden: fitting a 0-size element breaks the grid
  live.fit.fit()
  api.pty.resize(id, live.term.cols, live.term.rows)
}

export function xtermTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { background: v('--bg-2'), foreground: v('--text'), cursor: v('--accent'), cursorAccent: v('--bg-2'), selectionBackground: v('--line-2') }
}

/** Bracketed paste keeps multi-line text at the prompt; a raw newline would run each line as a command. */
export function paste(reg: Registry, id: string, text: string): boolean {
  const term = reg.terms.get(id)?.term
  if (!term?.modes.bracketedPasteMode) return false
  term.paste(text)
  reg.waiting.delete(id)
  return true
}

function write(reg: Registry, id: string, data: string) {
  reg.terms.get(id)?.term.write(data, () => {
    const text = reg.waiting.get(id)
    if (text !== undefined) paste(reg, id, text)
  })
}

// Data events and the attach() reply arrive in no fixed order, so chunks are placed by stream offset.
export function show(reg: Registry, id: string, live: Live, offset: number, data: string) {
  if (live.shown === null) return void live.queue.push([offset, data])
  const end = offset + data.length
  if (end <= live.shown) return
  write(reg, id, data.slice(Math.max(0, live.shown - offset)))
  live.shown = end
}

/** Restores the pane's scrollback, then replays whatever streamed in meanwhile. */
export async function restore(reg: Registry, id: string, live: Live, disposed: () => boolean) {
  const buffer = await api.pty.attach(id)
  if (disposed()) return
  write(reg, id, buffer)
  // shortcut: a pane from before this mount has an unknown stream start, so chunks already received count as
  // part of the buffer; one racing the reply can show twice. Exact fix: attach() returning its stream offset.
  live.shown = reg.fresh.has(id) ? buffer.length : (reg.received.get(id) ?? 0)
  for (const [offset, data] of live.queue) show(reg, id, live, offset, data)
  live.queue = []
}

/** Pastes into a pane now, or once its shell turns bracketed paste on; a shell that never does gets the text flattened. */
export function pasteWhenReady(reg: Registry, id: string, text: string) {
  if (paste(reg, id, text)) return
  reg.waiting.set(id, text)
  setTimeout(() => {
    const pending = reg.waiting.get(id)
    if (pending === undefined || paste(reg, id, pending)) return
    reg.waiting.delete(id)
    api.pty.write(id, pending.replace(/\r?\n/g, ' '))
  }, 2000)
}

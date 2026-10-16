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
}

export const newRegistry = (): Registry => ({
  terms: new Map(),
  received: new Map(),
  fresh: new Set(),
  waiting: new Map(),
  typed: new Map(),
  output: new Map()
})

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

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { PtyInfo } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import './terminal.css'

interface Pane {
  info: PtyInfo
  exitCode?: number
}

interface Live {
  term: Terminal
  fit: FitAddon
  /** Stream offset the terminal shows up to; null while attach() is in flight. */
  shown: number | null
  queue: [offset: number, data: string][]
}

interface Registry {
  terms: Map<string, Live>
  /** Characters received per pane since this view mounted, i.e. the stream offset of its next chunk. */
  received: Map<string, number>
  /** Panes created by this mount: their whole stream was observed, so offsets line up with attach(). */
  fresh: Set<string>
  /** Intent text waiting for its pane to reach a prompt. */
  waiting: Map<string, string>
}

/** Size for a pane created before any xterm exists, so the shell's first prompt isn't drawn at 80 columns. */
function estimateSize(area: HTMLElement | null) {
  const c = document.createElement('canvas').getContext('2d')
  if (!c || !area?.clientWidth) return { cols: 80, rows: 24 }
  c.font = `13px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`
  const m = c.measureText('W')
  const lineHeight = Math.ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
  // Minus the host inset and xterm's scrollbar.
  return { cols: Math.floor((area.clientWidth - 30) / m.width), rows: Math.floor((area.clientHeight - 12) / lineHeight) }
}

function fitPane(id: string, el: HTMLElement, live: Live) {
  if (!el.offsetWidth || !el.offsetHeight) return // hidden: fitting a 0-size element breaks the grid
  live.fit.fit()
  api.pty.resize(id, live.term.cols, live.term.rows)
}

function xtermTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { background: v('--bg'), foreground: v('--text'), cursor: v('--accent'), selectionBackground: v('--line-2') }
}

/** Bracketed paste keeps multi-line text at the prompt; a raw newline would run each line as a command. */
function paste(reg: Registry, id: string, text: string): boolean {
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
function show(reg: Registry, id: string, live: Live, offset: number, data: string) {
  if (live.shown === null) return void live.queue.push([offset, data])
  const end = offset + data.length
  if (end <= live.shown) return
  write(reg, id, data.slice(Math.max(0, live.shown - offset)))
  live.shown = end
}

export function TerminalView({ active }: { active: boolean }) {
  const ctx = useApp()
  const [panes, setPanes] = useState<Pane[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const reg = useRef<Registry>({ terms: new Map(), received: new Map(), fresh: new Set(), waiting: new Map() }).current
  const areaRef = useRef<HTMLDivElement>(null)
  // Ignore an intent left over from before this mount (e.g. another project).
  const seenIntent = useRef(ctx.terminalIntent?.nonce)

  useEffect(() => {
    void api.pty.list(ctx.project.id).then((list) => {
      setPanes(list.map((info) => ({ info })))
      setActiveId(list[0]?.id ?? null)
    })
    const offData = api.pty.onData((id, data) => {
      const offset = reg.received.get(id) ?? 0
      reg.received.set(id, offset + data.length)
      const live = reg.terms.get(id)
      if (live) show(reg, id, live, offset, data)
    })
    const offExit = api.pty.onExit((id, code) => {
      reg.terms.get(id)?.term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
      setPanes((ps) => ps && ps.map((p) => (p.info.id === id ? { ...p, exitCode: code } : p)))
    })
    // Theme switches land on <html> after our effects run, so follow the attribute itself.
    const retheme = () => {
      const theme = xtermTheme()
      for (const live of reg.terms.values()) live.term.options.theme = theme
    }
    const mo = new MutationObserver(retheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', retheme)
    return () => {
      offData()
      offExit()
      mo.disconnect()
      mq.removeEventListener('change', retheme)
    }
  }, [ctx.project.id, reg])

  const create = async (command?: string, title?: string): Promise<PtyInfo> => {
    const cur = activeId ? reg.terms.get(activeId)?.term : undefined
    const size = cur ? { cols: cur.cols, rows: cur.rows } : estimateSize(areaRef.current)
    const info = await api.pty.create(ctx.project.id, { ...size, command, title })
    reg.fresh.add(info.id)
    setPanes((ps) => [...(ps ?? []), { info }])
    setActiveId(info.id)
    return info
  }

  const close = (id: string) => {
    void api.pty.kill(id)
    const rest = (panes ?? []).filter((p) => p.info.id !== id)
    setPanes(rest)
    if (activeId === id) setActiveId(rest[rest.length - 1]?.info.id ?? null)
  }

  useEffect(() => {
    const intent = ctx.terminalIntent
    if (!intent || !panes || intent.nonce === seenIntent.current) return
    seenIntent.current = intent.nonce
    void (async () => {
      const current = panes.find((p) => p.info.id === activeId && p.exitCode === undefined)
      const id = current?.info.id ?? (await create()).id
      if (paste(reg, id, intent.text)) return
      // A fresh shell turns bracketed paste on with its first prompt; one that never does gets the text flattened.
      reg.waiting.set(id, intent.text)
      setTimeout(() => {
        const text = reg.waiting.get(id)
        if (text === undefined || paste(reg, id, text)) return
        reg.waiting.delete(id)
        api.pty.write(id, text.replace(/\r?\n/g, ' '))
      }, 2000)
    })()
  }, [ctx.terminalIntent, panes])

  const runnable = ctx.engines.filter((e) => e.installed && e.enabled)
  const createButtons = (
    <>
      <button className="btn small" onClick={() => void create()}>
        + Shell
      </button>
      <select
        className="select term-engine"
        aria-label="Start an engine in a new pane"
        value=""
        onChange={(e) => {
          const engine = runnable.find((x) => x.id === e.target.value)
          if (engine) void create(engine.bin, engine.label)
        }}
        disabled={!runnable.length}
      >
        <option value="">+ Engine…</option>
        {runnable.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
            {e.headless ? '' : ' (terminal only)'}
          </option>
        ))}
      </select>
    </>
  )

  return (
    <div className="view">
      <div className="view-header">
        <h2>Terminal</h2>
        <div className="term-tabs grow" role="group" aria-label="Terminal panes">
          {panes?.map((p) => (
            <div key={p.info.id} className={`term-tab${p.info.id === activeId ? ' active' : ''}`}>
              <button
                className="term-tab-label"
                aria-pressed={p.info.id === activeId}
                onClick={() => setActiveId(p.info.id)}
                title={p.exitCode === undefined ? p.info.title : `${p.info.title} — exited (${p.exitCode})`}
              >
                <span className={`dot ${p.exitCode === undefined ? 'on' : 'off'}`} aria-hidden />
                {p.info.title}
                {p.exitCode !== undefined ? <span className="faint"> · exited</span> : null}
              </button>
              <button className="term-tab-close" aria-label={`Close ${p.info.title}`} onClick={() => close(p.info.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        {panes?.length ? createButtons : null}
      </div>
      <div className="term-area" ref={areaRef}>
        {panes?.map((p) => (
          <PaneHost key={p.info.id} id={p.info.id} shown={active && p.info.id === activeId} reg={reg} />
        ))}
        {panes && !panes.length ? (
          <div className="empty term-empty">
            <div>No terminal yet</div>
            <div className="row">{createButtons}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PaneHost({ id, shown, reg }: { id: string; shown: boolean; reg: Registry }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current!
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()
    const term = new Terminal({ fontFamily, fontSize: 13, cursorBlink: true, theme: xtermTheme() })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const live: Live = { term, fit, shown: null, queue: [] }
    reg.terms.set(id, live)
    let disposed = false
    void api.pty.attach(id).then((buffer) => {
      if (disposed) return
      write(reg, id, buffer)
      // shortcut: a pane from before this mount has an unknown stream start, so chunks already received count as
      // part of the buffer; one racing the reply can show twice. Exact fix: attach() returning its stream offset.
      live.shown = reg.fresh.has(id) ? buffer.length : (reg.received.get(id) ?? 0)
      for (const [offset, data] of live.queue) show(reg, id, live, offset, data)
      live.queue = []
    })
    const input = term.onData((data) => api.pty.write(id, data))
    const ro = new ResizeObserver(() => fitPane(id, el, live))
    ro.observe(el)
    return () => {
      disposed = true
      ro.disconnect()
      input.dispose()
      term.dispose()
      reg.terms.delete(id)
    }
  }, [id, reg])

  useEffect(() => {
    if (!shown) return
    const live = reg.terms.get(id)
    if (!live) return
    fitPane(id, ref.current!, live)
    live.term.focus()
  }, [shown, id, reg])

  return <div ref={ref} className="term-host" hidden={!shown} />
}

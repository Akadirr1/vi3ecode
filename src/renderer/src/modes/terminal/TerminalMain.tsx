import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Columns2, Grid2x2, Plus, Square, SquareTerminal } from 'lucide-react'
import type { PtyInfo } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { t } from '../../i18n'
import { errorText } from '../../components/format'
import { PaneCard } from './Pane'
import { PaneForm, PopButton, type Launch } from './PaneForm'
import { focusPane, getPanes, setPanes, usePanes, type Pane } from './store'
import { estimateSize, newRegistry, pasteWhenReady, show, xtermTheme } from './xterm'
import './terminal-mode.css'

const LAYOUTS = [
  { size: 1, cols: 1, label: '1 pane', icon: Square },
  { size: 2, cols: 2, label: '2 columns', icon: Columns2 },
  { size: 4, cols: 2, label: '2 × 2 grid', icon: Grid2x2 }
]
const LAYOUT_KEY = 'vi3ecode.terminalLayout'
/** A pane is BUSY while it prints output the user did not just type (echo arrives within ECHO_MS). */
const BUSY_MS = 1500
const ECHO_MS = 300

function loadLayout(): number {
  try {
    const n = Number(localStorage.getItem(LAYOUT_KEY))
    return LAYOUTS.some((l) => l.size === n) ? n : 2
  } catch {
    return 2
  }
}

const launchOf = (p: Pane): Launch => ({ engine: p.info.engine, model: p.info.model, effort: p.info.effort, title: p.info.title })

/** Grid of real PTY panes; extra panes beyond the layout live on further pages, reachable from the tab strip. */
export function TerminalMain({ active }: { active: boolean }) {
  const ctx = useApp()
  const pid = ctx.project.id
  const { panes, focused, tick } = usePanes(pid)
  const [loaded, setLoaded] = useState(false)
  const [size, setSize] = useState(loadLayout)
  const reg = useRef(newRegistry()).current
  const gridRef = useRef<HTMLDivElement>(null)
  // Ignore an intent left over from before this mount (e.g. another project).
  const seenIntent = useRef(ctx.terminalIntent?.nonce)
  const layout = LAYOUTS.find((l) => l.size === size)!

  useEffect(() => {
    void api.pty.list(pid).then((list) => {
      setPanes(pid, (s) => {
        // This window's order and titles win for panes still running; panes started elsewhere are appended.
        const kept = s.panes.filter((p) => list.some((i) => i.id === p.info.id))
        const all = [...kept, ...list.filter((i) => !kept.some((p) => p.info.id === i.id)).map((info) => ({ info }))]
        return { panes: all, focused: all.some((p) => p.info.id === s.focused) ? s.focused : (all[0]?.info.id ?? null) }
      })
      setLoaded(true)
    })
    const offData = api.pty.onData((id, data) => {
      const offset = reg.received.get(id) ?? 0
      reg.received.set(id, offset + data.length)
      if (Date.now() - (reg.typed.get(id) ?? 0) > ECHO_MS) reg.output.set(id, Date.now())
      const live = reg.terms.get(id)
      if (live) show(reg, id, live, offset, data)
    })
    const offExit = api.pty.onExit((id, code) => {
      reg.terms.get(id)?.term.write(`\r\n\x1b[2m[${t('process exited with code {code}', { code })}]\x1b[0m\r\n`)
      setPanes(pid, (s) => (s.panes.some((p) => p.info.id === id) ? { panes: s.panes.map((p) => (p.info.id === id ? { ...p, exitCode: code, busy: false } : p)) } : null))
    })
    const timer = setInterval(
      () =>
        setPanes(pid, (s) => {
          let changed = false
          const next = s.panes.map((p) => {
            const busy = p.exitCode === undefined && Date.now() - (reg.output.get(p.info.id) ?? 0) < BUSY_MS
            if (!!p.busy === busy) return p
            changed = true
            return { ...p, busy }
          })
          return changed ? { panes: next } : null
        }),
      500
    )
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
      clearInterval(timer)
      mo.disconnect()
      mq.removeEventListener('change', retheme)
    }
  }, [pid, reg])

  /** Starts a pane, or restarts `replace` in its place with new launch settings. */
  const launch = async (l: Launch, replace?: Pane): Promise<PtyInfo | null> => {
    const cur = replace && reg.terms.get(replace.info.id)?.term
    const dims = cur ? { cols: cur.cols, rows: cur.rows } : estimateSize(gridRef.current, layout.cols, layout.size / layout.cols)
    if (replace) void api.pty.kill(replace.info.id)
    try {
      const info = await api.pty.create(pid, { ...dims, ...l })
      reg.fresh.add(info.id)
      setPanes(pid, (s) => ({
        panes: replace ? s.panes.map((p) => (p.info.id === replace.info.id ? { info } : p)) : [...s.panes, { info }],
        focused: info.id,
        tick: s.tick + 1
      }))
      return info
    } catch (e) {
      alert(errorText(e))
      return null
    }
  }

  const apply = (p: Pane, l: Launch) => {
    if (l.engine === p.info.engine && l.model === p.info.model && l.effort === p.info.effort) {
      const title = l.title ?? p.info.title
      setPanes(pid, (s) => ({ panes: s.panes.map((x) => (x.info.id === p.info.id ? { ...x, info: { ...x.info, title } } : x)) }))
    } else void launch(l, p)
  }

  const restart = (p: Pane) => {
    if (p.exitCode === undefined && !confirm(t('Restart "{title}"? Whatever runs in it is stopped.', { title: p.info.title }))) return
    void launch(launchOf(p), p)
  }

  const close = (p: Pane) => {
    if (p.busy && !confirm(t('"{title}" is still working. Close it anyway?', { title: p.info.title }))) return
    void api.pty.kill(p.info.id)
    setPanes(pid, (s) => {
      const i = s.panes.findIndex((x) => x.info.id === p.info.id)
      const rest = s.panes.filter((x) => x.info.id !== p.info.id)
      return { panes: rest, focused: s.focused === p.info.id ? (rest[Math.min(i, rest.length - 1)]?.info.id ?? null) : s.focused }
    })
  }

  useEffect(() => {
    const intent = ctx.terminalIntent
    if (!intent || !loaded || intent.nonce === seenIntent.current) return
    seenIntent.current = intent.nonce
    void (async () => {
      const s = getPanes(pid)
      const alive = s.panes.filter((p) => p.exitCode === undefined)
      const cur = alive.find((p) => p.info.id === s.focused) ?? alive[0]
      if (cur) focusPane(pid, cur.info.id)
      const id = cur?.info.id ?? (await launch({}))?.id
      if (id) pasteWhenReady(reg, id, intent.text)
    })()
  }, [ctx.terminalIntent, loaded])

  const pickLayout = (n: number) => {
    setSize(n)
    try {
      localStorage.setItem(LAYOUT_KEY, String(n))
    } catch {
      // storage unavailable: the layout lasts this session
    }
  }

  const runnable = ctx.engines.filter((e) => e.installed && e.enabled)
  const defaultLaunch: Launch = { engine: (runnable.find((e) => e.id === ctx.settings.defaultEngine) ?? runnable[0])?.id }
  const newEngine = (className: string, label: ReactNode, align?: 'left' | 'right' | 'center') => (
    <PopButton className={className} label={label} title={runnable.length ? t('New engine pane') : t('No engine CLI found')} disabled={!runnable.length} align={align}>
      {(close) => (
        <>
          <div className="micro tm-pop-title">{t('New engine pane')}</div>
          <PaneForm initial={defaultLaunch} submit={t('Start')} onSubmit={(l) => (close(), void launch(l))} />
        </>
      )}
    </PopButton>
  )

  const page = Math.max(0, Math.floor(panes.findIndex((p) => p.info.id === focused) / size))
  const onPage = (i: number) => Math.floor(i / size) === page
  // One "new pane" cell after the last pane when the page has room; more would just repeat it.
  const slot = panes.length > 0 && panes.filter((_, i) => onPage(i)).length < size

  return (
    <div className="tm">
      <div className="tm-head">
        {panes.length > size ? (
          <div className="tm-tabs" role="group" aria-label={t('Panes')}>
            {panes.map((p, i) => (
              <button
                key={p.info.id}
                className={`tm-tab${onPage(i) ? ' on-page' : ''}`}
                aria-pressed={p.info.id === focused}
                onClick={() => focusPane(pid, p.info.id)}
              >
                <EngineIcon engine={p.info.engine} size={12} />
                <span className="tm-tab-name">{p.info.title}</span>
                <span className={`dot ${p.exitCode !== undefined ? 'off' : p.busy ? 'busy' : 'on'}`} aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
        <span className="grow" />
        <button className="btn ghost small" onClick={() => void launch({})}>
          <SquareTerminal size={14} />
          {t('New shell')}
        </button>
        {newEngine(
          'btn ghost small',
          <>
            <Plus size={14} />
            {t('New engine pane')}
          </>,
          'right'
        )}
        <div className="seg tm-layout" role="group" aria-label={t('Layout')}>
          {LAYOUTS.map(({ size: n, label, icon: Icon }) => (
            <button key={n} aria-pressed={size === n} title={t(label)} aria-label={t(label)} onClick={() => pickLayout(n)}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
      <div
        className="tm-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${size / layout.cols}, minmax(0, 1fr))` }}
      >
        {panes.map((p, i) => (
          <PaneCard
            key={p.info.id}
            pane={p}
            onPage={onPage(i)}
            active={active}
            focused={p.info.id === focused}
            tick={tick}
            reg={reg}
            onFocus={() => focused !== p.info.id && setPanes(pid, () => ({ focused: p.info.id }))}
            onApply={(l) => apply(p, l)}
            onRestart={() => restart(p)}
            onClose={() => close(p)}
          />
        ))}
        {slot ? (
          <div className="tm-slot">
            <button className="btn small" onClick={() => void launch({})}>
              <SquareTerminal size={14} />
              {t('New shell')}
            </button>
            {newEngine(
              'btn small',
              <>
                <Plus size={14} />
                {t('New engine pane')}
              </>,
              'center'
            )}
          </div>
        ) : null}
        {loaded && !panes.length ? (
          <div className="tm-empty">
            <div className="micro">{t('Terminal Mode')}</div>
            <p className="muted">{t('Real terminals in {name}: a plain shell, or an engine CLI signed in to its own account.', { name: ctx.project.name })}</p>
            <div className="tm-big-row">
              <button className="tm-big" onClick={() => void launch({})}>
                <span className="engine-ico">
                  <SquareTerminal size={17} aria-hidden />
                </span>
                <span className="tm-big-title">{t('New shell')}</span>
                <span className="faint small">{t('Your login shell in the project folder')}</span>
              </button>
              {newEngine(
                'tm-big',
                <>
                  <span className="engine-ico">
                    <EngineIcon engine={defaultLaunch.engine ?? 'claude'} size={17} />
                  </span>
                  <span className="tm-big-title">{t('New engine pane')}</span>
                  <span className="faint small">{runnable.length ? runnable.map((e) => e.label).join(' · ') : t('No engine CLI found')}</span>
                </>,
                'center'
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

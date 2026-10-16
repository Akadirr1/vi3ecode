import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../../api'
import { useApp } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { t } from '../../i18n'
import { PaneForm, PopButton, type Launch } from './PaneForm'
import type { Pane } from './store'
import { fitPane, restore, xtermTheme, type Live, type Registry } from './xterm'

/** One grid cell: header with status, model and effort chips and controls, xterm below. */
export function PaneCard(props: {
  pane: Pane
  /** On the grid's current page. */
  onPage: boolean
  /** The terminal surface is on screen (mode and tool). */
  active: boolean
  focused: boolean
  tick: number
  reg: Registry
  onFocus(): void
  onApply(l: Launch): void
  onRestart(): void
  onClose(): void
}) {
  const { engines } = useApp()
  const { info, exitCode, busy } = props.pane
  const engine = engines.find((e) => e.id === info.engine)
  const [label, tone] = exitCode !== undefined ? ['Exited', exitCode ? 'danger' : ''] : busy ? ['Busy', 'brand'] : ['Ready', 'tm-ready']
  return (
    <section className={`tm-pane${props.focused ? ' focused' : ''}`} hidden={!props.onPage} aria-label={info.title} onFocus={props.onFocus}>
      <header className="tm-pane-head">
        <EngineIcon engine={info.engine} size={15} />
        <span className="tm-pane-name" title={info.title}>
          {info.title}
        </span>
        <span className={`badge ${tone}`} title={exitCode !== undefined ? t('Exit code {code}', { code: exitCode }) : undefined}>
          {t(label)}
        </span>
        {info.engine ? <span className="badge tm-chip">{info.model?.replace(/^claude-/, '') ?? t('Default')}</span> : null}
        {info.engine && (info.effort || engine?.efforts.length) ? <span className="badge tm-chip">{info.effort ?? t('Default')}</span> : null}
        <span className="grow" />
        <PopButton className="iconbtn tm-hbtn" title={t('Pane settings')} label={<SlidersHorizontal size={14} />} align="right">
          {(close) => (
            <>
              <div className="micro tm-pop-title">{t('Pane settings')}</div>
              <PaneForm
                initial={{ engine: info.engine, model: info.model, effort: info.effort, title: info.title }}
                allowShell
                submit={t('Apply')}
                note={t('A new provider, model or effort restarts the pane.')}
                onSubmit={(l) => (close(), props.onApply(l))}
              />
            </>
          )}
        </PopButton>
        <button className="iconbtn tm-hbtn" title={t('Restart pane')} aria-label={t('Restart pane')} onClick={props.onRestart}>
          <RotateCcw size={14} />
        </button>
        <button className="iconbtn tm-hbtn" title={t('Close pane')} aria-label={t('Close pane')} onClick={props.onClose}>
          <X size={14} />
        </button>
      </header>
      <PaneHost id={info.id} shown={props.onPage && props.active} focused={props.focused} tick={props.tick} reg={props.reg} />
    </section>
  )
}

function PaneHost({ id, shown, focused, tick, reg }: { id: string; shown: boolean; focused: boolean; tick: number; reg: Registry }) {
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
    void restore(reg, id, live, () => disposed)
    const input = term.onData((data) => {
      reg.typed.set(id, Date.now())
      api.pty.write(id, data)
    })
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
    const live = reg.terms.get(id)
    if (!shown || !live) return
    fitPane(id, ref.current!, live)
    // Only on show and explicit focus requests (tick): tabbing to a header button must not bounce into xterm.
    if (focused) live.term.focus()
  }, [shown, tick, id, reg])

  return (
    <div className="tm-pane-body">
      <div ref={ref} className="term-host" />
    </div>
  )
}

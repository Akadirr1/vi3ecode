import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EngineId } from '../../../../shared/types'
import { useApp } from '../../context'
import { t } from '../../i18n'

/** What a pane runs: a plain shell (no engine) or an engine CLI with optional model and effort. */
export interface Launch {
  engine?: EngineId
  model?: string
  effort?: string
  title?: string
}

/** A trigger button and the panel it opens; outside click and Escape close it. */
export function PopButton(props: {
  label: ReactNode
  className: string
  title?: string
  disabled?: boolean
  align?: 'left' | 'right' | 'center'
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      btn.current?.focus()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])
  return (
    <span className="tm-popwrap" ref={wrap}>
      <button
        ref={btn}
        className={`${props.className}${open ? ' active' : ''}`}
        title={props.title}
        aria-label={props.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
      >
        {props.label}
      </button>
      {open ? (
        <div className={`tm-pop ${props.align ?? 'left'}`} role="dialog" aria-label={props.title}>
          {props.children(() => setOpen(false))}
        </div>
      ) : null}
    </span>
  )
}

/** Name, provider, model and effort of a pane; `allowShell` offers the plain shell as a provider. */
export function PaneForm({ initial, allowShell, submit, note, onSubmit }: { initial: Launch; allowShell?: boolean; submit: string; note?: string; onSubmit(l: Launch): void }) {
  const { engines } = useApp()
  const runnable = engines.filter((e) => e.installed && e.enabled)
  const [l, setL] = useState<Launch>(initial)
  const info = runnable.find((e) => e.id === l.engine)
  return (
    <form
      className="tm-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ engine: info?.id, model: info && l.model?.trim() ? l.model.trim() : undefined, effort: info ? l.effort || undefined : undefined, title: l.title?.trim() || undefined })
      }}
    >
      <label className="field">
        <span className="micro">{t('Name')}</span>
        <input className="input" value={l.title ?? ''} placeholder={info?.label ?? t('Shell')} maxLength={40} onChange={(e) => setL({ ...l, title: e.target.value })} autoFocus />
      </label>
      <label className="field">
        <span className="micro">{t('Provider')}</span>
        <select
          className="select"
          value={info?.id ?? ''}
          // A name that was just the old provider's label follows the new provider.
          onChange={(e) => setL({ title: l.title === info?.label ? '' : l.title, engine: (e.target.value || undefined) as EngineId | undefined })}
        >
          {allowShell ? <option value="">{t('Shell')}</option> : null}
          {runnable.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      {info ? (
        <div className="tm-form-row">
          <label className="field grow">
            <span className="micro">{t('Model')}</span>
            <input className="input mono" list={`tm-models-${info.id}`} value={l.model ?? ''} placeholder={t('Default')} onChange={(e) => setL({ ...l, model: e.target.value })} />
            <datalist id={`tm-models-${info.id}`}>
              {info.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {info.efforts.length ? (
            <label className="field">
              <span className="micro">{t('Effort')}</span>
              <select className="select" value={l.effort ?? ''} onChange={(e) => setL({ ...l, effort: e.target.value })}>
                <option value="">{t('Default')}</option>
                {info.efforts.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="row">
        <span className="faint small grow">{note}</span>
        <button className="btn primary small" type="submit" disabled={!allowShell && !info}>
          {submit}
        </button>
      </div>
    </form>
  )
}

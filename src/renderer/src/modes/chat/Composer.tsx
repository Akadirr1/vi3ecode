import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowUp, Check, ChevronDown, ChevronRight, Lock, Paperclip, Plus, Shield, ShieldAlert, ShieldCheck, Square } from 'lucide-react'
import type { ApprovalMode, EngineId, FileEntry } from '../../../../shared/types'
import { api } from '../../api'
import { useApp, usableEngines } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { APPROVAL_LABEL } from '../../components/format'
import { t } from '../../i18n'

/** What the composer controls; '' model/effort means the engine's default. */
export interface ChatConfig {
  engine: EngineId
  model: string
  effort: string
  approval: ApprovalMode
  autoApprove: boolean
}

const APPROVALS: [ApprovalMode, typeof Shield][] = [
  ['ask', Shield],
  ['edits', ShieldCheck],
  ['full', ShieldAlert],
  ['read-only', Lock]
]

const ACK_KEY = 'vi3ecode.autoApproveAck'

export function Composer(p: {
  cfg: ChatConfig
  setCfg(patch: Partial<ChatConfig>): void
  draft: string
  setDraft(text: string): void
  placeholder: string
  busy: boolean
  onSend(): void
  onStop(): void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [confirming, setConfirming] = useState(false)
  const insert = (text: string) => {
    p.setDraft(p.draft && !/\s$/.test(p.draft) ? `${p.draft} ${text}` : p.draft + text)
    p.inputRef.current?.focus()
  }
  const toggleAuto = () => {
    let acked = false
    try {
      acked = localStorage.getItem(ACK_KEY) === '1'
    } catch {
      // storage unavailable: ask every time
    }
    if (p.cfg.autoApprove || acked) p.setCfg({ autoApprove: !p.cfg.autoApprove })
    else setConfirming(true)
  }
  const stopMode = p.busy && !p.draft.trim()
  return (
    <div className="cm-composer">
      <textarea
        ref={p.inputRef}
        aria-label={t('Message')}
        placeholder={p.placeholder}
        value={p.draft}
        onChange={(e) => p.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            p.onSend()
          } else if (e.key === 'Escape' && p.busy) p.onStop()
        }}
      />
      <div className="cm-bar">
        <PlusMenu onInsert={insert} />
        <button className="switch" aria-pressed={p.cfg.autoApprove} onClick={toggleAuto} title={t('Answer every approval request with allow')}>
          {t('Auto-approve')}
        </button>
        <ApprovalMenu value={p.cfg.approval} onChange={(approval) => p.setCfg({ approval })} />
        <span className="grow" />
        <EnginePicker cfg={p.cfg} setCfg={p.setCfg} />
        <button
          className={`cm-send${stopMode ? ' stop' : ''}`}
          onClick={stopMode ? p.onStop : p.onSend}
          disabled={!stopMode && !p.draft.trim()}
          aria-label={stopMode ? t('Stop') : p.busy ? (p.cfg.engine === 'claude' ? t('Send to running turn') : t('Add to queue')) : t('Send')}
          title={stopMode ? t('Stop (Esc)') : undefined}
        >
          {stopMode ? <Square size={12} fill="currentColor" /> : <ArrowUp size={17} />}
        </button>
      </div>
      {confirming ? (
        <AutoApproveWarning
          onCancel={() => setConfirming(false)}
          onAccept={() => {
            try {
              localStorage.setItem(ACK_KEY, '1')
            } catch {
              // not remembered: the warning shows again next time
            }
            setConfirming(false)
            p.setCfg({ autoApprove: true })
          }}
        />
      ) : null}
    </div>
  )
}

/** Open state that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      ref.current?.querySelector<HTMLElement>('button')?.focus()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])
  return { open, setOpen, ref }
}

function PlusMenu({ onInsert }: { onInsert(text: string): void }) {
  const { project } = useApp()
  const pop = usePopover()
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  useEffect(() => {
    if (pop.open) void api.files.list(project.id, dir).then(setFiles, () => setFiles([]))
  }, [pop.open, dir, project.id])
  const attach = () => {
    const rel = path.trim().replace(/^\.?\/+/, '')
    if (!rel) return
    onInsert(`@${rel} `)
    setPath('')
    pop.setOpen(false)
  }
  return (
    <div className="cm-pop-wrap" ref={pop.ref}>
      <button className="iconbtn cm-plus" onClick={() => pop.setOpen(!pop.open)} aria-label={t('Add')} aria-expanded={pop.open} title={t('Add')}>
        <Plus size={17} />
      </button>
      {pop.open ? (
        <div className="cm-pop cm-plus-pop" role="dialog" aria-label={t('Add')}>
          <div className="cm-pop-title micro">{t('Add')}</div>
          <label className="cm-attach">
            <Paperclip size={14} aria-hidden />
            <input
              className="input"
              autoFocus
              list="cm-files"
              aria-label={t('Attach file path…')}
              placeholder={t('Attach file path…')}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), attach())}
            />
          </label>
          <datalist id="cm-files">
            {files.map((f) => (
              <option key={f.path} value={f.dir ? `${f.path}/` : f.path} />
            ))}
          </datalist>
          <div className="cm-opt-hint">{t('Inserts @path into the message; the engine reads the file itself.')}</div>
        </div>
      ) : null}
    </div>
  )
}

function ApprovalMenu({ value, onChange }: { value: ApprovalMode; onChange(m: ApprovalMode): void }) {
  const pop = usePopover()
  const Icon = APPROVALS.find(([m]) => m === value)?.[1] ?? Shield
  return (
    <div className="cm-pop-wrap" ref={pop.ref}>
      <button className="cm-pill" onClick={() => pop.setOpen(!pop.open)} aria-haspopup="menu" aria-expanded={pop.open} aria-label={t('Approval: {mode}', { mode: t(APPROVAL_LABEL[value].label) })}>
        <Icon size={15} aria-hidden />
        {t(APPROVAL_LABEL[value].label)}
        <ChevronDown size={14} aria-hidden />
      </button>
      {pop.open ? (
        <div className="cm-pop cm-approvals" role="menu" aria-label={t('How should vi3ecode actions be approved?')}>
          <div className="cm-pop-title micro">{t('How should vi3ecode actions be approved?')}</div>
          {APPROVALS.map(([m, MIcon]) => (
            <button
              key={m}
              role="menuitemradio"
              aria-checked={m === value}
              className="cm-opt"
              autoFocus={m === value}
              onClick={() => (onChange(m), pop.setOpen(false))}
            >
              <MIcon size={15} aria-hidden />
              <span className="grow">
                <span className="cm-opt-label">{t(APPROVAL_LABEL[m].label)}</span>
                <span className="cm-opt-hint">{t(APPROVAL_LABEL[m].hint)}</span>
              </span>
              {m === value ? <Check size={15} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Provider / Model / Effort rows, each opening its list to the side. */
function EnginePicker({ cfg, setCfg }: { cfg: ChatConfig; setCfg(patch: Partial<ChatConfig>): void }) {
  const ctx = useApp()
  const pop = usePopover()
  const [sub, setSub] = useState<'engine' | 'model' | 'effort' | null>(null)
  const engine = ctx.engines.find((e) => e.id === cfg.engine)
  const usable = usableEngines(ctx)
  const pick = (patch: Partial<ChatConfig>) => {
    setCfg(patch)
    setSub(null)
    pop.setOpen(false)
  }
  const row = (id: typeof sub, label: string, value: string, icon?: ReactNode) => (
    <button className={`cm-opt cm-row${sub === id ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={sub === id} onClick={() => setSub(sub === id ? null : id)}>
      <span className="cm-row-ico">{icon}</span>
      <span className="grow cm-opt-label">{label}</span>
      <span className="cm-row-value">{value}</span>
      <ChevronRight size={14} aria-hidden />
    </button>
  )
  const option = (key: string, label: ReactNode, selected: boolean, onPick: () => void, hint?: string, disabled?: boolean) => (
    <button key={key} role="menuitemradio" aria-checked={selected} className="cm-opt" disabled={disabled} title={hint} onClick={onPick}>
      <span className="grow">
        <span className="cm-opt-label">{label}</span>
        {hint ? <span className="cm-opt-hint">{hint}</span> : null}
      </span>
      {selected ? <Check size={14} aria-hidden /> : null}
    </button>
  )
  return (
    <div className="cm-pop-wrap" ref={pop.ref}>
      <button className="cm-pill cm-engine-btn" onClick={() => (pop.setOpen(!pop.open), setSub(null))} aria-haspopup="menu" aria-expanded={pop.open} aria-label={t('Engine and model')}>
        <EngineIcon engine={cfg.engine} size={15} />
        <b>{engine?.label ?? cfg.engine}</b>
        <span className="cm-engine-meta">
          · {cfg.model || t('Default')}
          {cfg.effort ? ` · ${cfg.effort}` : ''}
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {pop.open ? (
        <div className="cm-pop cm-engine-pop" role="menu" aria-label={t('Engine and model')}>
          {row('engine', t('Provider'), engine?.label ?? cfg.engine, <EngineIcon engine={cfg.engine} size={14} />)}
          {row('model', t('Model'), cfg.model || t('Default'))}
          {engine?.efforts.length ? row('effort', t('Effort'), cfg.effort || t('Default')) : null}
          {sub ? (
            <div className="cm-pop cm-sub" role="menu">
              {sub === 'engine' &&
                ctx.engines
                  .filter((e) => e.enabled)
                  .map((e) => {
                    const ok = usable.includes(e)
                    return option(
                      e.id,
                      <span className="row">
                        <EngineIcon engine={e.id} size={14} />
                        {e.label}
                      </span>,
                      e.id === cfg.engine,
                      () => pick({ engine: e.id, model: '', effort: '' }),
                      ok ? undefined : e.installed ? t('Terminal Mode only') : e.installHint,
                      !ok
                    )
                  })}
              {sub === 'model' && (
                <>
                  {['', ...(engine?.models ?? [])].map((m) => option(m || 'default', m ? <span className="mono">{m}</span> : t('Default'), m === cfg.model, () => pick({ model: m })))}
                  <input
                    className="input cm-custom"
                    placeholder={t('Other model id…')}
                    aria-label={t('Other model id')}
                    onKeyDown={(e) => {
                      const v = e.currentTarget.value.trim()
                      if (e.key === 'Enter' && v) pick({ model: v })
                    }}
                  />
                </>
              )}
              {sub === 'effort' && ['', ...(engine?.efforts ?? [])].map((x) => option(x || 'default', x || t('Default'), x === cfg.effort, () => pick({ effort: x })))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AutoApproveWarning({ onCancel, onAccept }: { onCancel(): void; onAccept(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="modal narrow cm-warn" role="alertdialog" aria-modal="true" aria-labelledby="cm-warn-title">
        <h3 id="cm-warn-title">
          <ShieldAlert size={18} aria-hidden />
          {t('Auto-approve allows every request')}
        </h3>
        <p>{t('While this is on, every action the engine asks permission for runs without an approval card.')}</p>
        <p className="faint small">{t('Turn it off to get approval cards again from the next request. Read-only chats stay read-only.')}</p>
        <div className="row cm-warn-actions">
          <button className="btn" autoFocus onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={onAccept}>
            {t('I understand, turn on')}
          </button>
        </div>
      </div>
    </div>
  )
}

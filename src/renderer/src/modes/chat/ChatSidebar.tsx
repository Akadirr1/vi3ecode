import { useEffect, useState } from 'react'
import { Ellipsis, Loader2, PencilLine, Pin, PinOff, Trash2 } from 'lucide-react'
import type { ChatSession, ChatSummary } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { relativeTime } from '../../components/format'
import { t } from '../../i18n'
import { errorText } from '../../components/format'
import { usePopover } from './Composer'
import './chat-mode.css'

// shortcut: ChatSummary has no model yet, so it only shows once a session push arrives; add `model` to chat.list to fix.
type Row = ChatSummary & { model?: string }

const toRow = (s: ChatSession): Row => ({
  id: s.id,
  title: s.title,
  engine: s.engine,
  model: s.model,
  updatedAt: s.updatedAt,
  running: s.messages.some((m) => m.status === 'running'),
  pinned: s.pinned
})

/** This project's chats as cards: pinned first, then most recently updated. */
export function ChatSidebar() {
  const { project, engines, chatId, setChatId, openTool } = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [, tick] = useState(0)
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; r: Row } | null>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000) // keeps "5m" fresh
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    // Pushed sessions are newer than the list, so they win when both arrive.
    void api.chat.list(project.id).then((list) => setRows((cur) => [...cur, ...list.filter((l) => !cur.some((c) => c.id === l.id))]))
    return api.chat.onSession((s) => {
      if (s.projectId === project.id) setRows((cur) => [toRow(s), ...cur.filter((r) => r.id !== s.id)])
    })
  }, [project.id])

  const update = (r: Row, patch: { title?: string; pinned?: boolean }) => void api.chat.update(r.id, patch).catch((e) => alert(errorText(e)))
  const remove = async (r: Row) => {
    try {
      await api.chat.remove(r.id)
      setRows((cur) => cur.filter((x) => x.id !== r.id))
      if (chatId === r.id) setChatId(null)
    } catch (e) {
      alert(errorText(e))
    }
  }
  const submit = () => {
    if (!dialog) return
    if (dialog.kind === 'delete') void remove(dialog.r)
    else if (title.trim() !== dialog.r.title) update(dialog.r, { title })
    setDialog(null)
  }

  if (!rows.length) return null
  return (
    <>
      <div className="side-label micro">{t('Recents')}</div>
      <div className="cs-list">
        {[...rows]
          .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
          .map((r) => (
            <div key={r.id} className="cs-row">
              <button
                className={`scard${chatId === r.id ? ' active' : ''}`}
                aria-current={chatId === r.id ? 'true' : undefined}
                onClick={() => (openTool(null), setChatId(r.id))}
              >
                <span className="engine-ico">
                  <EngineIcon engine={r.engine} size={15} />
                </span>
                <span className="cs-text">
                  <span className="cs-title-row">
                    <span className="scard-title">{r.title}</span>
                    {r.pinned ? <Pin size={12} className="cs-pin" aria-label={t('Pinned')} /> : null}
                  </span>
                  <span className="scard-sub">{r.model || engines.find((e) => e.id === r.engine)?.label || r.engine}</span>
                </span>
                <span className="scard-time">
                  {r.running ? <Loader2 size={12} className="cm-spin" aria-label={t('working')} /> : relativeTime(r.updatedAt)}
                </span>
              </button>
              <ThreadMenu
                pinned={!!r.pinned}
                onRename={() => (setTitle(r.title), setDialog({ kind: 'rename', r }))}
                onPin={() => update(r, { pinned: !r.pinned })}
                onDelete={() => setDialog({ kind: 'delete', r })}
              />
            </div>
          ))}
      </div>
      {dialog ? (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)} onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}>
          <form
            className="modal narrow cm-warn"
            role={dialog.kind === 'delete' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="cs-dialog-title"
            onSubmit={(e) => (e.preventDefault(), submit())}
          >
            <h3 id="cs-dialog-title">{t(dialog.kind === 'delete' ? 'Delete thread?' : 'Rename thread')}</h3>
            <p>
              {dialog.kind === 'delete'
                ? t('“{name}” will be permanently deleted. This can’t be undone.', { name: dialog.r.title })
                : t('Choose a short display title. The original thread brief will stay unchanged.')}
            </p>
            {dialog.kind === 'rename' ? (
              <label className="cs-field">
                <span>{t('Thread title')}</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} placeholder={t('Thread title')} maxLength={120} autoFocus />
              </label>
            ) : null}
            <div className="row cm-warn-actions">
              <button type="button" className="btn" autoFocus={dialog.kind === 'delete'} onClick={() => setDialog(null)}>
                {t('Cancel')}
              </button>
              {dialog.kind === 'delete' ? (
                <button type="submit" className="btn danger">
                  {t('Delete')}
                </button>
              ) : (
                <button type="submit" className="btn primary" disabled={!title.trim()}>
                  {t('Save')}
                </button>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}

/** ⋯ on the card: Rename, Pin / Unpin, Delete. */
function ThreadMenu(p: { pinned: boolean; onRename(): void; onPin(): void; onDelete(): void }) {
  const pop = usePopover()
  const item = (Icon: typeof Pin, label: string, run: () => void, cls = '') => (
    <button role="menuitem" className={`cm-opt cs-item${cls}`} onClick={() => (pop.setOpen(false), run())}>
      <Icon size={15} aria-hidden />
      {t(label)}
    </button>
  )
  return (
    <div className={`cm-pop-wrap cs-more${pop.open ? ' open' : ''}`} ref={pop.ref}>
      <button className="iconbtn" onClick={() => pop.setOpen(!pop.open)} aria-haspopup="menu" aria-expanded={pop.open} aria-label={t('Thread options')} title={t('Thread options')}>
        <Ellipsis size={14} />
      </button>
      {pop.open ? (
        <div className="cm-pop cs-menu" role="menu" aria-label={t('Thread options')}>
          {item(PencilLine, 'Rename', p.onRename)}
          {p.pinned ? item(PinOff, 'Unpin', p.onPin) : item(Pin, 'Pin', p.onPin)}
          <div className="cm-sep" role="separator" />
          {item(Trash2, 'Delete', p.onDelete, ' danger')}
        </div>
      ) : null}
    </div>
  )
}

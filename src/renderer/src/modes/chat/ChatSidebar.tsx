import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { ChatSession, ChatSummary } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { relativeTime } from '../../components/format'
import { t } from '../../i18n'
import { errorText } from '../../components/format'
import './chat-mode.css'

// shortcut: ChatSummary has no model yet, so it only shows once a session push arrives; add `model` to chat.list to fix.
type Row = ChatSummary & { model?: string }

const toRow = (s: ChatSession): Row => ({
  id: s.id,
  title: s.title,
  engine: s.engine,
  model: s.model,
  updatedAt: s.updatedAt,
  running: s.messages.some((m) => m.status === 'running')
})

/** This project's chats as cards, most recently updated first. */
export function ChatSidebar() {
  const { project, engines, chatId, setChatId, openTool } = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [, tick] = useState(0)

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

  const remove = async (r: Row) => {
    if (!confirm(t('Delete "{title}"? This cannot be undone.', { title: r.title }))) return
    try {
      await api.chat.remove(r.id)
      setRows((cur) => cur.filter((x) => x.id !== r.id))
      if (chatId === r.id) setChatId(null)
    } catch (e) {
      alert(errorText(e))
    }
  }

  if (!rows.length) return null
  return (
    <>
      <div className="side-label micro">{t('Recents')}</div>
      <div className="cs-list">
        {rows.map((r) => (
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
                <span className="scard-title">{r.title}</span>
                <span className="scard-sub">{r.model || engines.find((e) => e.id === r.engine)?.label || r.engine}</span>
              </span>
              <span className="scard-time">
                {r.running ? <Loader2 size={12} className="cm-spin" aria-label={t('working')} /> : relativeTime(r.updatedAt)}
              </span>
            </button>
            <button className="iconbtn cs-del" onClick={() => void remove(r)} aria-label={t('Delete chat {title}', { title: r.title })} title={t('Delete')}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

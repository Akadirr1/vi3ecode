import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApprovalMode, ChatMessage, ChatSession, ChatSummary, EngineId } from '../../../shared/types'
import { api } from '../api'
import { useApp, usableEngines } from '../context'
import { Prose } from '../components/Prose'
import './chat.css'

export const APPROVAL_HELP: Record<ApprovalMode, string> = {
  'read-only': 'Read-only: the engine may read files but not change anything.',
  supervised: 'Supervised: edits inside the project only; risky commands are refused.',
  auto: 'Auto: edits and commands run without asking.'
}

// Intents outlive this view (App never clears them), so remember which one was handled across remounts.
let handledIntent = 0

export function ChatView() {
  const ctx = useApp()
  const { project, settings, engines } = ctx
  const usable = usableEngines(ctx)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [session, setSession] = useState<ChatSession | null>(null)
  const [draft, setDraft] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const fail = (e: unknown) => setError(errorText(e))
  const open = (id: string) => {
    stick.current = true
    setEditingTitle(false)
    void api.chat.get(id).then(setSession, fail)
  }

  useEffect(() => {
    // Merges rather than replaces: a chat created by an intent may land before the list does.
    void api.chat
      .list(project.id)
      .then(async (list) => {
        setChats((cur) => [...cur.filter((c) => !list.some((l) => l.id === c.id)), ...list])
        const first = list[0] && (await api.chat.get(list[0].id))
        if (first) setSession((cur) => cur ?? first)
      })
      .catch(fail)
    return api.chat.onSession((s) => {
      if (s.projectId !== project.id) return
      setSession((cur) => (cur?.id === s.id ? s : cur))
      // The session that just changed is the most recently updated one.
      setChats((list) => [summarize(s), ...list.filter((c) => c.id !== s.id)])
    })
  }, [project.id])

  const create = async (text = '') => {
    try {
      const engine = usable.some((e) => e.id === settings.defaultEngine) ? settings.defaultEngine : usable[0]?.id
      const s = await api.chat.create(project.id, engine)
      setChats((list) => [summarize(s), ...list])
      stick.current = true
      setSession(s)
      setDraft(text)
      setEditingTitle(false)
    } catch (e) {
      fail(e)
    }
  }

  useEffect(() => {
    const intent = ctx.chatIntent
    if (!intent || intent.nonce === handledIntent) return
    handledIntent = intent.nonce
    void create(intent.text)
  }, [ctx.chatIntent?.nonce])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [session])

  const remove = async (c: ChatSummary) => {
    if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return
    try {
      await api.chat.remove(c.id)
      setChats((list) => list.filter((x) => x.id !== c.id))
      if (session?.id === c.id) setSession(null)
    } catch (e) {
      fail(e)
    }
  }

  const update = (patch: Parameters<typeof api.chat.update>[1]) => {
    if (session) void api.chat.update(session.id, patch).then(setSession, fail)
  }

  const busy = !!session?.messages.some((m) => m.status === 'running')
  const send = async () => {
    const text = draft.trim()
    if (!session || !text) return
    setDraft('')
    stick.current = true
    try {
      await api.chat.send(session.id, text)
    } catch (e) {
      setDraft(text)
      fail(e)
    }
  }

  const engineLabel = (id?: EngineId) => engines.find((e) => e.id === id)?.label ?? id ?? ''

  return (
    <div className="view">
      <div className="split">
        <div className="list-pane chat-list">
          <button className="btn primary" onClick={() => void create()} disabled={!usable.length}>
            + New chat
          </button>
          {chats.map((c) => (
            <div key={c.id} className="chat-row">
              <button
                className={`list-item${session?.id === c.id ? ' active' : ''}`}
                onClick={() => open(c.id)}
                aria-current={session?.id === c.id ? 'true' : undefined}
              >
                <span className="col grow chat-row-text">
                  <span className="chat-row-title">{c.title}</span>
                  <span className="row faint small">
                    <span className="badge">{engineLabel(c.engine)}</span>
                    {c.running ? <span className="dot busy" aria-label="running" /> : null}
                    <span>{ago(c.updatedAt)}</span>
                  </span>
                </span>
              </button>
              <button className="btn ghost small chat-del" onClick={() => void remove(c)} aria-label={`Delete chat ${c.title}`}>
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="detail-pane">
          {error ? (
            <div className="chat-error row" role="alert">
              <span className="grow">{error}</span>
              <button className="btn ghost small" onClick={() => setError('')} aria-label="Dismiss error">
                ×
              </button>
            </div>
          ) : null}

          {!session ? (
            usable.length ? (
              <div className="empty grow">
                <div>{chats.length ? 'Pick a chat on the left.' : 'No chats yet.'}</div>
                <button className="btn primary" onClick={() => void create()}>
                  Start a chat
                </button>
              </div>
            ) : (
              <NoEngine />
            )
          ) : (
            <>
              <div className="view-header chat-head">
                {editingTitle ? (
                  <input
                    className="input chat-title-input"
                    aria-label="Chat title"
                    defaultValue={session.title}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.value = session.title
                      if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                    }}
                    onBlur={(e) => {
                      setEditingTitle(false)
                      const title = e.target.value.trim()
                      if (title && title !== session.title) update({ title })
                    }}
                  />
                ) : (
                  <h2>
                    <button className="chat-title" onClick={() => setEditingTitle(true)} title="Rename">
                      {session.title}
                    </button>
                  </h2>
                )}
                <span className="spacer" />
                <span className="faint small" aria-live="polite">
                  {busy ? 'working…' : ''}
                </span>
                {busy ? (
                  <button className="btn small" onClick={() => void api.chat.stop(session.id).catch(fail)}>
                    Stop
                  </button>
                ) : null}
                <select
                  className="select chat-engine"
                  aria-label="Engine"
                  value={session.engine}
                  onChange={(e) => update({ engine: e.target.value as EngineId })}
                >
                  {usable.some((e) => e.id === session.engine) ? null : (
                    <option value={session.engine}>{engineLabel(session.engine)} (unavailable)</option>
                  )}
                  {usable.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <select
                  className="select chat-approval"
                  aria-label="Approval mode"
                  title={APPROVAL_HELP[session.approval]}
                  value={session.approval}
                  onChange={(e) => update({ approval: e.target.value as ApprovalMode })}
                >
                  {(Object.keys(APPROVAL_HELP) as ApprovalMode[]).map((m) => (
                    <option key={m} value={m} title={APPROVAL_HELP[m]}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  key={session.id}
                  className="input chat-model"
                  aria-label="Model"
                  placeholder="default model"
                  defaultValue={session.model ?? ''}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (session.model ?? '')) update({ model: e.target.value })
                  }}
                />
              </div>

              <div
                className="chat-messages"
                ref={scroller}
                onScroll={(e) => {
                  const el = e.currentTarget
                  stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
                }}
              >
                {session.messages.length ? (
                  session.messages.map((m) => <Message key={m.id} m={m} engineLabel={engineLabel(m.engine)} />)
                ) : (
                  <div className="empty">Ask {engineLabel(session.engine)} anything about {project.name}.</div>
                )}
              </div>

              <div className="composer">
                <textarea
                  className="textarea"
                  aria-label="Message"
                  placeholder={`Message ${engineLabel(session.engine)}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                <div className="row">
                  <button
                    className={`chat-chip${settings.memoryInject ? ' on' : ''}`}
                    aria-pressed={settings.memoryInject}
                    onClick={() => void ctx.setSettings({ memoryInject: !settings.memoryInject })}
                    title="Inject the project memory brief into every turn"
                  >
                    ◈ Memory brief {settings.memoryInject ? 'on' : 'off'}
                  </button>
                  <span className="grow faint small">
                    {busy ? 'Runs after the current turn' : 'Enter to send · Shift+Enter for a new line'}
                  </span>
                  <button className="btn primary" onClick={() => void send()} disabled={!draft.trim()}>
                    {busy ? 'Queue' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Message({ m, engineLabel }: { m: ChatMessage; engineLabel: string }) {
  const status =
    m.status === 'running' ? (
      <span className="badge accent">working…</span>
    ) : m.status === 'queued' ? (
      <span className="badge warn">queued</span>
    ) : m.status === 'stopped' ? (
      <span className="badge">stopped</span>
    ) : m.status === 'error' ? (
      <span className="badge danger">error</span>
    ) : null

  if (m.role === 'user') {
    return (
      <div className="chat-msg user">
        {status ? <div className="row chat-meta">{status}</div> : null}
        <Prose text={m.text} />
      </div>
    )
  }
  return (
    <div className={`chat-msg ${m.role}`}>
      <div className="row chat-meta">
        <span className="chat-engine-label">{m.role === 'system' ? 'System' : engineLabel}</span>
        {status}
        {m.tools?.length ? (
          <details className="chat-tools">
            <summary>
              {m.tools.length} tool call{m.tools.length === 1 ? '' : 's'}
            </summary>
            <ul className="mono">
              {m.tools.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {m.costUsd ? <span className="faint small">{usd(m.costUsd)}</span> : null}
      </div>
      {m.text ? <Prose text={m.text} /> : m.status === 'running' ? <div className="faint">…</div> : null}
    </div>
  )
}

function NoEngine() {
  const ctx = useApp()
  const candidates = ctx.engines.filter((e) => e.headless)
  return (
    <div className="empty grow">
      <div className="muted">No chat-capable engine is installed.</div>
      <div className="small">Install one of these, sign in with it once in a terminal, then re-detect engines:</div>
      <ul className="chat-hints">
        {candidates.map((e) => (
          <li key={e.id}>
            <strong>{e.label}</strong> <code>{e.installHint}</code>
            {!e.enabled ? <span className="faint"> (hidden in Settings)</span> : null}
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="btn" onClick={() => void ctx.refreshEngines()}>
          Re-detect engines
        </button>
        <button className="btn primary" onClick={() => ctx.go('settings')}>
          Open Settings
        </button>
      </div>
    </div>
  )
}

const summarize = (s: ChatSession): ChatSummary => ({
  id: s.id,
  title: s.title,
  engine: s.engine,
  updatedAt: s.updatedAt,
  running: s.messages.some((m) => m.status === 'running')
})

export const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`

export const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

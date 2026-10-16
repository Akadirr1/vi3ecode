import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Clock, FileText, Globe, Pencil, Search, ShieldAlert, SquareTerminal, Wrench, X } from 'lucide-react'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { api } from '../../api'
import { useApp, usableEngines } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { Prose } from '../../components/Prose'
import { formatCost, formatDuration } from '../../components/format'
import { t } from '../../i18n'
import { Composer, type ChatConfig } from './Composer'
import './chat-mode.css'

/** Composer drafts outlive chat and mode switches (this view remounts); keyed by chat id or `new:<project>`. */
const drafts = new Map<string, string>()
// Intents outlive this view (App never clears them), so remember the handled one across remounts.
let handledIntent = 0

export const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function ChatMain() {
  const ctx = useApp()
  const { project, settings, chatId, setChatId } = ctx
  const usable = usableEngines(ctx)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [fresh, setFresh] = useState<Partial<ChatConfig>>({})
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [, redraw] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const newKey = `new:${project.id}`
  const key = chatId ?? newKey
  const draft = drafts.get(key) ?? ''
  const setDraftFor = (k: string, text: string) => {
    drafts.set(k, text)
    redraw((n) => n + 1)
  }
  const fail = (e: unknown) => setError(errorText(e))

  useEffect(() => {
    setSession((cur) => (cur && cur.id === chatId ? cur : null))
    setEditing(false)
    stick.current = true
    input.current?.focus()
    if (!chatId) return
    let live = true
    api.chat.get(chatId).then((s) => {
      if (!live) return
      if (s?.projectId === project.id) setSession(s)
      else setChatId(null) // deleted, or from another project
    }, fail)
    return () => {
      live = false
    }
  }, [chatId, project.id])

  useEffect(() => api.chat.onSession((s) => setSession((cur) => (cur?.id === s.id ? s : cur))), [])

  useEffect(() => {
    const intent = ctx.chatIntent
    if (!intent || intent.nonce === handledIntent) return
    handledIntent = intent.nonce
    if (intent.append) {
      const cur = drafts.get(key) ?? ''
      setDraftFor(key, cur && !/\s$/.test(cur) ? `${cur} ${intent.text}` : cur + intent.text)
    } else {
      setDraftFor(newKey, intent.text)
      setChatId(null)
    }
    requestAnimationFrame(() => input.current?.focus())
  }, [ctx.chatIntent?.nonce])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [session])

  const defaultEngine = usable.find((e) => e.id === settings.defaultEngine)?.id ?? usable[0]?.id ?? settings.defaultEngine
  const cfg: ChatConfig = session
    ? { engine: session.engine, model: session.model ?? '', effort: session.effort ?? '', approval: session.approval, autoApprove: session.autoApprove }
    : { engine: fresh.engine ?? defaultEngine, model: fresh.model ?? '', effort: fresh.effort ?? '', approval: fresh.approval ?? settings.approval, autoApprove: fresh.autoApprove ?? false }
  const setCfg = (patch: Partial<ChatConfig>) => {
    if (session) void api.chat.update(session.id, patch).then(setSession, fail)
    else setFresh((f) => ({ ...f, ...patch }))
  }

  const busy = !!session?.messages.some((m) => m.status === 'running')

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraftFor(key, '')
    stick.current = true
    let id = session?.id
    try {
      if (!id) {
        // The chat exists from the first message on, with what was picked in the composer.
        const created = await api.chat.create(project.id, cfg.engine)
        const s = await api.chat.update(created.id, cfg)
        id = s.id
        setSession(s)
        setChatId(s.id)
      }
      await api.chat.send(id, text)
    } catch (e) {
      setDraftFor(id ?? newKey, text)
      fail(e)
    }
  }

  const stop = () => session && void api.chat.stop(session.id).catch(fail)
  const respond = (approvalId: string, allow: boolean, always?: boolean) => session && void api.chat.respond(session.id, approvalId, allow, always).catch(fail)

  if (!session && !usable.length) return <NoEngine />

  const placeholder = busy
    ? cfg.engine === 'claude'
      ? t('Steer the running turn…')
      : t('Queue a message…')
    : session?.messages.length
      ? t('Ask for follow-up changes')
      : t('Ask anything about this project')

  return (
    <div className="cm">
      <div className="cm-head">
        {editing && session ? (
          <input
            className="input cm-title-input"
            aria-label={t('Chat title')}
            defaultValue={session.title}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.value = session.title
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
            onBlur={(e) => {
              setEditing(false)
              const title = e.target.value.trim()
              if (title && title !== session.title) void api.chat.update(session.id, { title }).then(setSession, fail)
            }}
          />
        ) : (
          <button className="cm-title" onClick={() => setEditing(!!session)} disabled={!session} title={session ? t('Rename') : undefined}>
            {session?.title ?? t('New chat')}
          </button>
        )}
      </div>

      <div
        className="cm-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {session?.messages.length ? (
          <div className="cm-col">
            {session.messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <div className="cm-hello">
            <h1>{t('What should we work on in {project}?', { project: project.name })}</h1>
          </div>
        )}
      </div>

      <div className="cm-bottom">
        {error ? (
          <div className="cm-error" role="alert">
            <span className="grow">{error}</span>
            <button className="iconbtn" onClick={() => setError('')} aria-label={t('Dismiss')}>
              <X size={14} />
            </button>
          </div>
        ) : null}
        {session?.pending.map((p) => (
          <div key={p.id} className="cm-approval" role="group" aria-label={t('Approval request: {tool}', { tool: p.tool })}>
            <ShieldAlert size={16} className="cm-approval-ico" aria-hidden />
            <div className="grow">
              <div className="cm-approval-tool">{p.tool}</div>
              {p.detail ? <div className="cm-approval-detail">{p.detail}</div> : null}
            </div>
            <div className="cm-approval-actions">
              <button className="btn small ghost" onClick={() => respond(p.id, false)}>
                {t('Deny')}
              </button>
              <button className="btn small" onClick={() => respond(p.id, true, true)}>
                {t('Always allow')}
              </button>
              <button className="btn small primary" onClick={() => respond(p.id, true)}>
                {t('Allow')}
              </button>
            </div>
          </div>
        ))}
        <Composer
          cfg={cfg}
          setCfg={setCfg}
          draft={draft}
          setDraft={(text) => setDraftFor(key, text)}
          placeholder={placeholder}
          busy={busy}
          onSend={() => void send()}
          onStop={stop}
          inputRef={input}
        />
      </div>
    </div>
  )
}

const STEP_ICONS: [RegExp, typeof FileText, string][] = [
  [/^(read|view|ls|notebookread)/i, FileText, 'Reading'],
  [/^(grep|glob|search|find|web_?search)/i, Search, 'Searching'],
  [/(edit|write|patch)/i, Pencil, 'Editing'],
  [/^(bash|shell|exec|command|run)/i, SquareTerminal, 'Running'],
  [/^web|fetch/i, Globe, 'Browsing']
]
const stepKind = (name: string) => STEP_ICONS.find(([re]) => re.test(name))

function Message({ m }: { m: ChatMessage }) {
  const { engines } = useApp()
  if (m.role === 'user') {
    const tag =
      m.status === 'steered' ? (
        <span className="badge brand">{t('steered mid-turn')}</span>
      ) : m.status === 'queued' ? (
        <span className="badge warn" title={t('Will auto-send when the current turn finishes')}>
          {t('queued')}
        </span>
      ) : m.status === 'stopped' ? (
        <span className="badge">{t('stopped')}</span>
      ) : null
    return (
      <div className="cm-user">
        <div className="cm-bubble">{m.text}</div>
        {tag}
      </div>
    )
  }
  if (m.role === 'system') return <div className="cm-system">{m.text}</div>

  const running = m.status === 'running'
  const last = m.tools?.at(-1)?.split(' ')[0]
  const verb = last ? (stepKind(last)?.[2] ?? 'Working') : m.text ? 'Responding' : 'Thinking'
  return (
    <div className="cm-reply">
      {m.tools?.length ? <Steps tools={m.tools} /> : null}
      {m.text ? <Prose text={m.text} /> : null}
      {running ? (
        <div className="cm-working" aria-live="polite">
          {t(verb)}…
        </div>
      ) : (
        <div className="cm-foot">
          {m.durationMs ? (
            <span className="row">
              <Clock size={13} aria-hidden />
              {formatDuration(m.durationMs)}
            </span>
          ) : null}
          {typeof m.costUsd === 'number' ? <span>{formatCost(m.costUsd)}</span> : null}
          {m.engine ? (
            <span className="row">
              <EngineIcon engine={m.engine} size={12} />
              {[engines.find((e) => e.id === m.engine)?.label ?? m.engine, m.model].filter(Boolean).join(' · ')}
            </span>
          ) : null}
          {m.status === 'stopped' ? <span className="badge">{t('stopped')}</span> : m.status === 'error' ? <span className="badge danger">{t('error')}</span> : null}
        </div>
      )}
    </div>
  )
}

/** Tool calls of one turn, folded into "N steps". */
function Steps({ tools }: { tools: string[] }) {
  return (
    <details className="cm-steps">
      <summary>
        <SquareTerminal size={14} aria-hidden />
        {tools.length === 1 ? t('1 step') : t('{n} steps', { n: tools.length })}
        <ChevronRight size={14} className="cm-chev" aria-hidden />
      </summary>
      <ul>
        {tools.map((x, i) => {
          const [name, ...rest] = x.split(' ')
          const Icon = stepKind(name)?.[1] ?? Wrench
          return (
            <li key={i}>
              <Icon size={13} aria-hidden />
              <b>{name}</b>
              <span>{rest.join(' ')}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function NoEngine() {
  const ctx = useApp()
  return (
    <div className="cm-noengine">
      <h2>{t('No chat engine is ready')}</h2>
      <p className="muted">{t('Install one of these CLIs, sign in with it once in a terminal, then re-detect engines.')}</p>
      <ul>
        {ctx.engines
          .filter((e) => e.headless)
          .map((e) => (
            <li key={e.id}>
              <span className="engine-ico">
                <EngineIcon engine={e.id} size={14} />
              </span>
              <b>{e.label}</b>
              <code>{e.installHint}</code>
              {!e.enabled ? <span className="faint small">{t('hidden in Settings')}</span> : null}
            </li>
          ))}
      </ul>
      <div className="row">
        <button className="btn" onClick={() => void ctx.refreshEngines()}>
          {t('Re-detect engines')}
        </button>
        <button className="btn primary" onClick={ctx.openSettings}>
          {t('Open Settings')}
        </button>
      </div>
    </div>
  )
}

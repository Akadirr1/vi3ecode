import { useState, type Ref } from 'react'
import { FilePen, Lock, SendHorizontal, ShieldQuestion, Square, Zap } from 'lucide-react'
import type { Agent, ApprovalMode, Team, TeamRun } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../context'
import { t } from '../../i18n'
import { Avatar } from '../../components/Avatar'
import { APPROVAL_LABEL } from '../../components/format'
import { errorText, putRun, saveTeam } from './store'

const CAN: Record<ApprovalMode, [string, typeof Lock]> = {
  'read-only': ['Read-only', Lock],
  ask: ['Asks first', ShieldQuestion],
  edits: ['Edits files', FilePen],
  full: ['Full access', Zap]
}

/** to: chips, the message box, AUTO-RELAY / AUTO-APPROVE, Stop and Send. No thread selected: Send starts one. */
/** `to` is an agent id ('' = Auto); it lives in AgentMain so it survives the start screen → thread switch. */
export function Composer({ run, team, text, setText, to, setTo, inputRef }: { run: TeamRun | null; team: Team | null; text: string; setText(v: string): void; to: string; setTo(id: string): void; inputRef: Ref<HTMLTextAreaElement> }) {
  const { project, setRunId } = useApp()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const agents = team?.agents ?? []
  const lead = agents.find((a) => a.lead) ?? agents[0]
  const target: Agent | undefined = agents.find((a) => a.id === to)
  const running = run?.status === 'running'
  // Auto: the team can edit when anyone on it may write.
  const level: ApprovalMode = target?.permission ?? (agents.some((a) => a.permission !== 'read-only') ? 'edits' : 'read-only')
  const [canLabel, CanIcon] = CAN[level]
  const asker = run?.question && !target ? agents.find((a) => a.id === run.next?.agentId) : undefined
  const placeholder = asker
    ? t('Answer {name}…', { name: asker.name })
    : running
      ? t('Message {name} now — the team keeps working…', { name: (target ?? lead)?.name ?? '' })
      : target
        ? t('Message @{name} directly…', { name: target.name })
        : t('Tell the team what to build — the Lead will route it…')

  const send = async () => {
    const body = text.trim()
    if (!body || busy || !team) return
    setBusy(true)
    setError('')
    try {
      if (run) await api.team.send(run.id, body, target?.id)
      else {
        const r = await api.team.start(project.id, body, target?.id)
        putRun(r)
        setRunId(r.id)
      }
      setText('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const routing = (p: Partial<Team['routing']>) => team && void saveTeam(project.id, { ...team, routing: { ...team.routing, ...p } }).catch((e) => setError(errorText(e)))

  return (
    <div className="am-composer">
      <div className="am-to" role="group" aria-label={t('Send to')}>
        <span className="faint mono">{t('to:')}</span>
        <button className="chip" aria-pressed={!target} onClick={() => setTo('')}>
          {t('Auto (Lead routes)')}
        </button>
        {agents.map((a) => (
          <button key={a.id} className="chip" aria-pressed={a.id === to} onClick={() => setTo(a.id)}>
            <Avatar avatar={a.avatar} color={a.color} size={15} />@{a.name}
          </button>
        ))}
        <span className="am-can" title={t(APPROVAL_LABEL[level].hint)}>
          <CanIcon size={12} aria-hidden />
          {t(canLabel)}
        </span>
      </div>
      <textarea
        ref={inputRef}
        className="am-input"
        value={text}
        rows={2}
        aria-label={t('Message')}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void send()
          }
        }}
      />
      {error ? (
        <div className="am-composer-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="am-bar">
        <button className="switch" aria-pressed={!!team?.routing.autoRelay} disabled={!team} title={t('Agents hand off to each other without asking')} onClick={() => routing({ autoRelay: !team?.routing.autoRelay })}>
          {t('Auto-relay')}
        </button>
        <button className="switch" aria-pressed={!!team?.routing.autoApprove} disabled={!team} title={t('Agent permission requests are allowed without asking (never widens read-only)')} onClick={() => routing({ autoApprove: !team?.routing.autoApprove })}>
          {t('Auto-approve')}
        </button>
        <span className="am-hint mono">{team?.routing.autoApprove ? t('every approval is given automatically') : team?.routing.autoRelay ? t('agents pass work without asking') : t('each handoff waits for your OK')}</span>
        <span className="grow" />
        {running ? (
          <button className="btn" onClick={() => void api.team.stop(run.id).catch((e) => setError(errorText(e)))}>
            <Square size={12} />
            {t('Stop')}
          </button>
        ) : null}
        <button className="btn primary" onClick={() => void send()} disabled={!text.trim() || busy || !team}>
          {t('Send')}
          <SendHorizontal size={14} />
        </button>
      </div>
    </div>
  )
}

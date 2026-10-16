import { Fragment, useEffect, useState, type Ref } from 'react'
import { FilePen, GitBranch, Lock, SendHorizontal, ShieldQuestion, Square, Waypoints, Zap } from 'lucide-react'
import type { Agent, ApprovalMode, Team, TeamRun } from '../../../../shared/types'
import { copyCount, roleOf } from '../../../../shared/prompt'
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
/** `to` is an agent id ('' = Auto), or one copy of it (`dev~2`); it lives in AgentMain so it survives the start screen → thread switch. */
export function Composer({ run, team, text, setText, to, setTo, inputRef }: { run: TeamRun | null; team: Team | null; text: string; setText(v: string): void; to: string; setTo(id: string): void; inputRef: Ref<HTMLTextAreaElement> }) {
  const { project, setRunId } = useApp()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Where a new thread works: the project checkout, or its own worktree (remembered per project, per viewer).
  const isoKey = `am-isolation:${project.id}`
  const [iso, setIsoState] = useState<'local' | 'worktree'>(() => {
    try {
      return localStorage.getItem(isoKey) === 'worktree' ? 'worktree' : 'local'
    } catch {
      return 'local'
    }
  })
  const setIso = (v: 'local' | 'worktree') => {
    setIsoState(v)
    try {
      localStorage.setItem(isoKey, v)
    } catch {
      // not remembered: fine
    }
  }
  const [isRepo, setIsRepo] = useState(true)
  useEffect(() => {
    if (!run) void api.git.status(project.id).then((s) => setIsRepo(s.isRepo), () => setIsRepo(false))
  }, [project.id, run])
  const worktree = !run && iso === 'worktree' && isRepo
  const agents = team?.agents ?? []
  const lead = agents.find((a) => a.lead) ?? agents[0]
  const target: Agent | undefined = agents.find((a) => a.id === roleOf(to))
  const running = run?.status === 'running'
  // Auto: the team can edit when anyone on it who is not paused may write.
  const level: ApprovalMode = target?.permission ?? (agents.some((a) => !a.paused && a.permission !== 'read-only') ? 'edits' : 'read-only')
  const [canLabel, CanIcon] = CAN[level]
  const asker = run?.question && !target ? agents.find((a) => a.id === roleOf(run.next?.agentId ?? '')) : undefined
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
      if (run) await api.team.send(run.id, body, target ? to : undefined)
      else {
        const r = await api.team.start(project.id, body, target ? to : undefined, worktree ? 'worktree' : 'local')
        putRun(r)
        setRunId(r.id)
      }
      setText('')
    } catch (e) {
      const msg = errorText(e)
      const failed = 'The worktree could not be created.'
      setError(msg.startsWith(failed) ? `${t('The worktree could not be created. Your message is back in the composer.')} ${msg.slice(failed.length).trim()}` : t(msg))
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
        {agents.map((a) => {
          const n = copyCount(a)
          return (
            <Fragment key={a.id}>
              <button className="chip" aria-pressed={a.id === target?.id} disabled={a.paused} onClick={() => setTo(a.id)}>
                <Avatar avatar={a.avatar} color={a.color} size={15} />@{a.name}
                {n > 1 ? ` ×${n}` : ''}
              </button>
              {/* One copy of the selected role; #1 is the role's own id. */}
              {n > 1 && a.id === target?.id
                ? Array.from({ length: n }, (_, i) => (
                    <button key={i} className="chip" aria-pressed={to === `${a.id}~${i + 1}`} onClick={() => setTo(`${a.id}~${i + 1}`)}>
                      #{i + 1}
                    </button>
                  ))
                : null}
            </Fragment>
          )
        })}
        <span className="am-can" title={t(APPROVAL_LABEL[level].hint)}>
          <CanIcon size={12} aria-hidden />
          {t(canLabel)}
        </span>
        {run ? (
          <span className="am-can am-iso" title={t('Fixed when the thread was created')}>
            {run.worktree ? <Waypoints size={12} aria-hidden /> : <GitBranch size={12} aria-hidden />}
            {run.worktree ? t('isolated worktree') : t('on this branch')}
          </span>
        ) : (
          <span className="seg am-iso" role="group" aria-label={t('Thread workspace')}>
            <button aria-pressed={!worktree} onClick={() => setIso('local')}>
              <GitBranch size={12} aria-hidden />
              {t('on this branch')}
            </button>
            <button aria-pressed={worktree} disabled={!isRepo} title={isRepo ? undefined : t('This project is not a Git repository — an isolated worktree needs one')} onClick={() => setIso('worktree')}>
              <Waypoints size={12} aria-hidden />
              {t('isolated worktree')}
            </button>
          </span>
        )}
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
      {busy && worktree ? (
        <div className="am-composer-note faint small" role="status">
          {t("Creating the thread's worktree…")}
        </div>
      ) : error ? (
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

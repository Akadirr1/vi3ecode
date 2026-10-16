import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, CircleCheck, FileText, Globe, ListChecks, Pencil, RotateCcw, Search, Terminal, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { Agent, Team, TeamRun, TeamTurn } from '../../../../shared/types'
import { api } from '../../api'
import { t } from '../../i18n'
import { Avatar } from '../../components/Avatar'
import { Prose } from '../../components/Prose'
import { formatCost } from '../../components/format'
import { clock, errorText, stripProtocol } from './store'

const TOOL_ICONS: [RegExp, LucideIcon][] = [
  [/^(read|view|cat|open)/i, FileText],
  [/^(grep|glob|search|find|ls|list)|search/i, Search],
  [/^(edit|write|multiedit|notebookedit|apply_?patch|patch|str_replace|create)/i, Pencil],
  [/^(bash|shell|exec|command|run|terminal)/i, Terminal],
  [/^web|fetch|browse/i, Globe],
  [/^todo/i, ListChecks],
  [/^(task|agent)$/i, Users]
]
const toolIcon = (name: string): LucideIcon => TOOL_ICONS.find(([re]) => re.test(name))?.[1] ?? Wrench

/** The thread (mount with key=run.id): user bubbles, per-turn steps, agent messages, handoff / done / error cards, approvals, pause banners. */
export function Transcript({ run, team }: { run: TeamRun; team: Team | null }) {
  const agents = team?.agents ?? []
  const byId = (id: string) => agents.find((a) => a.id === id)
  const byName = (name: string) => agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [error, setError] = useState('')
  const lastAgent = run.turns.findLast((x) => x.kind === 'agent')

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [run])
  const act = (p: Promise<void>) => void p.catch((e) => setError(errorText(e)))

  return (
    <div
      className="am-scroll"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      }}
    >
      <div className="am-col" aria-live="polite">
        {run.turns.map((turn) =>
          turn.kind === 'user' ? (
            <div key={turn.id} className="am-user">
              {turn.to ? <span className="am-user-to mono">{t('You → @{name}', { name: turn.to })}</span> : null}
              <div className="am-bubble">{turn.text}</div>
            </div>
          ) : (
            <AgentTurn
              key={turn.id}
              turn={turn}
              agent={byId(turn.agentId)}
              targets={turn.handoff ? turn.handoff.to.split(', ').map((n) => byName(n) ?? n) : []}
              onRetry={turn === lastAgent && run.status === 'error' ? () => act(api.team.continue(run.id)) : undefined}
            />
          )
        )}
        {run.pending.map((p) => {
          const a = byId(p.agentId)
          return (
            <div key={p.id} className="am-approval" role="group" aria-label={t('Approval request')}>
              <div className="row">
                {a ? <Avatar avatar={a.avatar} color={a.color} size={20} /> : null}
                <strong>{a?.name ?? t('An agent')}</strong>
                <span className="muted">{t('wants to use')}</span>
                <span className="mono am-tool-name">{p.tool}</span>
                <span className="grow" />
                <span className="micro">{t('Approval')}</span>
              </div>
              {p.detail ? <div className="mono am-approval-detail">{p.detail}</div> : null}
              <div className="row">
                <span className="grow" />
                <button className="btn small" onClick={() => act(api.team.respond(run.id, p.id, false))}>
                  {t('Deny')}
                </button>
                <button className="btn small primary" onClick={() => act(api.team.respond(run.id, p.id, true))}>
                  {t('Allow')}
                </button>
              </div>
            </div>
          )
        })}
        <Banner key={`${run.id}-${run.status}`} run={run} team={team} act={act} />
        {error ? (
          <div className="am-card am-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AgentTurn({ turn, agent, targets, onRetry }: { turn: TeamTurn; agent?: Agent; targets: (Agent | string)[]; onRetry?: () => void }) {
  const running = turn.status === 'running'
  const text = stripProtocol(turn.text)
  const name = agent?.name ?? turn.agentName
  const avatar = agent ? <Avatar avatar={agent.avatar} color={agent.color} size={18} /> : null
  return (
    <>
      {turn.tools.length ? (
        <details className="am-card am-steps" open>
          <summary>
            <Terminal size={13} className="faint" aria-hidden />
            <span className="mono">{turn.tools.length === 1 ? t('1 step') : t('{n} steps', { n: turn.tools.length })}</span>
            <span className="grow" />
            <span className="mono faint">
              {name} · {clock(turn.startedAt)}
            </span>
          </summary>
          <ul>
            {turn.tools.map((tool, i) => {
              // A tool entry is its name, optionally followed by its argument.
              const [tname, ...rest] = tool.split(' ')
              const Icon = toolIcon(tname)
              const live = running && i === turn.tools.length - 1
              return (
                <li key={i} className={live ? 'live' : undefined}>
                  <Icon size={13} className="faint" aria-hidden />
                  <strong className="mono">{tname}</strong>
                  <span className="mono muted am-step-arg">{rest.join(' ')}</span>
                  {live ? null : <Check size={13} className="faint" aria-label={t('finished')} />}
                </li>
              )
            })}
          </ul>
        </details>
      ) : null}
      {text || running || turn.status === 'stopped' ? (
        <div className="am-msg">
          {agent ? <Avatar avatar={agent.avatar} color={agent.color} size={28} /> : <span className="am-msg-ph" />}
          <div className="am-msg-body">
            <div className="am-msg-head">
              <strong>{name}</strong>
              {agent?.role ? (
                <span className="am-role-tag" style={{ color: agent.color }}>
                  {agent.role}
                </span>
              ) : null}
              <span className="mono faint">{clock(turn.startedAt)}</span>
              {turn.costUsd ? <span className="mono faint">{formatCost(turn.costUsd)}</span> : null}
              {running ? <span className="am-dots" role="img" aria-label={t('working')}>
                  <i />
                  <i />
                  <i />
                </span> : null}
              {turn.status === 'stopped' ? <span className="badge">{t('stopped')}</span> : null}
            </div>
            {text ? (
              <div className={`am-card am-text${running ? ' live' : ''}`}>
                <Prose text={text} />
              </div>
            ) : null}
            {turn.filesTouched.length ? (
              <div className="am-files" aria-label={t('Files touched')}>
                <span className="micro">{t('Files · {n}', { n: turn.filesTouched.length })}</span>
                {turn.filesTouched.map((f) => (
                  <span key={f} className="mono am-file">
                    <Pencil size={11} aria-hidden />
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {turn.handoff ? (
        <div className="am-card am-handoff">
          <div className="row">
            {avatar}
            <strong>{name}</strong>
            <ArrowRight size={13} className="faint" aria-label={t('hands off to')} />
            {targets.map((x, i) =>
              typeof x === 'string' ? (
                <strong key={i}>{x}</strong>
              ) : (
                <span key={i} className="row am-handoff-to">
                  <Avatar avatar={x.avatar} color={x.color} size={18} />
                  <strong>{x.name}</strong>
                </span>
              )
            )}
            <span className="grow" />
            <span className="micro">{t('Handoff')}</span>
          </div>
          {turn.handoff.note ? <div className="am-handoff-note">{turn.handoff.note}</div> : null}
        </div>
      ) : null}
      {turn.done !== undefined ? (
        <div className="am-card am-done">
          <CircleCheck size={15} aria-hidden />
          <span>
            <strong>{t('Done:')}</strong> {turn.done}
          </span>
        </div>
      ) : null}
      {turn.error ? (
        <div className="am-card am-error" role="alert">
          <span className="grow">
            <strong>{name}:</strong> {turn.error}
          </span>
          {onRetry ? (
            <button className="btn small" onClick={onRetry}>
              <RotateCcw size={12} />
              {t('Retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** Why the thread paused, who goes next, and Continue. */
function Banner({ run, team, act }: { run: TeamRun; team: Team | null; act(p: Promise<void>): void }) {
  const agents = team?.agents ?? []
  const lead = agents.find((a) => a.lead) ?? agents[0]
  const [next, setNext] = useState(run.next?.agentId ?? lead?.id ?? '')
  const why: Partial<Record<TeamRun['status'], string>> = {
    waiting: run.next?.note ? t('Waiting for your OK. Note: {note}', { note: run.next.note }) : t('Waiting for your OK to continue.'),
    'hop-cap': t('Paused after {n} handoffs (hop limit). Continue for another stretch.', { n: team?.routing.hopLimit ?? run.hops }),
    budget: t('Budget reached for this stretch. Continue to allow another one.'),
    stopped: t('Stopped. Continue picks the thread up again.')
  }
  if (run.status === 'waiting' && run.question) {
    const asker = agents.find((a) => a.id === run.next?.agentId)
    return (
      <div className="am-card am-banner am-question">
        <div className="row">
          {asker ? <Avatar avatar={asker.avatar} color={asker.color} size={18} /> : null}
          <strong>{asker?.name ?? t('An agent')}</strong>
          <span className="muted">{t('asks you')}</span>
          <span className="grow" />
          <span className="micro">{t('Question')}</span>
        </div>
        <Prose text={run.question} />
        <span className="faint small">{t('Reply below to answer; with Auto selected it goes to {name}.', { name: asker?.name ?? t('the agent') })}</span>
      </div>
    )
  }
  const text = why[run.status]
  if (!text) return null
  return (
    <div className={`am-card am-banner${run.status === 'stopped' ? '' : ' warn'}`}>
      <span className="grow">{text}</span>
      <select className="select am-next" aria-label={t('Who goes next')} value={next} onChange={(e) => setNext(e.target.value)}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {t('Next: {name}', { name: a.name })}
          </option>
        ))}
      </select>
      <button className="btn small primary" onClick={() => act(api.team.continue(run.id, next || undefined))}>
        {t('Continue')}
      </button>
    </div>
  )
}

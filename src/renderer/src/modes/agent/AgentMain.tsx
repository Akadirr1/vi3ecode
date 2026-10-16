import { useRef, useState } from 'react'
import { ArrowRight, Bug, Hammer, ListChecks, Lock, SlidersHorizontal, Users } from 'lucide-react'
import type { Agent, TeamRun } from '../../../../shared/types'
import { roleOf } from '../../../../shared/prompt'
import { useApp } from '../../context'
import { t } from '../../i18n'
import { Avatar } from '../../components/Avatar'
import { Composer } from './Composer'
import { TeamDialog } from './TeamDialog'
import { Transcript } from './Transcript'
import { RUN_STATUS, stripProtocol, useRuns, useTeam } from './store'
import './agent-mode.css'

const STARTERS = [
  { icon: Hammer, title: 'Build a feature', hint: 'The Lead breaks it into steps and gives each one to the right agent.', prompt: 'Build this feature: ' },
  { icon: Bug, title: 'Fix a bug', hint: 'Reproduce it, fix the cause and add a test that keeps it fixed.', prompt: 'Find and fix this bug: ' },
  { icon: ListChecks, title: 'Review recent changes', hint: 'Read what changed, point out risks and fill in missing tests.', prompt: 'Review the latest changes: point out risks and add any missing tests.' }
]

/** Agent Mode main area: thread header, transcript (or the start screen) and the composer. */
export function AgentMain() {
  const { project, runId } = useApp()
  const team = useTeam(project.id)
  const runs = useRuns(project.id)
  const run = runs.find((r) => r.id === runId) ?? null
  const [text, setText] = useState('')
  const [to, setTo] = useState('')
  const [dialog, setDialog] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const agents = team?.agents ?? []
  const composer = <Composer run={run} team={team} text={text} setText={setText} to={to} setTo={setTo} inputRef={input} />

  return (
    <div className="view am">
      <header className="am-head">
        <div className="col am-head-text">
          <div className="row am-kicker">
            <span className="micro">{t('Agent thread')}</span>
            {run ? (
              <>
                <span className={`badge ${RUN_STATUS[run.status][1]}`} aria-live="polite">
                  {t(RUN_STATUS[run.status][0])}
                </span>
                <button className="chip am-team-chip" onClick={() => setDialog('')} title={t('Edit the project team')}>
                  <Users size={12} />
                  {t('Project team')}
                </button>
              </>
            ) : null}
          </div>
          <h2 className="am-title">{run ? run.goal.split('\n')[0] : t('No thread selected')}</h2>
        </div>
        {run ? <Capsule run={run} agents={agents} /> : null}
      </header>
      {run ? (
        <>
          <Transcript key={run.id} run={run} team={team} />
          <div className="am-dock">{composer}</div>
        </>
      ) : (
        <div className="am-scroll">
          <div className="am-hero">
            <h1>{t('Put your team to work')}</h1>
            <p className="muted">{t('Write a goal below. The Lead breaks it down and passes each step to the right agent; every handoff shows up in this thread.')}</p>
            <div className="am-roster">
              {agents.map((a) => (
                <button key={a.id} className={`am-roster-chip${a.paused ? ' paused' : ''}`} onClick={() => setDialog(a.id)} title={t('Edit {name}', { name: a.name })}>
                  <Avatar avatar={a.avatar} color={a.color} size={22} />
                  <strong>{a.name}</strong>
                  <span className="am-role">{a.role}</span>
                  {a.paused ? <span className="faint">· {t('paused')}</span> : null}
                  {a.permission === 'read-only' ? <Lock size={11} className="faint" aria-label={t('Read-only')} /> : null}
                </button>
              ))}
              <button className="iconbtn am-roster-edit" onClick={() => setDialog('')} title={t('Manage team')} aria-label={t('Manage team')} disabled={!team}>
                <SlidersHorizontal size={14} />
              </button>
            </div>
            <div className="am-starters">
              {STARTERS.map(({ icon: Icon, title, hint, prompt }) => (
                <button
                  key={title}
                  className="am-starter"
                  onClick={() => {
                    setText(t(prompt))
                    input.current?.focus()
                  }}
                >
                  <span className="row">
                    <Icon size={15} aria-hidden />
                    <strong>{t(title)}</strong>
                  </span>
                  <span className="muted">{t(hint)}</span>
                </button>
              ))}
            </div>
            {composer}
          </div>
        </div>
      )}
      {dialog !== null ? <TeamDialog initial={dialog || undefined} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

/** Top-right live capsule: who handed to whom, the agent's state, hop count and its latest line. */
function Capsule({ run, agents }: { run: TeamRun; agents: Agent[] }) {
  if (run.status !== 'running' && run.status !== 'waiting') return null
  const turns = run.turns.filter((x) => x.kind === 'agent')
  const last = turns.at(-1)
  if (!last) return null
  const byId = (id?: string) => agents.find((a) => a.id === roleOf(id ?? ''))
  const live = last.status === 'running'
  const current = byId(live ? last.agentId : (run.next?.agentId ?? last.agentId))
  const prev = byId(live || !run.next ? turns.at(-2)?.agentId : last.agentId)
  const from = prev?.id === current?.id ? undefined : prev
  const line = stripProtocol(last.text).split('\n').filter((l) => l.trim()).at(-1) ?? last.tools.at(-1) ?? ''
  return (
    <div className={`am-capsule${live ? ' live' : ''}`} aria-live="polite">
      <span className="row am-capsule-faces">
        {from ? <Avatar avatar={from.avatar} color={from.color} size={20} title={from.name} /> : null}
        {from ? <ArrowRight size={12} className="faint" aria-hidden /> : null}
        {current ? <Avatar avatar={current.avatar} color={current.color} size={20} title={current.name} /> : null}
      </span>
      <span className="col am-capsule-text">
        <span className="row">
          <strong>{current?.name ?? last.agentName}</strong>
          <span className={`mono ${live ? 'am-working' : 'am-warn'}`}>{live ? t('working') : t(RUN_STATUS[run.status][0])}</span>
          <span className="mono faint">· {run.hops === 1 ? t('1 handoff') : t('{n} handoffs', { n: run.hops })}</span>
        </span>
        <span className="mono faint am-capsule-line">{line || '…'}</span>
      </span>
    </div>
  )
}

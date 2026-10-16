import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CirclePause, GitBranch, LoaderCircle, Lock, Settings, Square, UserPlus } from 'lucide-react'
import type { Agent, TeamRun } from '../../../../shared/types'
import { roleOf } from '../../../../shared/prompt'
import { useApp } from '../../context'
import { t } from '../../i18n'
import { Avatar } from '../../components/Avatar'
import { EngineIcon } from '../../components/EngineIcon'
import { TeamDialog } from './TeamDialog'
import { useRuns, useTeam, workingAgents } from './store'
import './agent-mode.css'

/** Agent Mode sidebar: the project team (double-click an agent to edit it) and the threads. */
export function AgentSidebar() {
  const { project, engines, runId, setRunId, openTool } = useApp()
  const team = useTeam(project.id)
  const runs = useRuns(project.id)
  const [open, setOpen] = useState(true)
  const [dialog, setDialog] = useState<string | null>(null)
  const working = workingAgents(runs)
  const agents = team?.agents ?? []
  const listed = [...agents].sort((a, b) => Number(!!a.paused) - Number(!!b.paused)) // paused last, as in vi3ecode

  return (
    <>
      <div className="side-label am-team-label">
        <button className="am-collapse micro" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('Project team · {n}', { n: agents.length })}
        </button>
        <span className="spacer" />
        <button className="iconbtn am-mini" onClick={() => setDialog('new')} title={t('New agent')} aria-label={t('New agent')} disabled={!team}>
          <UserPlus size={14} />
        </button>
        <button className="iconbtn am-mini" onClick={() => setDialog('')} title={t('Manage team')} aria-label={t('Manage team')} disabled={!team}>
          <Settings size={14} />
        </button>
      </div>
      {open
        ? listed.map((a) => {
            const busy = working.has(a.id)
            return (
              <button
                key={a.id}
                className="am-agent"
                onDoubleClick={() => setDialog(a.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setDialog(a.id))}
                title={t('Double-click to edit {name}', { name: a.name })}
              >
                <Avatar avatar={a.avatar} color={a.color} size={30} status={a.paused ? 'paused' : busy ? 'working' : 'idle'} />
                <span className="am-agent-text">
                  <span className="am-agent-line">
                    <strong>{a.name}</strong>
                    <span className="am-role">{a.role}</span>
                  </span>
                  <span className="am-agent-meta">
                    {a.permission === 'read-only' ? <Lock size={10} aria-label={t('Read-only')} /> : null}
                    <EngineIcon engine={a.engine} size={11} />
                    <span className="am-model">{a.model || engines.find((e) => e.id === a.engine)?.label || a.engine}</span>
                    <span>·</span>
                    <span className={a.paused ? 'faint' : busy ? 'am-working' : undefined}>{a.paused ? t('paused') : busy ? t('working') : t('idle')}</span>
                  </span>
                </span>
              </button>
            )
          })
        : null}
      <div className="side-label">
        <span className="micro">{t('Threads')}</span>
      </div>
      {runs.map((r) => (
        <button
          key={r.id}
          className={`scard am-thread${r.id === runId ? ' active' : ''}`}
          aria-current={r.id === runId ? 'true' : undefined}
          onClick={() => {
            openTool(null)
            setRunId(r.id)
          }}
        >
          <ThreadIcon run={r} agents={agents} />
          <span className="scard-title grow">{r.goal.split('\n')[0]}</span>
          {r.worktree ? (
            <span className="am-thread-branch" title={r.worktree.branch}>
              <GitBranch size={11} aria-hidden />
              {r.worktree.branch.replace(/^work\//, '')}
            </span>
          ) : null}
          {r.status === 'running' ? <LoaderCircle size={14} className="am-spin faint" aria-label={t('running')} /> : null}
        </button>
      ))}
      {!runs.length ? <div className="faint small am-none">{t('No threads yet. Give the team a goal.')}</div> : null}
      {dialog !== null ? <TeamDialog initial={dialog || undefined} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

function ThreadIcon({ run, agents }: { run: TeamRun; agents: Agent[] }) {
  const label = t(run.status)
  if (run.status === 'running') {
    // The agent holding the turn; the spinner sits on the right.
    const turn = run.turns.findLast((x) => x.kind === 'agent' && x.status === 'running')
    const a = agents.find((x) => x.id === roleOf(turn?.agentId ?? ''))
    return a ? <Avatar avatar={a.avatar} color={a.color} size={18} title={a.name} /> : <LoaderCircle size={15} className="am-spin" aria-label={label} />
  }
  if (run.status === 'done') return <CircleCheck size={15} className="am-ok" aria-label={label} />
  if (run.status === 'error') return <CircleAlert size={15} className="am-danger" aria-label={label} />
  if (run.status === 'stopped') return <Square size={13} className="faint" aria-label={label} />
  return <CirclePause size={15} className="am-warn" aria-label={label} />
}

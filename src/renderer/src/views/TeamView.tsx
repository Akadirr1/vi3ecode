import { useEffect, useState, type KeyboardEvent } from 'react'
import type { Agent, ApprovalMode, EngineId, RunStatus, Team, TeamRun, TeamTurn } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { Prose } from '../components/Prose'
import { APPROVAL_HELP, errorText, usd } from './ChatView'
import './team.css'

const MAX_AGENTS = 12

const STATUS_BADGE: Record<RunStatus, string> = {
  running: 'accent',
  waiting: 'warn',
  done: 'ok',
  stopped: '',
  error: 'danger',
  budget: 'warn',
  'hop-cap': 'warn'
}

export function TeamView() {
  const { project, settings } = useApp()
  const [tab, setTab] = useState<'runs' | 'team'>('runs')
  const [saved, setSaved] = useState<Team | null>(null)
  const [draft, setDraft] = useState<Team | null>(null)
  const [error, setError] = useState('')
  const fail = (e: unknown) => setError(errorText(e))

  useEffect(() => {
    void api.team.get(project.id).then((t) => {
      setSaved(t)
      setDraft(t)
    }, fail)
  }, [project.id])

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const save = async () => {
    if (!draft) return
    try {
      const t = await api.team.save(project.id, draft)
      setSaved(t)
      setDraft(t)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>Agent team</h2>
        <div className="team-tabs" role="tablist" aria-label="Agent team">
          {(['runs', 'team'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`team-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'runs' ? 'Runs' : 'Team'}
              {t === 'team' && dirty ? <span className="team-dirty" aria-label="unsaved changes" /> : null}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {tab === 'team' && draft ? (
          <>
            <span className="faint small" aria-live="polite">
              {dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <button className="btn" onClick={() => draft && setDraft({ ...draft, agents: [...draft.agents, newAgent(draft.agents, settings.defaultEngine)] })} disabled={draft.agents.length >= MAX_AGENTS}>
              + Add agent
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={!dirty}>
              Save team
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="team-error row" role="alert">
          <span className="grow">{error}</span>
          <button className="btn ghost small" onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      ) : null}
      {tab === 'runs' ? <Runs team={saved} fail={fail} /> : draft ? <TeamEditor team={draft} onChange={setDraft} /> : null}
    </div>
  )
}

function TeamEditor({ team, onChange }: { team: Team; onChange: (t: Team) => void }) {
  const { engines } = useApp()
  const set = (i: number, patch: Partial<Agent>) => onChange({ ...team, agents: team.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const setLead = (i: number) => onChange({ ...team, agents: team.agents.map((a, j) => ({ ...a, lead: j === i || undefined })) })
  const remove = (i: number) => {
    const agents = team.agents.filter((_, j) => j !== i)
    if (team.agents[i].lead) agents[0] = { ...agents[0], lead: true }
    onChange({ ...team, agents })
  }

  return (
    <div className="view-body">
      <div className="team-grid">
        {team.agents.map((a, i) => (
          <div key={a.id} className="card team-card col">
            <div className="row">
              <span className="avatar" style={{ background: a.color }} aria-hidden>
                {a.avatar}
              </span>
              <label className="field grow">
                Name
                <input className="input" value={a.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} />
              </label>
              <label className="check team-lead" title="The lead gets the goal first and is the only one who can finish it">
                <input type="radio" name="lead" checked={!!a.lead} onChange={() => setLead(i)} />
                Lead
              </label>
            </div>
            <div className="row">
              <label className="field team-avatar">
                Avatar
                <input className="input" value={a.avatar} maxLength={8} onChange={(e) => set(i, { avatar: e.target.value })} />
              </label>
              <label className="field">
                Color
                <input className="team-color" type="color" value={a.color} onChange={(e) => set(i, { color: e.target.value })} />
              </label>
              <label className="field grow">
                Role
                <input className="input" value={a.role} maxLength={60} placeholder="e.g. implementation" onChange={(e) => set(i, { role: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="field grow">
                Engine
                <select className="select" value={a.engine} onChange={(e) => set(i, { engine: e.target.value as EngineId })}>
                  {engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                      {!e.installed ? ' (not installed)' : !e.headless ? ' (terminal-only)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field grow">
                Model
                <input className="input" value={a.model ?? ''} maxLength={80} placeholder="default" onChange={(e) => set(i, { model: e.target.value || undefined })} />
              </label>
              <label className="field grow">
                Permission
                <select className="select" value={a.permission} title={APPROVAL_HELP[a.permission]} onChange={(e) => set(i, { permission: e.target.value as ApprovalMode })}>
                  {(Object.keys(APPROVAL_HELP) as ApprovalMode[]).map((m) => (
                    <option key={m} value={m} title={APPROVAL_HELP[m]}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Instructions
              <textarea className="textarea" value={a.instructions} maxLength={4000} onChange={(e) => set(i, { instructions: e.target.value })} />
            </label>
            <div className="row">
              <span className="grow" />
              <button className="btn danger small" onClick={() => remove(i)} disabled={team.agents.length === 1}>
                Remove {a.name || 'agent'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function newAgent(agents: Agent[], engine: EngineId): Agent {
  let n = agents.length + 1
  while (agents.some((a) => a.name.toLowerCase() === `agent ${n}`)) n++
  return { id: `agent-${Date.now().toString(36)}-${agents.length}`, name: `Agent ${n}`, role: '', avatar: '🤖', color: '#a4abb8', engine, permission: 'read-only', instructions: '' }
}

function Runs({ team, fail }: { team: Team | null; fail: (e: unknown) => void }) {
  const { project, settings, setSettings } = useApp()
  const [runs, setRuns] = useState<TeamRun[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [goal, setGoal] = useState('')

  useEffect(() => {
    void api.team.runs(project.id).then((list) => {
      setRuns((cur) => [...cur.filter((r) => !list.some((l) => l.id === r.id)), ...list])
      setOpenId((cur) => cur ?? list[0]?.id ?? null)
    }, fail)
    return api.team.onRun((run) => {
      if (run.projectId !== project.id) return
      setRuns((list) => (list.some((r) => r.id === run.id) ? list.map((r) => (r.id === run.id ? run : r)) : [run, ...list]))
    })
  }, [project.id])

  const start = async () => {
    try {
      const run = await api.team.start(project.id, goal)
      // Live events may already have delivered a newer copy of this run.
      setRuns((list) => (list.some((r) => r.id === run.id) ? list : [run, ...list]))
      setOpenId(run.id)
      setGoal('')
    } catch (e) {
      fail(e)
    }
  }

  const run = runs.find((r) => r.id === openId)

  return (
    <div className="split">
      <div className="list-pane col">
        <label className="field">
          New goal
          <textarea
            className="textarea"
            value={goal}
            placeholder="What should the team achieve?"
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && goal.trim()) void start()
            }}
          />
        </label>
        <button className="btn primary" onClick={() => void start()} disabled={!goal.trim()}>
          Hand to team
        </button>
        <div className="team-strip">
          <label className="check" title="Start the next teammate's turn without waiting for you">
            <input type="checkbox" checked={settings.autoHandoff} onChange={(e) => void setSettings({ autoHandoff: e.target.checked })} />
            Auto-handoff
          </label>
          <label className="team-num" title="Stop after this many handoffs; Continue starts a fresh stretch">
            Hop cap
            <input
              key={settings.hopCap}
              className="input"
              type="number"
              min={1}
              max={50}
              defaultValue={settings.hopCap}
              onKeyDown={blurOnEnter}
              onBlur={(e) => void setSettings({ hopCap: Number(e.target.value) || settings.hopCap })}
            />
          </label>
          <label className="team-num" title="Stop once a stretch of turns has cost this much. 0 = no budget">
            Budget $
            <input
              key={settings.budgetUsd}
              className="input"
              type="number"
              min={0}
              step={0.5}
              defaultValue={settings.budgetUsd}
              onKeyDown={blurOnEnter}
              onBlur={(e) => void setSettings({ budgetUsd: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
        <div className="col team-runs">
          {runs.map((r) => (
            <button key={r.id} className={`list-item team-run${r.id === openId ? ' active' : ''}`} onClick={() => setOpenId(r.id)} aria-current={r.id === openId ? 'true' : undefined}>
              <span className="team-run-goal">{r.goal.split('\n')[0]}</span>
              <span className="row faint small">
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                <span>{usd(r.costUsd)}</span>
                <span>
                  {r.hops} hop{r.hops === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="detail-pane">
        {run ? <RunDetail key={run.id} run={run} team={team} fail={fail} /> : <div className="empty grow">{runs.length ? 'Pick a run on the left.' : 'No runs yet. Write a goal and hand it to the team.'}</div>}
      </div>
    </div>
  )
}

function RunDetail({ run, team, fail }: { run: TeamRun; team: Team | null; fail: (e: unknown) => void }) {
  const { settings } = useApp()
  const agents = team?.agents ?? []
  const lead = agents.find((a) => a.lead) ?? agents[0]
  const [nextId, setNextId] = useState(run.next?.agentId ?? lead?.id ?? '')
  useEffect(() => setNextId(run.next?.agentId ?? lead?.id ?? ''), [run.next?.agentId, lead?.id])

  const why: Partial<Record<RunStatus, string>> = {
    waiting: run.next?.note || 'Waiting for you to continue.',
    'hop-cap': `Paused after ${settings.hopCap} handoffs (hop cap).`,
    budget: `Paused: this stretch reached the ${usd(settings.budgetUsd)} budget.`,
    error: 'A turn failed. Continue retries it, or pick someone else.',
    stopped: 'Stopped.'
  }
  const done = run.status === 'done' ? [...run.turns].reverse().find((t) => t.done !== undefined)?.done : undefined

  return (
    <div className="team-run-detail">
      <div className="team-run-head col">
        <div className="row">
          <span className={`badge ${STATUS_BADGE[run.status]}`} aria-live="polite">
            {run.status}
          </span>
          <span className="faint small">
            {usd(run.costUsd)} · {run.hops} hop{run.hops === 1 ? '' : 's'} · {run.turns.length} turn{run.turns.length === 1 ? '' : 's'}
          </span>
          <span className="grow" />
          {run.status === 'running' ? (
            <button className="btn small" onClick={() => void api.team.stop(run.id).catch(fail)}>
              Stop
            </button>
          ) : null}
        </div>
        <div className="prose team-goal">{run.goal}</div>
        {why[run.status] ? (
          <div className="team-why row">
            <span className="grow">{why[run.status]}</span>
            <select className="select team-next" aria-label="Who goes next" value={nextId} onChange={(e) => setNextId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Next: {a.name}
                </option>
              ))}
            </select>
            <button className="btn primary small" onClick={() => void api.team.continue(run.id, nextId || undefined).catch(fail)}>
              Continue
            </button>
          </div>
        ) : null}
        {done !== undefined ? <div className="team-done">✓ Done: {done}</div> : null}
      </div>
      <div className="team-transcript">
        {run.turns.map((t) => (
          <Turn key={t.id} turn={t} agent={agents.find((a) => a.id === t.agentId)} />
        ))}
      </div>
    </div>
  )
}

function Turn({ turn: t, agent }: { turn: TeamTurn; agent?: Agent }) {
  const { engines } = useApp()
  const running = t.status === 'running'
  return (
    <div className="team-turn">
      <span className="avatar" style={{ background: agent?.color ?? 'var(--line-2)' }} aria-hidden>
        {agent?.avatar ?? t.agentName.slice(0, 1)}
      </span>
      <div className="grow col team-turn-body">
        <div className="row team-turn-meta">
          <strong>{t.agentName}</strong>
          {agent?.role ? <span className="faint">{agent.role}</span> : null}
          <span className="badge">{engines.find((e) => e.id === t.engine)?.label ?? t.engine}</span>
          {running ? <span className="badge accent">working…</span> : null}
          {t.status === 'stopped' ? <span className="badge">stopped</span> : null}
          {t.endedAt ? <span className="faint small">{duration(t.endedAt - t.startedAt)}</span> : null}
          {t.costUsd ? <span className="faint small">{usd(t.costUsd)}</span> : null}
        </div>
        {t.text ? <Prose text={t.text} /> : running ? <div className="faint">…</div> : null}
        {t.tools.length ? (
          <details className="chat-tools">
            <summary>
              {t.tools.length} tool{t.tools.length === 1 ? '' : 's'}
            </summary>
            <ul className="mono">
              {t.tools.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {t.filesTouched.length ? (
          <ul className="team-files mono" aria-label="Files touched">
            {t.filesTouched.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
        {t.handoff ? (
          <div className="team-handoff">
            → {t.handoff.to}
            {t.handoff.note ? `: ${t.handoff.note}` : ''}
          </div>
        ) : null}
        {t.done !== undefined ? <div className="team-handoff ok">✓ Done: {t.done}</div> : null}
        {t.error ? <div className="team-error-box">{t.error}</div> : null}
      </div>
    </div>
  )
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

import { useEffect, useState } from 'react'
import type { ActivityEvent, ActivityFilter, ActivitySource, LiveState } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import './activity.css'

const SOURCES: ActivitySource[] = ['chat', 'team', 'terminal', 'system']
const OUTCOME_BADGE: Record<ActivityEvent['outcome'], string> = { ok: 'ok', error: 'danger', stopped: 'warn', info: '' }

function duration(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

export function ActivityView() {
  const ctx = useApp()
  const [live, setLive] = useState<LiveState | null>(null)
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [source, setSource] = useState<ActivitySource | ''>('')
  const [thisProject, setThisProject] = useState(false)
  const [failuresOnly, setFailuresOnly] = useState(false)

  useEffect(() => {
    const tick = () => void api.activity.live().then(setLive)
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [])

  const filter: ActivityFilter = {
    ...(source ? { source } : {}),
    ...(thisProject ? { projectId: ctx.project.id } : {}),
    ...(failuresOnly ? { failuresOnly } : {})
  }
  const load = () => void api.activity.list(filter).then(setEvents)
  useEffect(load, [source, thisProject, failuresOnly, ctx.project.id])

  const engineLabel = (id?: string) => ctx.engines.find((e) => e.id === id)?.label ?? id ?? '—'
  const filtered = Object.keys(filter).length > 0

  return (
    <div className="view">
      <div className="view-header">
        <h2>Activity</h2>
        <div className="spacer" />
        <select
          className="select act-source"
          aria-label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value as ActivitySource | '')}
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="check small">
          <input type="checkbox" checked={thisProject} onChange={(e) => setThisProject(e.target.checked)} />
          This project only
        </label>
        <label className="check small">
          <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} />
          Failures only
        </label>
        <button className="btn small" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="view-body col act-body">
        <div className="act-live">
          {(
            [
              ['workingChats', 'Working chats'],
              ['runningTeams', 'Running teams'],
              ['waitingTeams', 'Waiting teams'],
              ['terminals', 'Terminals']
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="card act-stat">
              <span className={`dot ${live?.[key] ? (key === 'waitingTeams' ? 'busy' : 'on') : 'off'}`} aria-hidden />
              <span className="act-stat-n">{live?.[key] ?? '–'}</span>
              <span className="muted small">{label}</span>
            </div>
          ))}
        </div>
        {events && events.length ? (
          <div className="act-table-wrap">
            <table className="act-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Source</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Engine</th>
                  <th scope="col" className="num">
                    Duration
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.ts}-${i}`}>
                    <td className="mono faint">{new Date(e.ts).toLocaleString()}</td>
                    <td>{e.source}</td>
                    <td className="mono">{e.kind}</td>
                    <td>
                      <span className={`badge ${OUTCOME_BADGE[e.outcome]}`}>{e.outcome}</span>
                    </td>
                    <td className="muted">{engineLabel(e.engine)}</td>
                    <td className="num mono">{duration(e.durationMs)}</td>
                    <td className="num mono">{e.costUsd === undefined ? '—' : `$${e.costUsd.toFixed(4)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">{events ? (filtered ? 'Nothing matches these filters.' : 'No activity recorded yet.') : 'Loading…'}</div>
        )}
        <p className="faint small act-note">
          Stores what happened and how it turned out — never conversation text, tool arguments, file contents or command
          output. It never leaves this machine.
        </p>
      </div>
    </div>
  )
}

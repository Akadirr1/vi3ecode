import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ActivityEvent, ActivityFilter, ActivitySource, LiveState } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { EngineIcon } from '../components/EngineIcon'
import { formatCost, relativeTime } from '../components/format'
import './project-tools.css'

const SOURCES: ActivitySource[] = ['chat', 'team', 'flow', 'terminal', 'system']
const OUTCOME_BADGE: Record<ActivityEvent['outcome'], string> = { ok: 'ok', error: 'danger', stopped: 'warn', info: '' }
const OUTCOME_COLOR: Record<ActivityEvent['outcome'], string> = { ok: 'var(--ok)', error: 'var(--danger)', stopped: 'var(--warn)', info: 'var(--text-3)' }
const LIVE = [
  ['workingChats', 'Working chats'],
  ['runningTeams', 'Running teams'],
  ['waitingTeams', 'Waiting on you'],
  ['terminals', 'Terminals']
] as const

function duration(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

const stamp = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function ActivityTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const [live, setLive] = useState<LiveState | null>(null)
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [source, setSource] = useState<ActivitySource | ''>('')
  const [thisProject, setThisProject] = useState(false)
  const [failuresOnly, setFailuresOnly] = useState(false)

  useEffect(() => {
    const tick = () => void api.activity.live().then(setLive)
    tick()
    const timer = setInterval(tick, 3000)
    return () => clearInterval(timer)
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
    <div className="pt">
      <div className={`act-live${docked ? ' docked' : ''}`}>
        {LIVE.map(([key, label]) => (
          <div key={key} className="act-stat">
            <span className={`dot ${live?.[key] ? (key === 'waitingTeams' ? 'busy' : 'on') : 'off'}`} aria-hidden />
            <span className="act-n">{live?.[key] ?? '–'}</span>
            <span className="micro">{t(label)}</span>
          </div>
        ))}
      </div>
      <div className="pt-bar">
        <div className="row act-sources" role="group" aria-label={t('Source')}>
          <button className="chip" aria-pressed={!source} onClick={() => setSource('')}>
            {t('All')}
          </button>
          {SOURCES.map((s) => (
            <button key={s} className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>
              {t(s)}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="switch" aria-pressed={thisProject} onClick={() => setThisProject(!thisProject)}>
          {t('This project')}
        </button>
        <button className="switch" aria-pressed={failuresOnly} onClick={() => setFailuresOnly(!failuresOnly)}>
          {t('Failures')}
        </button>
        <button className="iconbtn" onClick={load} aria-label={t('Refresh')} title={t('Refresh')}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="act-scroll">
        {events && events.length ? (
          docked ? (
            <ul className="act-list">
              {events.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="act-row" title={stamp(e.ts)}>
                  <span className="dot" style={{ background: OUTCOME_COLOR[e.outcome] }} aria-label={t(e.outcome)} />
                  <div className="grow">
                    <div className="act-kind">{e.kind}</div>
                    <div className="pt-meta">
                      {[t(e.source), e.engine ? engineLabel(e.engine) : '', e.durationMs !== undefined ? duration(e.durationMs) : '', formatCost(e.costUsd)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className="pt-meta">{relativeTime(e.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <table className="act-table">
              <thead>
                <tr>
                  <th scope="col">{t('Time')}</th>
                  <th scope="col">{t('Source')}</th>
                  <th scope="col">{t('Kind')}</th>
                  <th scope="col">{t('Outcome')}</th>
                  <th scope="col">{t('Engine')}</th>
                  <th scope="col" className="num">
                    {t('Duration')}
                  </th>
                  <th scope="col" className="num">
                    {t('Cost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.ts}-${i}`}>
                    <td className="faint">{stamp(e.ts)}</td>
                    <td>{t(e.source)}</td>
                    <td className="act-kind">{e.kind}</td>
                    <td>
                      <span className={`badge ${OUTCOME_BADGE[e.outcome]}`}>{t(e.outcome)}</span>
                    </td>
                    <td>
                      {e.engine ? (
                        <span className="row act-engine">
                          <EngineIcon engine={e.engine} size={12} />
                          {engineLabel(e.engine)}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num">{duration(e.durationMs)}</td>
                    <td className="num">{formatCost(e.costUsd) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <div className="empty">{events ? (filtered ? t('Nothing matches these filters.') : t('No activity recorded yet.')) : t('Loading…')}</div>
        )}
      </div>
      <p className="pt-foot faint small">
        {t('Stores what happened and how it turned out — never conversation text, tool arguments, file contents or command output. It never leaves this machine.')}
      </p>
    </div>
  )
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import type { Agent, ApprovalMode, EngineId, Team, TeamRun } from '../../../../shared/types'
import { DEFAULT_TEAM } from '../../../../shared/schema'
import { api } from '../../api'
import { useApp } from '../../context'
import { t } from '../../i18n'
import { Avatar, PORTRAIT_COUNT } from '../../components/Avatar'
import { EngineIcon } from '../../components/EngineIcon'
import { APPROVAL_LABEL, formatCost } from '../../components/format'
import { AvatarPicker, SWATCHES, Swatches } from './AvatarPicker'
import { errorText, saveTeam, setTeam, useRuns, useTeam, workingAgents } from './store'

const MAX_AGENTS = 12 // sanitizeTeam keeps at most 12
const PERMISSIONS: [ApprovalMode, string][] = [
  ['read-only', 'Read-only'],
  ['ask', 'Ask'],
  ['edits', 'Edits'],
  ['full', 'Full']
]

type Preset = Pick<Agent, 'name' | 'role' | 'description' | 'permission' | 'instructions'>
const PRESETS: Preset[] = [
  { name: 'Developer', role: 'Implementation', permission: 'edits', description: 'Builds the change, tests first.', instructions: 'Implement the brief in small, tested steps. Keep the change as small as it can be, run the tests, and list the files you changed before handing to QA.' },
  { name: 'QA', role: 'Tests & review', permission: 'edits', description: 'Checks the change and signs it off or sends it back.', instructions: 'Check the change against the acceptance criteria and run the tests. Send failures back to the Developer with exact steps to reproduce; hand to the Lead when everything passes.' },
  { name: 'Analyst', role: 'Requirements', permission: 'read-only', description: 'Pins down scope and acceptance criteria before anyone codes.', instructions: 'Pin down scope, acceptance criteria and edge cases, and find the code involved. Report what you found; never edit.' },
  { name: 'Designer', role: 'UI states & copy', permission: 'read-only', description: 'Reviews what users see: states, copy, layout.', instructions: 'Review every user-facing state (empty, loading, error) plus copy, layout and accessibility. Propose concrete fixes; never edit.' },
  { name: 'Reviewer', role: 'Code review', permission: 'read-only', description: 'Reads the diff for bugs and missing tests.', instructions: 'Read the diff for bugs, risky changes and missing tests. Give concrete, line-level findings and say whether it can ship.' },
  { name: 'DevOps', role: 'Build & release', permission: 'edits', description: 'Keeps build, CI and release scripts healthy.', instructions: 'Own the build, CI and release scripts. Keep pipelines fast and reproducible; never touch production credentials.' },
  { name: 'Security', role: 'Threat modeling & audits', permission: 'read-only', description: 'Looks for security risks in the change.', instructions: 'Look for injection, auth, secret-handling and dependency risks in the change. Rank findings by impact; never edit.' },
  { name: '', role: '', permission: 'read-only', description: '', instructions: '' }
]

/** Team editor: `initial` is an agent id, 'new' for the new-agent form, or undefined for the lead. */
export function TeamDialog({ initial, onClose }: { initial?: string; onClose(): void }) {
  const { project, runId } = useApp()
  const team = useTeam(project.id)
  const runs = useRuns(project.id)
  const [sel, setSel] = useState(initial ?? '')
  const [error, setError] = useState('')
  const pending = useRef<Team | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const box = useRef<HTMLDivElement>(null)

  // Debounced save keeps the local draft (sanitizing mid-typing would eat a trailing space); close adopts main's copy.
  const flush = () => {
    clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (next) void saveTeam(project.id, next).catch((e) => setError(errorText(e)))
  }
  const update = (next: Team) => {
    setTeam(project.id, next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (pending.current) void api.team.save(project.id, pending.current).catch((e) => setError(errorText(e)))
    }, 400)
  }
  const close = () => {
    flush()
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    box.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur() // a NumField commits on blur; do it before close flushes
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      flush()
    }
  }, [])

  if (!team) return null
  const working = workingAgents(runs)
  const lead = team.agents.find((a) => a.lead) ?? team.agents[0]
  const agent = sel === 'new' ? null : (team.agents.find((a) => a.id === sel) ?? lead)
  const run = runs.find((r) => r.id === runId)

  const add = (a: Agent) => {
    update({ ...team, agents: [...team.agents, a] })
    setSel(a.id)
  }
  const reset = () => {
    if (!confirm(t('Replace this project team with the default team? Routing and budget are reset too.'))) return
    update(structuredClone(DEFAULT_TEAM))
    setSel(DEFAULT_TEAM.agents[0].id)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal td" role="dialog" aria-modal="true" aria-labelledby="td-title" tabIndex={-1} ref={box}>
        <div className="modal-head td-head">
          <h3 id="td-title">{t('Agent team')}</h3>
        </div>
        <div className="td-scope">
          <span className="badge">{t('Project team')}</span>
          <span className="muted">{t('Every thread runs on this team. Changes apply live.')}</span>
          {error ? (
            <span className="td-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <div className="td-body">
          <aside className="td-side">
            <div className="td-side-head">
              <div className="micro">{t('Team settings')}</div>
              <div className="td-count">{t('{n} agents', { n: team.agents.length })}</div>
            </div>
            <div className="td-agents" role="list">
              {team.agents.map((a) => (
                <button key={a.id} role="listitem" className={`td-agent${a.id === agent?.id ? ' active' : ''}`} aria-current={a.id === agent?.id ? 'true' : undefined} onClick={() => setSel(a.id)}>
                  <Avatar avatar={a.avatar} color={a.color} size={30} status={working.has(a.id) ? 'working' : 'idle'} />
                  <span className="col td-agent-text">
                    <span className="td-agent-name">{a.name}</span>
                    <span className={`td-state${working.has(a.id) ? ' working' : ''}`}>{working.has(a.id) ? t('working') : t('idle')}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="td-settings">
              <div className="micro">{t('Routing')}</div>
              <button
                className="switch td-switch"
                aria-pressed={team.routing.returnToLead}
                title={t('An agent that ends without a handoff gives the turn back to the Lead.')}
                onClick={() => update({ ...team, routing: { ...team.routing, returnToLead: !team.routing.returnToLead } })}
              >
                {t('Return to Lead')}
              </button>
              <NumField label={t('Hop limit')} title={t('Handoffs the team may make before it waits for you.')} value={team.routing.hopLimit} min={1} max={50} onCommit={(v) => update({ ...team, routing: { ...team.routing, hopLimit: v || team.routing.hopLimit } })} />
              <div className="micro">{t('Budget')}</div>
              <NumField label={t('Turns')} title={t('Agent turns per stretch; empty means no limit.')} value={team.budget.turns} min={0} max={500} onCommit={(v) => update({ ...team, budget: { ...team.budget, turns: v } })} />
              <NumField label={t('Cost $')} title={t('Dollars per stretch, where the engine reports cost; empty means no limit.')} value={team.budget.usd} min={0} max={1000} step={0.5} onCommit={(v) => update({ ...team, budget: { ...team.budget, usd: v } })} />
            </div>
            <div className="td-side-foot col">
              <button className="btn" onClick={reset}>
                <RotateCcw size={13} />
                {t('Reset team')}
              </button>
              <button className="btn dashed" onClick={() => setSel('new')} disabled={team.agents.length >= MAX_AGENTS} aria-pressed={sel === 'new'}>
                <Plus size={13} />
                {t('New agent')}
              </button>
            </div>
          </aside>
          {agent ? (
            <AgentDetail key={agent.id} team={team} agent={agent} working={working.has(agent.id)} run={run} update={update} onClose={close} onRemoved={() => setSel(lead.id)} />
          ) : (
            <NewAgent team={team} onAdd={add} onCancel={() => setSel(lead.id)} />
          )}
        </div>
      </div>
    </div>
  )
}

function AgentDetail({ team, agent, working, run, update, onClose, onRemoved }: { team: Team; agent: Agent; working: boolean; run?: TeamRun; update(t: Team): void; onClose(): void; onRemoved(): void }) {
  const [picking, setPicking] = useState(false)
  const patch = (p: Partial<Agent>) => update({ ...team, agents: team.agents.map((a) => (a.id === agent.id ? { ...a, ...p } : a)) })
  const others = team.agents.filter((a) => a.id !== agent.id)
  const allowed = (id: string) => agent.handoffs.length === 0 || agent.handoffs.includes(id)
  const toggle = (id: string) => {
    const cur = others.filter((o) => allowed(o.id)).map((o) => o.id)
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    if (!next.length) return // an empty list means "anyone", so the last allowed target stays
    patch({ handoffs: next.length === others.length ? [] : next })
  }
  const remove = () => {
    if (!confirm(t('Remove {name} from the team?', { name: agent.name }))) return
    update({ ...team, agents: others.map((a) => ({ ...a, handoffs: a.handoffs.filter((h) => h !== agent.id) })) })
    onRemoved()
  }
  const mine = run?.turns.filter((x) => x.kind === 'agent' && x.agentId === agent.id) ?? []
  const cost = mine.reduce((s, x) => s + (x.costUsd ?? 0), 0)

  return (
    <section className="td-main" aria-label={agent.name}>
      <div className="td-detail-head">
        <button className="td-big-avatar" onClick={() => setPicking(!picking)} aria-expanded={picking} title={t('Change avatar')} aria-label={t('Change avatar')}>
          <Avatar avatar={agent.avatar} color={agent.color} size={44} />
        </button>
        <div className="col grow td-ident">
          <input className="td-name" value={agent.name} maxLength={40} aria-label={t('Name')} onChange={(e) => patch({ name: e.target.value })} />
          <div className="row td-sub">
            <input className="td-role" style={{ color: agent.color }} value={agent.role} maxLength={60} placeholder={t('role')} aria-label={t('Role')} onChange={(e) => patch({ role: e.target.value })} />
            <span className="faint">·</span>
            <span className={`td-state${working ? ' working' : ''}`}>{working ? t('working') : t('idle')}</span>
          </div>
        </div>
        {!agent.lead ? (
          <button className="btn small td-remove" onClick={remove}>
            {t('Remove')}
          </button>
        ) : null}
        <button className="iconbtn" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
          <X size={15} />
        </button>
      </div>
      <div className="td-scroll">
        {picking ? (
          <div className="td-picker">
            <AvatarPicker avatar={agent.avatar} color={agent.color} onChange={patch} />
          </div>
        ) : null}
        <input className="td-desc" value={agent.description} maxLength={300} placeholder={t('One line on what this agent does')} aria-label={t('Description')} onChange={(e) => patch({ description: e.target.value })} />
        <label className="field">
          <span className="micro">{t('Instructions')}</span>
          <textarea className="textarea td-instructions" value={agent.instructions} maxLength={50000} onChange={(e) => patch({ instructions: e.target.value })} />
        </label>
        <div className="td-grid">
          <div className="col td-colgap">
            <div className="col">
              <span className="micro">{t('Engine')}</span>
              <EnginePicker agent={agent} onChange={patch} />
            </div>
            <div className="col">
              <span className="micro">{t('Lead')}</span>
              <div className="row">
                <button className="switch td-lead" aria-pressed={!!agent.lead} disabled={!!agent.lead} onClick={() => update({ ...team, agents: team.agents.map((a) => ({ ...a, lead: a.id === agent.id || undefined })) })}>
                  {agent.lead ? t('Lead') : t('Make lead')}
                </button>
                <span className="faint small">{t('Gets every new goal first and is the only one who can finish it.')}</span>
              </div>
            </div>
            <div className="col">
              <div className="row">
                <span className="micro">{t('Can hand off to')}</span>
                <span className="grow" />
                <span className="micro faint td-hint">{t('click to toggle')}</span>
              </div>
              <div className="col td-handoffs">
                {others.map((o) => (
                  <button key={o.id} className={`td-handoff${allowed(o.id) ? ' on' : ''}`} aria-pressed={allowed(o.id)} onClick={() => toggle(o.id)}>
                    <Avatar avatar={o.avatar} color={o.color} size={20} />
                    <span className="grow">{o.name}</span>
                    <span className="mono td-allowed">{allowed(o.id) ? t('allowed') : '–'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="col td-colgap">
            <div className="col">
              <span className="micro">{t('Permission')}</span>
              <div className="seg" role="group" aria-label={t('Permission')}>
                {PERMISSIONS.map(([p, label]) => (
                  <button key={p} aria-pressed={agent.permission === p} title={t(APPROVAL_LABEL[p].hint)} onClick={() => patch({ permission: p })}>
                    {t(label)}
                  </button>
                ))}
              </div>
              <span className="faint small">{t(APPROVAL_LABEL[agent.permission].hint)}</span>
            </div>
            {run ? (
              <div className="col">
                <span className="micro">{t('This thread')}</span>
                <div className="td-stats">
                  <Stat n={String(mine.length)} label={t('messages')} />
                  <Stat n={String(mine.filter((x) => x.handoff).length)} label={t('handoffs')} />
                  <Stat n={cost ? formatCost(cost) : '–'} label={t('cost')} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="modal-foot td-foot">
        <span className="kbd">Esc</span>
        <span className="faint small">{t('to close')}</span>
        <span className="grow" />
        <span className="mono faint">{t('changes apply live')}</span>
        <button className="btn primary" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
    </section>
  )
}

function NewAgent({ team, onAdd, onCancel }: { team: Team; onAdd(a: Agent): void; onCancel(): void }) {
  const { settings } = useApp()
  const used = new Set(team.agents.map((a) => a.avatar))
  const freePortrait = Array.from({ length: PORTRAIT_COUNT }, (_, i) => `portrait:${i}`).find((p) => !used.has(p)) ?? 'glyph:0'
  const [form, setForm] = useState<Agent>(() => ({
    id: '',
    name: '',
    role: '',
    description: '',
    avatar: freePortrait,
    color: SWATCHES[team.agents.length % SWATCHES.length],
    engine: settings.defaultEngine,
    permission: 'read-only',
    instructions: '',
    handoffs: []
  }))
  const set = (p: Partial<Agent>) => setForm((f) => ({ ...f, ...p }))
  const name = form.name.trim()
  const submit = () => {
    if (!name) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent'
    onAdd({ ...form, name, id: `${slug}-${Date.now().toString(36)}`, role: form.role.trim() || t('Custom'), description: form.description || t('Custom agent.') })
  }

  return (
    <section className="td-main" aria-labelledby="td-new-title">
      <div className="td-new-head">
        <div className="micro">{t('New agent')}</div>
        <h4 id="td-new-title">{t('Define a role')}</h4>
        <p className="muted">{t('Name it, give it a job and the instructions it follows. The Lead can hand work to it right away.')}</p>
      </div>
      <div className="td-scroll">
        <div className="col">
          <span className="micro">{t('Start from')}</span>
          <div className="row td-presets">
            {PRESETS.map((p) => (
              <button key={p.name || 'blank'} className="chip" onClick={() => set(p)}>
                {p.name ? t(p.name) : t('Blank')}
              </button>
            ))}
          </div>
        </div>
        <div className="row td-new-ident">
          <Avatar avatar={form.avatar} color={form.color} size={44} />
          <div className="col grow">
            <input className="input" value={form.name} maxLength={40} placeholder={t('Name — e.g. Security')} aria-label={t('Name')} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <input className="input" value={form.role} maxLength={60} placeholder={t('Role — e.g. Threat modeling & audits')} aria-label={t('Role')} onChange={(e) => set({ role: e.target.value })} />
          </div>
        </div>
        <AvatarPicker avatar={form.avatar} color={form.color} onChange={set} swatches={false} />
        <div className="td-grid">
          <Swatches color={form.color} onChange={(color) => set({ color })} />
          <div className="col">
            <span className="micro">{t('Engine')}</span>
            <EnginePicker agent={form} onChange={set} />
          </div>
        </div>
        <div className="col">
          <span className="micro">{t('Permission')}</span>
          <div className="seg" role="group" aria-label={t('Permission')}>
            {PERMISSIONS.map(([p, label]) => (
              <button key={p} aria-pressed={form.permission === p} title={t(APPROVAL_LABEL[p].hint)} onClick={() => set({ permission: p })}>
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="micro">{t('Instructions')}</span>
          <textarea className="textarea td-instructions" value={form.instructions} maxLength={50000} placeholder={t('What this agent owns, what it must never do, and when it hands off…')} onChange={(e) => set({ instructions: e.target.value })} />
        </label>
      </div>
      <div className="modal-foot td-foot">
        <button className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button className="btn primary grow" onClick={submit} disabled={!name}>
          {t('Add to team')}
        </button>
      </div>
    </section>
  )
}

/** engine · model · effort as one control. */
function EnginePicker({ agent, onChange }: { agent: Pick<Agent, 'engine' | 'model' | 'effort'>; onChange(p: Partial<Agent>): void }) {
  const { engines } = useApp()
  const usable = engines.filter((e) => (e.installed && e.enabled && e.headless) || e.id === agent.engine)
  const info = engines.find((e) => e.id === agent.engine)
  const models = info?.models ?? []
  return (
    <div className="td-engine">
      <EngineIcon engine={agent.engine} size={14} />
      <select aria-label={t('Engine')} value={agent.engine} onChange={(e) => onChange({ engine: e.target.value as EngineId, model: undefined, effort: undefined })}>
        {usable.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
            {!e.installed ? ` (${t('not installed')})` : !e.headless ? ` (${t('terminal only')})` : ''}
          </option>
        ))}
      </select>
      <span className="faint">·</span>
      <select aria-label={t('Model')} value={agent.model ?? ''} onChange={(e) => onChange({ model: e.target.value || undefined })}>
        <option value="">{t('default model')}</option>
        {[...new Set([...models, ...(agent.model ? [agent.model] : [])])].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {info?.efforts.length ? (
        <>
          <span className="faint">·</span>
          <select aria-label={t('Effort')} value={agent.effort ?? ''} onChange={(e) => onChange({ effort: e.target.value || undefined })}>
            <option value="">{t('Default')}</option>
            {info.efforts.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  )
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="td-stat">
      <strong className="mono">{n}</strong>
      <span className="faint small">{label}</span>
    </div>
  )
}

/** Number box committed on blur / Enter, so typing "20" never passes through a clamped "2". 0 shows as "–". */
function NumField({ label, title, value, min, max, step = 1, onCommit }: { label: string; title: string; value: number; min: number; max: number; step?: number; onCommit(v: number): void }) {
  const commit = (raw: string) => {
    if (!raw.trim()) return onCommit(0)
    const v = Number(raw)
    onCommit(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0)
  }
  return (
    <label className="td-num" title={title}>
      <span>{label}</span>
      <input
        key={value}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value || ''}
        placeholder="–"
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

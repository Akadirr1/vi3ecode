import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  CircleX,
  Hammer,
  Hand,
  LoaderCircle,
  Play,
  Plus,
  SearchCheck,
  Square,
  Trash2,
  Waypoints,
  X,
  type LucideIcon
} from 'lucide-react'
import type { ApprovalMode, EngineId, Flow, FlowRun, FlowStep, FlowStepKind, FlowStepStatus } from '../../../shared/types'
import { api } from '../api'
import { useApp, usableEngines } from '../context'
import { t } from '../i18n'
import { EngineIcon } from '../components/EngineIcon'
import { Prose } from '../components/Prose'
import { APPROVAL_LABEL, formatCost, formatDuration, relativeTime } from '../components/format'
import './ext-tools.css'

const KINDS: Record<FlowStepKind, { label: string; icon: LucideIcon; placeholder: string }> = {
  task: { label: 'Task', icon: Hammer, placeholder: 'What this step should do' },
  review: { label: 'Review', icon: SearchCheck, placeholder: 'What the reviewer checks before the flow goes on' },
  gate: { label: 'Gate', icon: Hand, placeholder: 'Question shown when the flow pauses for your approval' }
}

const STATUS: Record<FlowStepStatus, { label: string; icon: LucideIcon; cls: string }> = {
  pending: { label: 'Pending', icon: CircleDashed, cls: 'faint' },
  running: { label: 'Running', icon: LoaderCircle, cls: 'run' },
  done: { label: 'Done', icon: CircleCheck, cls: 'ok' },
  waiting: { label: 'Awaiting approval', icon: CirclePause, cls: 'warn' },
  error: { label: 'Failed', icon: CircleX, cls: 'danger' },
  skipped: { label: 'Skipped', icon: CircleMinus, cls: 'faint' },
  rejected: { label: 'Rejected', icon: Ban, cls: 'danger' }
}

const RUN_BADGE: Record<FlowRun['status'], [string, string]> = {
  running: ['Running', 'brand'],
  waiting: ['Awaiting approval', 'warn'],
  done: ['Done', 'ok'],
  error: ['Failed', 'danger'],
  stopped: ['Stopped', '']
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const newStep = (kind: FlowStepKind, title = t(KINDS[kind].label)): FlowStep => ({
  id: uid('s'),
  kind,
  title,
  prompt: '',
  // A reviewer checks; it should not edit.
  ...(kind === 'review' ? { approval: 'read-only' as ApprovalMode } : {})
})

const newFlow = (): Flow => ({
  version: 1,
  id: uid('flow'),
  name: t('New flow'),
  goal: '',
  steps: [newStep('task', t('Implement')), newStep('review', t('Review')), newStep('gate', t('Approve the result'))],
  updatedAt: Date.now()
})

type Sel = { kind: 'flow'; flow: Flow; saved: boolean } | { kind: 'run'; id: string } | null

export function FlowTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [flows, setFlows] = useState<Flow[] | null>(null)
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setFlows(null)
    setSel(null)
    void api.flows.list(projectId).then(setFlows, (e: Error) => setStatus(e.message))
    void api.flows.runs(projectId).then(setRuns, () => {})
    return api.flows.onRun((run) => {
      if (run.projectId !== projectId) return
      setRuns((rs) => [run, ...rs.filter((r) => r.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [projectId])

  if (!flows) return status ? <div className="empty">{status}</div> : null

  const select = (next: Sel) => {
    if (dirty && !confirm(t('Discard unsaved changes to this flow?'))) return
    setSel(next)
    setDirty(false)
    setStatus('')
  }
  const editFlow = (patch: Partial<Flow>) => {
    setSel((s) => (s?.kind === 'flow' ? { ...s, flow: { ...s.flow, ...patch } } : s))
    setDirty(true)
  }

  const save = async (flow: Flow): Promise<Flow | null> => {
    try {
      const saved = await api.flows.save(projectId, flow)
      setFlows([saved, ...flows.filter((f) => f.id !== saved.id)])
      setSel({ kind: 'flow', flow: saved, saved: true })
      setDirty(false)
      setStatus(t('Saved'))
      return saved
    } catch (e) {
      setStatus((e as Error).message)
      return null
    }
  }
  const run = async (flow: Flow) => {
    const saved = dirty || !(sel?.kind === 'flow' && sel.saved) ? await save(flow) : flow
    if (!saved) return
    try {
      const r = await api.flows.run(projectId, saved.id)
      setRuns((rs) => [r, ...rs.filter((x) => x.id !== r.id)])
      setSel({ kind: 'run', id: r.id })
      setStatus('')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }
  const remove = async (flow: Flow) => {
    if (!confirm(t('Delete the flow "{name}"?', { name: flow.name }))) return
    try {
      await api.flows.remove(projectId, flow.id)
      setFlows(flows.filter((f) => f.id !== flow.id))
      setSel(null)
      setDirty(false)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const selRun = sel?.kind === 'run' ? runs.find((r) => r.id === sel.id) : undefined
  const showList = !docked || !sel
  const showDetail = !docked || !!sel
  const back = docked ? (
    <button className="iconbtn" onClick={() => select(null)} aria-label={t('Back')} title={t('Back')}>
      <ChevronLeft size={15} />
    </button>
  ) : null

  return (
    <div className="xt">
      <div className="xt-bar">
        <span className="badge brand">{t('Beta')}</span>
        <span className="muted small xt-ellipsis">{t('Goals, tasks, reviews and human gates in one run')}</span>
        <div className="grow" />
        <button className="btn primary small" onClick={() => select({ kind: 'flow', flow: newFlow(), saved: false })}>
          <Plus size={13} />
          {t('New flow')}
        </button>
      </div>
      <div className={docked ? 'xt-single' : 'xt-split'}>
        {showList ? (
          <div className="xt-list">
            <div className="micro xt-section">{t('Flows')}</div>
            {flows.map((f) => (
              <button
                key={f.id}
                className={`list-item xt-item${sel?.kind === 'flow' && sel.flow.id === f.id ? ' active' : ''}`}
                onClick={() => select({ kind: 'flow', flow: f, saved: true })}
              >
                <Waypoints size={14} aria-hidden />
                <span className="grow xt-item-title">{f.name}</span>
                <span className="xt-meta">{t('{n} steps', { n: f.steps.length })}</span>
              </button>
            ))}
            {!flows.length ? <div className="faint small xt-none">{t('No flows yet')}</div> : null}
            <div className="micro xt-section">{t('Runs')}</div>
            {runs.map((r) => {
              const doneCount = r.steps.filter((s) => s.status === 'done').length
              return (
                <button
                  key={r.id}
                  className={`list-item xt-item${sel?.kind === 'run' && sel.id === r.id ? ' active' : ''}`}
                  onClick={() => select({ kind: 'run', id: r.id })}
                >
                  <span className={`dot xt-run-dot ${r.status}`} title={t(RUN_BADGE[r.status][0])} aria-hidden />
                  <span className="grow xt-item-title">{r.flowName}</span>
                  <span className="xt-meta">
                    {doneCount}/{r.steps.length} · {relativeTime(r.createdAt)}
                  </span>
                </button>
              )
            })}
            {!runs.length ? <div className="faint small xt-none">{t('No runs yet')}</div> : null}
          </div>
        ) : null}
        {showDetail ? (
          sel?.kind === 'flow' ? (
            <FlowEditor
              flow={sel.flow}
              back={back}
              dirty={dirty}
              saved={sel.saved}
              status={status}
              onChange={editFlow}
              onSave={() => void save(sel.flow)}
              onRun={() => void run(sel.flow)}
              onDelete={() => void remove(sel.flow)}
            />
          ) : selRun ? (
            <RunView run={selRun} flow={flows.find((f) => f.id === selRun.flowId)} back={back} />
          ) : (
            <div className="xt-intro">
              <span className="engine-ico">
                <Waypoints size={15} />
              </span>
              <h3>{t('Flow')}</h3>
              <p className="muted">
                {t('Give a goal, then line up steps: tasks do the work, reviews check it and stop the run on FAIL, gates wait for your approval. Each step picks its own engine, model and permissions.')}
              </p>
              <button className="btn primary small" onClick={() => select({ kind: 'flow', flow: newFlow(), saved: false })}>
                <Plus size={13} />
                {t('New flow')}
              </button>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

interface EditorProps {
  flow: Flow
  back: React.ReactNode
  dirty: boolean
  saved: boolean
  status: string
  onChange(p: Partial<Flow>): void
  onSave(): void
  onRun(): void
  onDelete(): void
}

function FlowEditor({ flow, back, dirty, saved, status, onChange, onSave, onRun, onDelete }: EditorProps) {
  const ctx = useApp()
  const engines = usableEngines(ctx)
  const defaultLabel = ctx.engines.find((e) => e.id === ctx.settings.defaultEngine)?.label ?? ctx.settings.defaultEngine
  const setStep = (i: number, p: Partial<FlowStep>) => onChange({ steps: flow.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const move = (i: number, d: number) => {
    const steps = [...flow.steps]
    ;[steps[i], steps[i + d]] = [steps[i + d], steps[i]]
    onChange({ steps })
  }

  return (
    <div className="xt-editor xt-flow">
      <div className="row">
        {back}
        <input className="xt-title grow" value={flow.name} aria-label={t('Flow name')} onChange={(e) => onChange({ name: e.target.value })} />
        <button className="btn small" disabled={saved && !dirty} onClick={onSave}>
          {t('Save')}
        </button>
        <button className="btn primary small" disabled={!flow.steps.length} onClick={onRun}>
          <Play size={12} />
          {t('Run')}
        </button>
        {saved ? (
          <button className="iconbtn" onClick={onDelete} aria-label={t('Delete flow')} title={t('Delete flow')}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      <div className="xt-meta">
        {t('{n} steps', { n: flow.steps.length })} · .vi3ecode/flows/{flow.id}.json
        {dirty ? ` · ${t('Unsaved changes')}` : status ? ` · ${status}` : ''}
      </div>
      <label className="field">
        <span className="micro">{t('Goal')}</span>
        <textarea
          className="textarea"
          rows={3}
          value={flow.goal}
          placeholder={t('The outcome this flow should deliver. Every step sees it.')}
          onChange={(e) => onChange({ goal: e.target.value })}
        />
      </label>
      <div className="micro">{t('Steps')}</div>
      <ol className="xt-steps">
        {flow.steps.map((s, i) => {
          const engine = engines.find((e) => e.id === (s.engine ?? ctx.settings.defaultEngine))
          return (
            <li key={s.id} className={`xt-step ${s.kind}`}>
              <div className="row">
                <span className="xt-num">{i + 1}</span>
                <div className="seg xt-kinds" role="group" aria-label={t('Step kind')}>
                  {(Object.keys(KINDS) as FlowStepKind[]).map((k) => {
                    const { label, icon: Icon } = KINDS[k]
                    return (
                      <button key={k} aria-pressed={s.kind === k} title={t(label)} onClick={() => setStep(i, { kind: k })}>
                        <Icon size={12} aria-hidden />
                        <span className="xt-kind-label">{t(label)}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="grow" />
                <button className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move step up')} title={t('Move up')}>
                  <ArrowUp size={13} />
                </button>
                <button className="iconbtn" disabled={i === flow.steps.length - 1} onClick={() => move(i, 1)} aria-label={t('Move step down')} title={t('Move down')}>
                  <ArrowDown size={13} />
                </button>
                <button
                  className="iconbtn"
                  onClick={() => onChange({ steps: flow.steps.filter((_, j) => j !== i) })}
                  aria-label={t('Delete step {n}', { n: i + 1 })}
                  title={t('Delete step')}
                >
                  <X size={13} />
                </button>
              </div>
              <input className="input" value={s.title} aria-label={t('Step {n} title', { n: i + 1 })} onChange={(e) => setStep(i, { title: e.target.value })} />
              <textarea
                className="textarea"
                rows={2}
                value={s.prompt}
                aria-label={t('Step {n} instructions', { n: i + 1 })}
                placeholder={t(KINDS[s.kind].placeholder)}
                onChange={(e) => setStep(i, { prompt: e.target.value })}
              />
              {s.kind !== 'gate' ? (
                <div className="row xt-step-opts">
                  <EngineIcon engine={s.engine ?? ctx.settings.defaultEngine} />
                  <select
                    className="select"
                    aria-label={t('Engine')}
                    title={s.engine ? undefined : t('Default engine: {name}', { name: defaultLabel })}
                    value={s.engine ?? ''}
                    onChange={(e) => setStep(i, { engine: (e.target.value || undefined) as EngineId | undefined, model: undefined })}
                  >
                    <option value="">{t('Default')}</option>
                    {engines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input mono"
                    list={`xt-models-${s.id}`}
                    aria-label={t('Model')}
                    placeholder={t('Model')}
                    value={s.model ?? ''}
                    onChange={(e) => setStep(i, { model: e.target.value.trim() || undefined })}
                  />
                  <datalist id={`xt-models-${s.id}`}>
                    {engine?.models.map((m) => <option key={m} value={m} />)}
                  </datalist>
                  <select
                    className="select"
                    aria-label={t('Permissions')}
                    title={t(APPROVAL_LABEL[s.approval ?? 'edits'].hint)}
                    value={s.approval ?? 'edits'}
                    onChange={(e) => setStep(i, { approval: e.target.value as ApprovalMode })}
                  >
                    {Object.entries(APPROVAL_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {t(v.label)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      <div className="row xt-add">
        {(Object.keys(KINDS) as FlowStepKind[]).map((k) => {
          const Icon = KINDS[k].icon
          return (
            <button key={k} className="btn dashed small" onClick={() => onChange({ steps: [...flow.steps, newStep(k)] })}>
              <Plus size={12} aria-hidden />
              <Icon size={12} aria-hidden />
              {t(KINDS[k].label)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RunView({ run, flow, back }: { run: FlowRun; flow?: Flow; back: React.ReactNode }) {
  const [badge, cls] = RUN_BADGE[run.status]
  const live = run.status === 'running' || run.status === 'waiting'
  const lastDone = run.steps.map((s) => s.status).lastIndexOf('done')
  const act = (fn: () => Promise<void>) => void fn().catch((e: Error) => alert(e.message))
  return (
    <div className="xt-editor xt-run">
      <div className="row">
        {back}
        <strong className="grow xt-ellipsis">{run.flowName}</strong>
        <span className={`badge ${cls}`}>{t(badge)}</span>
        {live ? (
          <button className="btn small" onClick={() => act(() => api.flows.stop(run.id))}>
            <Square size={11} />
            {t('Stop')}
          </button>
        ) : null}
      </div>
      <div className="xt-meta">
        {t('{done}/{total} steps', { done: run.steps.filter((s) => s.status === 'done').length, total: run.steps.length })}
        {run.costUsd ? ` · ${formatCost(run.costUsd)}` : ''} · {new Date(run.createdAt).toLocaleString()}
      </div>
      <ol className="xt-timeline">
        {run.steps.map((s, i) => {
          const st = STATUS[s.status]
          const StIcon = st.icon
          const KIcon = KINDS[s.kind].icon
          const question = s.kind === 'gate' ? flow?.steps.find((x) => x.id === s.stepId)?.prompt : ''
          const took = s.startedAt && s.endedAt ? formatDuration(s.endedAt - s.startedAt) : ''
          return (
            <li key={`${s.stepId}-${i}`} className={`xt-tl ${s.status}`}>
              <div className="row">
                <StIcon size={15} className={`xt-st ${st.cls}`} aria-label={t(st.label)} />
                <KIcon size={12} className="faint" aria-hidden />
                <span className="grow xt-item-title">
                  {i + 1}. {s.title}
                </span>
                <span className="xt-meta">{[t(st.label), took, s.costUsd ? formatCost(s.costUsd) : ''].filter(Boolean).join(' · ')}</span>
              </div>
              {s.error ? <div className="xt-error small">{s.error}</div> : null}
              {s.status === 'waiting' && run.status === 'waiting' ? (
                <div className="xt-gate">
                  <p className="small">{question || t('Approve to continue the flow, or reject to end it here.')}</p>
                  <div className="row">
                    <button className="btn primary small" autoFocus onClick={() => act(() => api.flows.decide(run.id, true))}>
                      <Check size={12} />
                      {t('Approve')}
                    </button>
                    <button className="btn small" onClick={() => act(() => api.flows.decide(run.id, false))}>
                      <X size={12} />
                      {t('Reject')}
                    </button>
                  </div>
                </div>
              ) : null}
              {s.text ? (
                <details className="xt-out" open={s.status === 'running' || s.status === 'error' || i === lastDone}>
                  <summary className="micro">{t('Output')}</summary>
                  <Prose text={s.text} />
                </details>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// Flow (beta): steps run in order. Task and review steps are one-shot engine turns; a gate waits for the user.
// Flows live in <project>/.vi3ecode/flows/<id>.json; runs are app-level in userData/flow-runs/<id>.json.
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Flow, FlowRun, FlowRunStep } from '../shared/types'
import { sanitizeFlow } from '../shared/schema'
import { closeSteps, parseVerdict, stepPrompt } from '../shared/flow'
import { getProject, getSettings, userDir } from './store'
import { readJson, writeJson } from './fsutil'
import { getAdapter } from './engines'
import { mcpConfigJson } from './mcp'
import { runTurn, type TurnHandle } from './runner'
import { guardedClaudeTurn } from './engines/claudeSession'
import { emit, notify } from './events'
import { record } from './activity'
import { dataDir } from './project'
import { effectiveFlow, trustFlow } from './trust'

const ID_RE = /^[\w-]{1,64}$/
const flowDir = (projectId: string) => dataDir(projectId, 'flows')
const runFile = (id: string) => userDir('flow-runs', `${id}.json`)

interface Live {
  run: FlowRun
  flow: Flow
  cwd: string
  turn?: TurnHandle
  decide?: (approve: boolean) => void
  stopped: boolean
}

const live = new Map<string, Live>()

function update(run: FlowRun, persist = true): void {
  run.updatedAt = Date.now()
  if (persist) writeJson(runFile(run.id), run)
  emit('flows:run', run)
}

function checkId(id: string): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Invalid flow id')
  return id
}

function readFlows(projectId: string): Flow[] {
  const dir = flowDir(projectId)
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5)))
  } catch {
    return []
  }
  // The file name is the id, whatever the file says, so save/remove always hit the same file.
  return files.map((f) => ({ ...sanitizeFlow(readJson(join(dir, f), null)), id: f.slice(0, -5) })).sort((a, b) => b.updatedAt - a.updatedAt)
}

async function execute(l: Live): Promise<void> {
  const { run, flow } = l
  const started = Date.now()
  for (let i = 0; i < flow.steps.length && !l.stopped; i++) {
    const step = flow.steps[i]
    const rs = run.steps[i]
    rs.status = 'running'
    rs.startedAt = Date.now()
    run.status = 'running'
    update(run)
    if (step.kind === 'gate') {
      rs.status = 'waiting'
      run.status = 'waiting'
      update(run)
      notify(run.flowName, `Waiting for your approval: ${step.title}`)
      const approve = await new Promise<boolean>((resolve) => (l.decide = resolve))
      l.decide = undefined
      if (l.stopped) break
      rs.endedAt = Date.now()
      if (!approve) {
        rs.status = 'rejected'
        rs.error = 'Rejected at the gate'
        return finish(l, 'error', started)
      }
      rs.status = 'done'
      continue
    }
    const engine = step.engine ?? getSettings().defaultEngine
    let error: string | undefined
    try {
      const prompt = stepPrompt(flow, i, run.steps.slice(0, i))
      const approval = step.approval ?? 'edits'
      const onText = (text: string, delta?: boolean) => {
        rs.text = delta || !rs.text ? rs.text + text : `${rs.text}\n\n${text}`
        update(run, false)
      }
      // Claude's own Full access mode skips every prompt, guardrails included; guarded it runs in manual mode.
      l.turn =
        engine === 'claude' && approval === 'full' && getSettings().guardrails
          ? guardedClaudeTurn(l.cwd, { prompt, model: step.model, mcpConfig: mcpConfigJson(run.projectId) }, onText)
          : runTurn(getAdapter(engine), l.cwd, { prompt, model: step.model, approval, mcpConfig: mcpConfigJson(run.projectId) }, (e) => e.type === 'text' && onText(e.text, e.delta))
      const r = await l.turn.done
      l.turn = undefined
      rs.text = r.text || rs.text
      rs.costUsd = r.costUsd
      run.costUsd += r.costUsd ?? 0
      error = r.error
      record({ source: 'flow', kind: `flow.${step.kind}`, outcome: r.stopped ? 'stopped' : error ? 'error' : 'ok', projectId: run.projectId, engine, durationMs: r.durationMs, costUsd: r.costUsd })
    } catch (e) {
      error = (e as Error).message
    }
    if (l.stopped) break
    if (!error && step.kind === 'review') {
      const v = parseVerdict(rs.text)
      if (!v) error = 'The review ended without a VERDICT line.'
      else if (!v.pass) error = `Review failed${v.reason ? `: ${v.reason}` : ''}`
    }
    rs.endedAt = Date.now()
    if (error) {
      rs.status = 'error'
      rs.error = error
      return finish(l, 'error', started)
    }
    rs.status = 'done'
  }
  finish(l, l.stopped ? 'stopped' : 'done', started)
}

function finish(l: Live, status: 'done' | 'error' | 'stopped', started: number): void {
  const { run } = l
  run.steps = closeSteps(run.steps, 'Stopped')
  run.status = status
  live.delete(run.id)
  update(run)
  record({ source: 'flow', kind: 'flow.run', outcome: status === 'done' ? 'ok' : status, projectId: run.projectId, durationMs: Date.now() - started, costUsd: run.costUsd })
  if (status !== 'stopped') notify(run.flowName, status === 'done' ? 'Flow finished' : 'Flow failed')
}

export const flowsApi = {
  async list(projectId: string): Promise<Flow[]> {
    return readFlows(projectId)
  },
  async save(projectId: string, flow: Flow): Promise<Flow> {
    const clean = sanitizeFlow({ ...flow, updatedAt: Date.now() })
    const before = readFlows(projectId).find((f) => f.id === clean.id) ?? null
    writeJson(join(flowDir(projectId), `${clean.id}.json`), clean)
    trustFlow(getProject(projectId).path, clean, before)
    return clean
  },
  async remove(projectId: string, id: string): Promise<void> {
    rmSync(join(flowDir(projectId), `${checkId(id)}.json`), { force: true })
  },
  async runs(projectId: string): Promise<FlowRun[]> {
    getProject(projectId)
    let files: string[] = []
    try {
      files = readdirSync(userDir('flow-runs')).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    return files
      .map((f) => live.get(f.slice(0, -5))?.run ?? readJson<FlowRun | null>(userDir('flow-runs', f), null))
      .filter((r): r is FlowRun => !!r && r.projectId === projectId && Array.isArray(r.steps))
      // Runs cut off by an app exit stay on disk as running/waiting; show them as stopped.
      .map((r) => (live.has(r.id) || (r.status !== 'running' && r.status !== 'waiting') ? r : { ...r, status: 'stopped' as const, steps: closeSteps(r.steps, 'Interrupted: the app was closed') }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
  },
  async run(projectId: string, flowId: string): Promise<FlowRun> {
    const found = readFlows(projectId).find((f) => f.id === checkId(flowId))
    if (!found) throw new Error('Flow not found')
    const flow = effectiveFlow(getProject(projectId).path, found)
    if (!flow.steps.length) throw new Error('Add at least one step before running the flow.')
    const now = Date.now()
    const run: FlowRun = {
      id: randomUUID(),
      flowId: flow.id,
      flowName: flow.name,
      projectId,
      status: 'running',
      steps: flow.steps.map((s): FlowRunStep => ({ stepId: s.id, title: s.title, kind: s.kind, status: 'pending', text: '' })),
      costUsd: 0,
      createdAt: now,
      updatedAt: now
    }
    const l: Live = { run, flow, cwd: getProject(projectId).path, stopped: false }
    live.set(run.id, l)
    update(run)
    void execute(l).catch((e: Error) => {
      const rs = run.steps.find((s) => s.status === 'running')
      if (rs) rs.error = e.message
      finish(l, 'error', now)
    })
    return run
  },
  async decide(runId: string, approve: boolean): Promise<void> {
    const l = live.get(runId)
    if (!l?.decide) throw new Error('This run is not waiting at a gate.')
    l.decide(approve === true)
  },
  async stop(runId: string): Promise<void> {
    const l = live.get(runId)
    if (!l) return
    l.stopped = true
    l.turn?.stop()
    l.decide?.(false)
  }
}

export function stopAllFlows(): void {
  for (const id of live.keys()) void flowsApi.stop(id)
}

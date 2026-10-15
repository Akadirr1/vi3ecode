// Agent mode: a goal goes to the lead; every turn ends in a handoff or a done. With auto-handoff on,
// the next turn starts by itself until the hop cap or the budget stops the chain.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import type { Team, TeamRun, TeamTurn } from '../shared/types'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { buildTeamPrompt, decideNext, leadOf, parseTurnEnd } from '../shared/prompt'
import { getProject, getSettings, userDir } from './store'
import { listMemory, readTeam, reindexMemory, writeTeam } from './project'
import { getAdapter } from './engines'
import { runTurn, type TurnHandle } from './runner'
import { emit } from './events'
import { record, registerLive } from './activity'
import { readJson, writeJson } from './fsutil'

interface RunState {
  run: TeamRun
  handle?: TurnHandle
  /** Hop count when the user last (re)started the chain; the cap applies from here. */
  hopBase: number
  /** Spend when the user last (re)started the chain; the budget applies from here. */
  costBase: number
}

const runs = new Map<string, RunState>()
let loaded = false
const ID_RE = /^[\w-]{1,64}$/
const file = (id: string) => userDir('team-runs', `${id}.json`)

registerLive('runningTeams', () => [...runs.values()].filter((r) => r.run.status === 'running').length)
registerLive('waitingTeams', () => [...runs.values()].filter((r) => r.run.status === 'waiting').length)

function loadAll(): void {
  if (loaded) return
  loaded = true
  let names: string[] = []
  try {
    names = readdirSync(userDir('team-runs'))
  } catch {
    return
  }
  for (const n of names) {
    const run = readJson<TeamRun | null>(userDir('team-runs', n), null)
    if (!run || !ID_RE.test(run.id) || !Array.isArray(run.turns)) continue
    if (run.status === 'running') {
      run.status = 'stopped' // a turn cannot survive an app restart
      for (const t of run.turns) if (t.status === 'running') t.status = 'stopped'
    }
    runs.set(run.id, { run, hopBase: run.hops, costBase: run.costUsd })
  }
}

function save(r: TeamRun): void {
  mkdirSync(userDir('team-runs'), { recursive: true })
  writeJson(file(r.id), r)
}

let timer: NodeJS.Timeout | null = null
const dirty = new Set<string>()
function push(r: TeamRun, now = false): void {
  r.updatedAt = Date.now()
  dirty.add(r.id)
  if (now) return flush()
  timer ??= setTimeout(flush, 120)
}
function flush(): void {
  if (timer) clearTimeout(timer)
  timer = null
  for (const id of dirty) {
    const s = runs.get(id)
    if (s) emit('team:run', s.run)
  }
  dirty.clear()
}

/** `git status --porcelain` lines, or null outside a repository. */
function gitStatus(cwd: string): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain=v1', '-uall'], { cwd, timeout: 5000, windowsHide: true }, (err, out) =>
      resolve(err ? null : new Set(out.split('\n').filter(Boolean)))
    )
  })
}

function finish(state: RunState, status: TeamRun['status']): void {
  state.run.status = status
  state.handle = undefined
  save(state.run)
  push(state.run, true)
  if (status !== 'running' && status !== 'waiting') {
    record({ source: 'team', kind: `run-${status}`, outcome: status === 'done' ? 'ok' : status === 'error' ? 'error' : status === 'stopped' ? 'stopped' : 'info', projectId: state.run.projectId, costUsd: state.run.costUsd })
  }
}

async function runNext(state: RunState): Promise<void> {
  const { run } = state
  // A function, so TypeScript does not narrow away the stop() that can land during an await.
  const stopped = () => run.status === 'stopped'
  if (stopped()) return
  const settings = getSettings()
  if (settings.budgetUsd > 0 && run.costUsd - state.costBase >= settings.budgetUsd) return finish(state, 'budget')
  if (run.hops - state.hopBase >= settings.hopCap) return finish(state, 'hop-cap')

  const team = readTeam(run.projectId)
  const lead = leadOf(team)
  const agent = team.agents.find((a) => a.id === run.next?.agentId) ?? lead
  const note = run.next?.note
  const from = [...run.turns].reverse().find((t) => t.status !== 'running')?.agentName
  const adapter = getAdapter(agent.engine)
  const cwd = getProject(run.projectId).path

  const turn: TeamTurn = { id: randomUUID(), agentId: agent.id, agentName: agent.name, engine: agent.engine, text: '', tools: [], filesTouched: [], status: 'running', startedAt: Date.now() }
  run.turns.push(turn)
  run.next = undefined
  run.status = 'running'
  push(run, true)

  if (!adapter.build) {
    turn.status = 'error'
    turn.error = `${adapter.label} runs in the terminal only; pick a headless engine for ${agent.name}.`
    turn.endedAt = Date.now()
    run.next = { agentId: agent.id, note: note ?? '' }
    return finish(state, 'error')
  }

  const system: string[] = []
  if (settings.memoryInject) {
    const brief = buildBrief(listMemory(run.projectId))
    if (brief) system.push(brief)
  }
  if (settings.memoryWriteBack && agent.permission !== 'read-only') system.push(WRITE_BACK_INSTRUCTION)

  const prompt = buildTeamPrompt({ team, agent, goal: run.goal, turns: run.turns.slice(0, -1), note, from })
  const before = await gitStatus(cwd)
  if (stopped()) {
    turn.status = 'stopped'
    turn.endedAt = Date.now()
    return finish(state, 'stopped')
  }
  const handle = runTurn(adapter, cwd, { prompt, system: system.join('\n\n') || undefined, model: agent.model, approval: agent.permission }, (e) => {
    if (e.type === 'text') {
      turn.text += e.delta || !turn.text ? e.text : `\n\n${e.text}`
      push(run)
    } else if (e.type === 'tool') {
      turn.tools.push(e.name)
      push(run)
    }
  })
  state.handle = handle
  const r = await handle.done
  const after = await gitStatus(cwd)

  turn.text = r.text || turn.text
  turn.costUsd = r.costUsd
  turn.endedAt = Date.now()
  const changed = new Set(r.files)
  if (before && after) for (const line of after) if (!before.has(line)) changed.add(line.slice(3).replace(/^"|"$/g, ''))
  turn.filesTouched = [...changed].slice(0, 200)
  run.costUsd += r.costUsd ?? 0
  if (settings.memoryWriteBack) {
    try {
      reindexMemory(run.projectId)
    } catch {
      // best-effort
    }
  }
  record({ source: 'team', kind: 'turn', outcome: r.stopped ? 'stopped' : r.error ? 'error' : 'ok', projectId: run.projectId, engine: agent.engine, durationMs: r.durationMs, costUsd: r.costUsd })

  if (r.stopped || stopped()) {
    turn.status = 'stopped'
    return finish(state, 'stopped')
  }
  if (r.error) {
    turn.status = 'error'
    turn.error = r.error
    run.next = { agentId: agent.id, note: note ?? '' } // continue = retry this agent
    return finish(state, 'error')
  }
  turn.status = 'done'
  const end = parseTurnEnd(turn.text, team.agents.map((a) => a.name))
  if (end.handoff) turn.handoff = end.handoff
  if (end.done !== undefined) turn.done = end.done
  const next = decideNext(team, agent, end)
  if (next.kind === 'done') return finish(state, 'done')
  run.hops++
  if (next.kind === 'wait') {
    run.next = { agentId: lead.id, note: next.reason }
    return finish(state, 'waiting')
  }
  run.next = { agentId: next.agentId, note: next.note }
  if (!settings.autoHandoff) return finish(state, 'waiting')
  save(run)
  return runNext(state)
}

function launch(state: RunState): void {
  runNext(state).catch((err: unknown) => {
    const t = state.run.turns.at(-1)
    if (t?.status === 'running') {
      t.status = 'error'
      t.error = String(err instanceof Error ? err.message : err)
      t.endedAt = Date.now()
    }
    finish(state, 'error')
  })
}

function getState(id: string): RunState {
  loadAll()
  const s = ID_RE.test(id) ? runs.get(id) : undefined
  if (!s) throw new Error(`Unknown run: ${id}`)
  return s
}

export const teamApi = {
  async get(projectId: string): Promise<Team> {
    return readTeam(projectId)
  },
  async save(projectId: string, team: Team): Promise<Team> {
    return writeTeam(projectId, team)
  },
  async runs(projectId: string): Promise<TeamRun[]> {
    loadAll()
    return [...runs.values()].map((s) => s.run).filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)
  },
  async start(projectId: string, goal: string): Promise<TeamRun> {
    loadAll()
    getProject(projectId)
    const text = String(goal ?? '').trim().slice(0, 20_000)
    if (!text) throw new Error('Write a goal first.')
    const team = readTeam(projectId)
    const run: TeamRun = { id: randomUUID(), projectId, goal: text, status: 'running', turns: [], hops: 0, costUsd: 0, next: { agentId: leadOf(team).id, note: '' }, createdAt: Date.now(), updatedAt: Date.now() }
    const state: RunState = { run, hopBase: 0, costBase: 0 }
    runs.set(run.id, state)
    save(run)
    launch(state)
    return run
  },
  async continue(runId: string, agentId?: string): Promise<void> {
    const state = getState(runId)
    if (state.run.status === 'running') return
    const team = readTeam(state.run.projectId)
    const pick = agentId ? team.agents.find((a) => a.id === agentId) : undefined
    state.run.next = { agentId: pick?.id ?? state.run.next?.agentId ?? leadOf(team).id, note: state.run.next?.note ?? '' }
    // Pressing continue is consent for another stretch: the hop cap and budget restart from here.
    state.hopBase = state.run.hops
    state.costBase = state.run.costUsd
    state.run.status = 'running'
    launch(state)
  },
  async stop(runId: string): Promise<void> {
    const state = getState(runId)
    if (state.handle) {
      state.run.status = 'stopped'
      state.handle.stop()
    } else if (state.run.status !== 'done') finish(state, 'stopped')
  }
}

export function stopAllRuns(): void {
  for (const s of runs.values()) {
    if (s.handle) {
      s.run.status = 'stopped'
      s.handle.stop()
    }
  }
}

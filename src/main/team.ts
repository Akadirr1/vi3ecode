// Agent mode: a thread goes to the lead; every turn ends in a handoff or a done. With auto-relay on,
// the next turn starts by itself until the hop limit or the budget pauses the chain. The user can write
// into the thread at any time: a running Claude turn is steered, otherwise the next turn reads it.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { Agent, Team, TeamRun, TeamTurn } from '../shared/types'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { buildTeamPrompt, decideNext, findAgent, leadOf, parseTurnEnd } from '../shared/prompt'
import { getProject, getSettings, userDir } from './store'
import { listMemory, readTeam, reindexMemory, writeTeam } from './project'
import { getAdapter, setUsage } from './engines'
import { ClaudeSession, type PermissionRequest } from './engines/claudeSession'
import { runTurn, type TurnResult } from './runner'
import { describe } from './chat'
import { mcpConfigFor } from './plugins'
import { emit } from './events'
import { record, registerLive } from './activity'
import { readJson, writeJson } from './fsutil'

interface AgentTurn {
  done: Promise<TurnResult>
  stop(): void
  /** Claude only: fold a user message into the running turn. */
  steer?(text: string): void
}

interface RunState {
  run: TeamRun
  turn?: AgentTurn
  turnAgentId?: string
  /** Hop/turn count and spend when the user last (re)started the chain; limits apply from here. */
  hopBase: number
  turnBase: number
  costBase: number
  /** The user addressed an agent mid-run: it goes next, whatever the handoff said. */
  redirect?: string
}

const runs = new Map<string, RunState>()
const requests = new Map<string, { runId: string; req: PermissionRequest; cs: ClaudeSession }>()
let loaded = false
const ID_RE = /^[\w-]{1,64}$/
const file = (id: string) => userDir('team-runs', `${id}.json`)

registerLive('runningTeams', () => [...runs.values()].filter((r) => r.run.status === 'running').length)
registerLive('waitingTeams', () => [...runs.values()].filter((r) => r.run.status === 'waiting' || r.run.pending.length > 0).length)

const agentTurns = (r: TeamRun) => r.turns.filter((t) => t.kind !== 'user').length

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
    for (const t of run.turns) t.kind ??= 'agent'
    if (run.status === 'running') {
      run.status = 'stopped' // a turn cannot survive an app restart
      for (const t of run.turns) if (t.status === 'running') t.status = 'stopped'
    }
    run.pending = []
    runs.set(run.id, { run, hopBase: run.hops, turnBase: agentTurns(run), costBase: run.costUsd })
  }
}

function save(r: TeamRun): void {
  mkdirSync(userDir('team-runs'), { recursive: true })
  writeJson(file(r.id), { ...r, pending: [] })
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
  state.turn = undefined
  state.turnAgentId = undefined
  save(state.run)
  push(state.run, true)
  if (status !== 'running' && status !== 'waiting') {
    record({ source: 'team', kind: `run-${status}`, outcome: status === 'done' ? 'ok' : status === 'error' ? 'error' : status === 'stopped' ? 'stopped' : 'info', projectId: state.run.projectId, costUsd: state.run.costUsd })
  }
}

function startAgentTurn(state: RunState, team: Team, agent: Agent, cwd: string, prompt: string, onText: (t: string, delta?: boolean) => void, onTool: (n: string) => void): AgentTurn {
  const adapter = getAdapter(agent.engine)
  if (agent.engine !== 'claude') {
    return runTurn(adapter, cwd, { prompt, model: agent.model, effort: agent.effort, approval: agent.permission }, (e) => {
      if (e.type === 'text') onText(e.text, e.delta)
      else if (e.type === 'tool') onTool(e.name)
    })
  }
  // Claude: a stream-json process for this one turn, so `ask` can raise approval cards in the thread.
  const run = state.run
  let resolve!: (r: TurnResult) => void
  const done = new Promise<TurnResult>((r) => (resolve = r))
  let settled = false
  const settle = (r: TurnResult) => {
    if (settled) return
    settled = true
    for (const [id, x] of requests) if (x.cs === cs) requests.delete(id)
    run.pending = run.pending.filter((p) => requests.has(p.id))
    resolve(r)
    cs.close()
  }
  const cs: ClaudeSession = new ClaudeSession({
    cwd,
    approval: agent.permission,
    model: agent.model,
    effort: agent.effort,
    mcpConfig: mcpConfigFor(run.projectId),
    onTurnStart: () => {},
    onText: (t) => onText(t),
    onTool: (n) => onTool(n),
    onSession: () => {},
    onRateLimit: (info) => setUsage('claude', info),
    onPermission: (req) => {
      if (team.routing.autoApprove && agent.permission !== 'read-only') return cs.respond(req.id, req, true)
      requests.set(req.id, { runId: run.id, req, cs })
      run.pending.push({ id: req.id, tool: req.tool, detail: describe(req), ts: Date.now(), agentId: agent.id })
      push(run, true)
    },
    onTurnEnd: (r) => settle({ text: r.text, tools: r.tools, files: r.files, costUsd: r.costUsd, error: r.error, stopped: r.interrupted, durationMs: r.durationMs }),
    onExit: (error) => settle({ text: '', tools: [], files: [], error: error ?? 'Claude Code exited before finishing the turn.', stopped: false, durationMs: 0 })
  })
  cs.send(prompt)
  return {
    done,
    stop: () => {
      cs.interrupt()
      setTimeout(() => {
        if (!settled) {
          cs.kill()
          settle({ text: '', tools: [], files: [], stopped: true, durationMs: 0 })
        }
      }, 3000).unref()
    },
    steer: (text) => cs.send(text)
  }
}

async function runNext(state: RunState): Promise<void> {
  const { run } = state
  // A function, so TypeScript does not narrow away the stop() that can land during an await.
  const stopped = () => run.status === 'stopped'
  if (stopped()) return
  const team = readTeam(run.projectId)
  const settings = getSettings()
  const { budget, routing } = team
  if (budget.usd > 0 && run.costUsd - state.costBase >= budget.usd) return finish(state, 'budget')
  if (budget.turns > 0 && agentTurns(run) - state.turnBase >= budget.turns) return finish(state, 'budget')
  if (run.hops - state.hopBase >= routing.hopLimit) return finish(state, 'hop-cap')

  const lead = leadOf(team)
  const agent = team.agents.find((a) => a.id === run.next?.agentId) ?? lead
  const note = run.next?.note
  const from = [...run.turns].reverse().find((t) => t.kind === 'agent' && t.status !== 'running')?.agentName
  const adapter = getAdapter(agent.engine)
  const cwd = getProject(run.projectId).path

  const turn: TeamTurn = { id: randomUUID(), kind: 'agent', agentId: agent.id, agentName: agent.name, engine: agent.engine, text: '', tools: [], filesTouched: [], status: 'running', startedAt: Date.now() }
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
  const body = buildTeamPrompt({ team, agent, goal: run.goal, turns: run.turns.slice(0, -1), note, from })
  const prompt = system.length ? `${system.join('\n\n')}\n\n---\n\n${body}` : body

  const before = await gitStatus(cwd)
  if (stopped()) {
    turn.status = 'stopped'
    turn.endedAt = Date.now()
    return finish(state, 'stopped')
  }
  const handle = startAgentTurn(
    state,
    team,
    agent,
    cwd,
    prompt,
    (t, delta) => {
      turn.text += delta || !turn.text ? t : `\n\n${t}`
      push(run)
    },
    (n) => {
      turn.tools.push(n)
      push(run)
    }
  )
  state.turn = handle
  state.turnAgentId = agent.id
  const r = await handle.done
  state.turn = undefined
  state.turnAgentId = undefined
  run.pending = run.pending.filter((p) => p.agentId !== agent.id)
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

  // The user addressed someone mid-turn: they go next and read the message from the transcript.
  if (state.redirect) {
    const to = team.agents.find((a) => a.id === state.redirect) ?? lead
    state.redirect = undefined
    run.hops++
    run.next = { agentId: to.id, note: 'The user wrote to you in the thread; read their latest message.' }
    save(run)
    return runNext(state)
  }
  const next = decideNext(team, agent, end)
  if (next.kind === 'done') return finish(state, 'done')
  run.hops++
  if (next.kind === 'wait') {
    run.next = { agentId: lead.id, note: next.reason }
    return finish(state, 'waiting')
  }
  run.next = { agentId: next.agentId, note: next.note }
  if (!routing.autoRelay) return finish(state, 'waiting')
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

/** Starting or resuming a stretch is consent for another round of hops, turns and spend. */
function restart(state: RunState, agentId: string, note: string): void {
  state.hopBase = state.run.hops
  state.turnBase = agentTurns(state.run)
  state.costBase = state.run.costUsd
  state.run.next = { agentId, note }
  state.run.status = 'running'
  launch(state)
}

function getState(id: string): RunState {
  loadAll()
  const s = ID_RE.test(id) ? runs.get(id) : undefined
  if (!s) throw new Error(`Unknown thread: ${id}`)
  return s
}

const userTurn = (text: string, to?: Agent): TeamTurn => ({
  id: randomUUID(),
  kind: 'user',
  to: to?.name,
  agentId: '',
  agentName: 'You',
  engine: 'claude',
  text,
  tools: [],
  filesTouched: [],
  status: 'done',
  startedAt: Date.now(),
  endedAt: Date.now()
})

export const teamApi = {
  async get(projectId: string): Promise<Team> {
    return readTeam(projectId)
  },
  async save(projectId: string, team: Team): Promise<Team> {
    return writeTeam(projectId, team)
  },
  async runs(projectId: string): Promise<TeamRun[]> {
    loadAll()
    return [...runs.values()].map((s) => s.run).filter((r) => r.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async start(projectId: string, goal: string, to?: string): Promise<TeamRun> {
    loadAll()
    getProject(projectId)
    const text = String(goal ?? '').trim().slice(0, 20_000)
    if (!text) throw new Error('Write a goal first.')
    const team = readTeam(projectId)
    const target = (to && team.agents.find((a) => a.id === to)) || leadOf(team)
    const run: TeamRun = {
      id: randomUUID(),
      projectId,
      goal: text,
      status: 'running',
      turns: [userTurn(text, to ? target : undefined)],
      hops: 0,
      costUsd: 0,
      pending: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const state: RunState = { run, hopBase: 0, turnBase: 0, costBase: 0 }
    runs.set(run.id, state)
    save(run)
    restart(state, target.id, '')
    return run
  },
  async send(runId: string, text: string, to?: string): Promise<void> {
    const state = getState(runId)
    const body = String(text ?? '').trim().slice(0, 20_000)
    if (!body) return
    const team = readTeam(state.run.projectId)
    const target = to ? (team.agents.find((a) => a.id === to) ?? findAgent(team, to)) : undefined
    state.run.turns.push(userTurn(body, target))
    if (state.run.status === 'running') {
      // Steer the running Claude turn when the message is for whoever is working (or for nobody in particular).
      if (state.turn?.steer && (!target || target.id === state.turnAgentId)) state.turn.steer(`Message from the user, sent while you work: ${body}`)
      else if (target) state.redirect = target.id
      save(state.run)
      push(state.run, true)
      return
    }
    save(state.run)
    restart(state, (target ?? leadOf(team)).id, 'The user wrote to you in the thread; read their latest message.')
  },
  async continue(runId: string, agentId?: string): Promise<void> {
    const state = getState(runId)
    if (state.run.status === 'running') return
    const team = readTeam(state.run.projectId)
    const pick = agentId ? team.agents.find((a) => a.id === agentId) : undefined
    restart(state, pick?.id ?? state.run.next?.agentId ?? leadOf(team).id, state.run.next?.note ?? '')
  },
  async respond(runId: string, approvalId: string, allow: boolean): Promise<void> {
    const state = getState(runId)
    const r = requests.get(approvalId)
    const pending = state.run.pending.find((p) => p.id === approvalId)
    state.run.pending = state.run.pending.filter((p) => p.id !== approvalId)
    requests.delete(approvalId)
    if (r && r.runId === runId && r.cs.alive) {
      const agent = readTeam(state.run.projectId).agents.find((a) => a.id === pending?.agentId)
      r.cs.respond(approvalId, r.req, !!allow && agent?.permission !== 'read-only')
      record({ source: 'team', kind: allow ? 'approval-allowed' : 'approval-denied', outcome: 'info', projectId: state.run.projectId, engine: 'claude' })
    }
    push(state.run, true)
  },
  async stop(runId: string): Promise<void> {
    const state = getState(runId)
    if (state.turn) {
      state.run.status = 'stopped'
      state.turn.stop()
    } else if (state.run.status !== 'done') finish(state, 'stopped')
  },
  async remove(runId: string): Promise<void> {
    const state = getState(runId)
    state.run.status = 'stopped'
    state.turn?.stop()
    runs.delete(runId)
    rmSync(file(runId), { force: true })
  }
}

export function stopAllRuns(): void {
  for (const s of runs.values()) {
    if (s.turn) {
      s.run.status = 'stopped'
      s.turn.stop()
    }
  }
}

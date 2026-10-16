// Agent mode: a thread goes to the lead; every turn ends in a handoff or a done. With auto-relay on,
// the next turn starts by itself until the hop limit or the budget pauses the chain. The user can write
// into the thread at any time: a running Claude turn is steered, otherwise the next turn reads it.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { Agent, GlobalTeam, Team, TeamRun, TeamTurn } from '../shared/types'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { buildTeamPrompt, decideNext, findAgent, leadOf, parseTurnEnd } from '../shared/prompt'
import { matchGuardrail } from '../shared/guardrails'
import { getProject, getSettings, userDir } from './store'
import { applyMemoryWrites, listMemory, readTeam, writeTeam } from './project'
import { getAdapter, setUsage } from './engines'
import { ClaudeSession, type PermissionRequest } from './engines/claudeSession'
import { runTurn, type TurnResult } from './runner'
import { GIT_FLAGS, gitExe } from './git'
import { confirmTeam, effectiveTeam, trustTeam, unconfirmedTeam } from './trust'
import { describe } from './chat'
import { mcpConfigJson } from './mcp'
import { BROWSER_ACT_TOOLS, BROWSER_READ_TOOLS } from './browserBridge'
import { emit, notify } from './events'
import { record, registerLive } from './activity'
import { readJson, writeJson } from './fsutil'
import { sanitizeTeam } from '../shared/schema'

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
  /** A parallel wave in progress: who issued it, who still has to run, and the shared brief. */
  wave?: { from: string; queue: string[]; members: string[]; note: string }
  /** Engine session per agent (resumed on its next turn) and the index of its last turn in the thread. */
  sessions: Map<string, { sessionId?: string; lastTurn: number }>
  /** Turns of a thread run one after another: a restart waits for a stopped turn to wind down. */
  chain?: Promise<void>
  /** Bumped by every restart and stop; a queued launch from an older one does not start. */
  gen: number
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
    runs.set(run.id, { run, hopBase: run.hops, turnBase: agentTurns(run), costBase: run.costUsd, sessions: new Map(), gen: 0 })
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
    execFile(gitExe(), [...GIT_FLAGS, 'status', '--porcelain=v1', '-uall'], { cwd, timeout: 5000, windowsHide: true }, (err, out) =>
      resolve(err ? null : new Set(out.split('\n').filter(Boolean)))
    )
  })
}

function finish(state: RunState, status: TeamRun['status']): void {
  state.run.status = status
  state.turn = undefined
  state.turnAgentId = undefined
  if (status !== 'running') state.redirect = undefined
  save(state.run)
  push(state.run, true)
  if (status !== 'running') notify(`Agent thread ${status === 'done' ? 'finished' : status}`, state.run.goal.split('\n')[0])
  if (status !== 'running' && status !== 'waiting') {
    record({ source: 'team', kind: `run-${status}`, outcome: status === 'done' ? 'ok' : status === 'error' ? 'error' : status === 'stopped' ? 'stopped' : 'info', projectId: state.run.projectId, costUsd: state.run.costUsd })
  }
}

function startAgentTurn(
  state: RunState,
  team: Team,
  agent: Agent,
  cwd: string,
  prompt: string,
  resumeId: string | undefined,
  onText: (t: string, delta?: boolean) => void,
  onTool: (n: string) => void
): AgentTurn {
  const adapter = getAdapter(agent.engine)
  if (agent.engine !== 'claude') {
    const opts = { prompt, model: agent.model, effort: agent.effort, approval: agent.permission, resumeId: adapter.resumes ? resumeId : undefined, mcpConfig: mcpConfigJson(state.run.projectId) }
    return runTurn(adapter, cwd, opts, (e) => {
      if (e.type === 'text') onText(e.text, e.delta)
      else if (e.type === 'tool') onTool(e.name)
    })
  }
  // Claude: a stream-json process for this one turn, so `ask` can raise approval cards in the thread.
  const run = state.run
  let resolve!: (r: TurnResult) => void
  const done = new Promise<TurnResult>((r) => (resolve = r))
  let settled = false
  let sessionId: string | undefined
  const settle = (r: TurnResult) => {
    if (settled) return
    settled = true
    r.sessionId ??= sessionId
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
    resumeId,
    mcpConfig: mcpConfigJson(run.projectId),
    guarded: getSettings().guardrails,
    allowedTools: getSettings().browserTools ? [...BROWSER_READ_TOOLS, ...(agent.permission === 'read-only' ? [] : BROWSER_ACT_TOOLS)] : undefined,
    onTurnStart: () => {},
    onText: (t, delta) => onText(t, delta),
    onTool: (n, _f, detail) => onTool(detail ? `${n} ${detail}` : n),
    onSession: (sid) => (sessionId = sid),
    onRateLimit: (info) => setUsage('claude', info),
    onPermission: (req) => {
      const rule = getSettings().guardrails ? matchGuardrail(req.toolName, req.input) : null
      if (!rule && agent.permission !== 'read-only' && (team.routing.autoApprove || agent.permission === 'full')) return cs.respond(req.id, req, true)
      requests.set(req.id, { runId: run.id, req, cs })
      run.pending.push({ id: req.id, tool: req.tool, detail: describe(req, cwd), ts: Date.now(), agentId: agent.id, ...(rule ? { guardrail: rule.title } : {}) })
      notify(`${agent.name} needs approval`, `${req.tool} ${describe(req, cwd)}`)
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
  // A function, so TypeScript does not narrow away the stop() that can land during an await; a stop followed by a
  // quick restart (gen moved on) also ends this chain, which must not route the new stretch.
  const gen = state.gen
  const stopped = () => run.status === 'stopped' || gen !== state.gen
  if (stopped()) return
  const cwd = getProject(run.projectId).path
  const team = effectiveTeam(cwd, readTeam(run.projectId))
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
  if (settings.memoryWriteBack) system.push(WRITE_BACK_INSTRUCTION) // a reply line, so read-only agents can write memory too
  const prior = state.sessions.get(agent.id)
  const adapterResumes = agent.engine === 'claude' || !!adapter.resumes
  const resumeId = adapterResumes ? prior?.sessionId : undefined
  const waveMembers = state.wave && state.wave.members.includes(agent.id) ? state.wave.members.filter((m) => m !== agent.id) : undefined
  const body = buildTeamPrompt({
    team,
    agent,
    goal: run.goal,
    turns: run.turns.slice(0, -1),
    note,
    from,
    since: resumeId ? prior!.lastTurn : undefined,
    wave: waveMembers?.map((id) => team.agents.find((a) => a.id === id)?.name ?? id)
  })
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
    resumeId,
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
  // A turn that failed without a session (e.g. an expired one could not be resumed) starts fresh next time.
  state.sessions.set(agent.id, { sessionId: r.sessionId ?? (r.error ? undefined : resumeId), lastTurn: run.turns.indexOf(turn) })
  turn.endedAt = Date.now()
  const changed = new Set(r.files)
  if (before && after) for (const line of after) if (!before.has(line)) changed.add(line.slice(3).replace(/^"|"$/g, ''))
  turn.filesTouched = [...changed].slice(0, 200)
  run.costUsd += r.costUsd ?? 0
  if (settings.memoryWriteBack && !r.error && !r.stopped) applyMemoryWrites(run.projectId, turn.text).catch(() => {})
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
  if (end.handoff) turn.handoff = { to: end.handoff.to.map((id) => findAgent(team, id)?.name ?? id).join(', '), note: end.handoff.note }
  if (end.done !== undefined) turn.done = end.done
  run.question = undefined

  // Inside a parallel wave every branch just reports; when the last one is done the issuer gets the results.
  if (state.wave?.members.includes(agent.id)) {
    const wave = state.wave
    const nextId = wave.queue.shift()
    run.hops++
    if (nextId) run.next = { agentId: nextId, note: wave.note }
    else {
      state.wave = undefined
      run.next = { agentId: wave.from, note: `Parallel results from ${wave.members.map((id) => team.agents.find((a) => a.id === id)?.name ?? id).join(', ')} are in the thread.` }
    }
    save(run)
    return runNext(state)
  }

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
  if (next.kind === 'ask') {
    // The asking agent gets the user's answer: the next message in the thread resumes it.
    run.question = next.question
    run.next = { agentId: agent.id, note: 'The user answered your question; read their latest message.' }
    return finish(state, 'waiting')
  }
  run.hops++
  if (next.kind === 'wait') {
    run.next = { agentId: lead.id, note: next.reason }
    return finish(state, 'waiting')
  }
  // Waves run their branches one after another here; results return to the issuer together.
  state.wave = next.agentIds.length > 1 ? { from: agent.id, queue: next.agentIds.slice(1), members: next.agentIds, note: next.note } : undefined
  run.next = { agentId: next.agentIds[0], note: next.note }
  if (!routing.autoRelay) return finish(state, 'waiting')
  save(run)
  return runNext(state)
}

function launch(state: RunState): void {
  const gen = state.gen
  const step = async () => {
    if (gen !== state.gen) return // stopped or restarted again while waiting
    state.run.status = 'running' // the stopped turn before us may have marked the thread stopped
    return runNext(state)
  }
  state.chain = (state.chain ?? Promise.resolve()).then(step).catch((err: unknown) => {
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
  // A half-done parallel wave only goes on when the restart continues it.
  if (state.wave && agentId !== state.run.next?.agentId) state.wave = undefined
  state.redirect = undefined
  state.run.next = { agentId, note }
  state.run.status = 'running'
  state.gen++
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

// ---- Global agents: app-level library of teams (agents/global-agents.json), without handoffs ----

const globalsFile = () => userDir('agents', 'global-agents.json')

function readGlobals(): GlobalTeam[] {
  const raw = readJson<{ teams?: unknown[] }>(globalsFile(), {})
  return (Array.isArray(raw.teams) ? raw.teams : []).flatMap((x) => {
    const g = x as Partial<GlobalTeam>
    if (!g || typeof g.id !== 'string' || !ID_RE.test(g.id)) return []
    return [{ id: g.id, name: String(g.name ?? 'Team').slice(0, 80), savedAt: Number(g.savedAt) || 0, team: sanitizeTeam(g.team) }]
  })
}

function writeGlobals(list: GlobalTeam[]): GlobalTeam[] {
  mkdirSync(userDir('agents'), { recursive: true })
  writeJson(globalsFile(), { version: 1, teams: list })
  return list
}

export const globalsApi = {
  async globals(): Promise<GlobalTeam[]> {
    return readGlobals()
  },
  async saveGlobal(projectId: string, name: string): Promise<GlobalTeam[]> {
    const team = readTeam(projectId)
    // Library entries are role templates: who hands off to whom belongs to a project team.
    const entry: GlobalTeam = { id: randomUUID(), name: String(name || 'Team').trim().slice(0, 80) || 'Team', savedAt: Date.now(), team: { ...team, agents: team.agents.map((a) => ({ ...a, handoffs: [] })) } }
    return writeGlobals([entry, ...readGlobals()].slice(0, 50))
  },
  async useGlobal(projectId: string, id: string): Promise<Team> {
    const g = readGlobals().find((x) => x.id === id)
    if (!g) throw new Error('Unknown library team')
    const before = readTeam(projectId)
    const team = writeTeam(projectId, g.team)
    trustTeam(getProject(projectId).path, team, before)
    return team
  },
  async removeGlobal(id: string): Promise<GlobalTeam[]> {
    return writeGlobals(readGlobals().filter((x) => x.id !== id))
  }
}

export const teamApi = {
  ...globalsApi,
  async get(projectId: string): Promise<Team> {
    return readTeam(projectId)
  },
  async save(projectId: string, team: Team): Promise<Team> {
    const before = readTeam(projectId)
    const saved = writeTeam(projectId, team)
    trustTeam(getProject(projectId).path, saved, before)
    return saved
  },
  async unconfirmed(projectId: string): Promise<string[]> {
    return unconfirmedTeam(getProject(projectId).path, readTeam(projectId))
  },
  async confirm(projectId: string): Promise<string[]> {
    confirmTeam(getProject(projectId).path, readTeam(projectId))
    return []
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
    const state: RunState = { run, hopBase: 0, turnBase: 0, costBase: 0, sessions: new Map(), gen: 0 }
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
    const asked = state.run.question ? state.run.next?.agentId : undefined
    state.run.question = undefined
    restart(state, (target ?? team.agents.find((a) => a.id === asked) ?? leadOf(team)).id, 'The user wrote to you in the thread; read their latest message.')
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
    state.gen++
    if (state.turn) {
      state.run.status = 'stopped'
      state.turn.stop()
      push(state.run, true)
    } else if (state.run.status !== 'done') finish(state, 'stopped')
  },
  async remove(runId: string): Promise<void> {
    const state = getState(runId)
    state.run.status = 'stopped'
    state.gen++
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

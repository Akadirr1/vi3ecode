// Agent mode: a thread goes to the lead; every turn ends in a handoff or a done. With auto-relay on,
// the next turn starts by itself until the hop limit or the budget pauses the chain. The user can write
// into the thread at any time: a running Claude turn is steered, otherwise the next turn reads it.
import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { Activity, Agent, GlobalTeam, Team, TeamRun, TeamTurn } from '../shared/types'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { agentById, buildTeamPrompt, decideNext, entryIds, findAgent, leadOf, parseTurnEnd } from '../shared/prompt'
import { matchGuardrail } from '../shared/guardrails'
import { getProject, getSettings, userDir } from './store'
import { applyMemoryWrites, listMemory, readTeam, writeTeam } from './project'
import { getAdapter, setUsage } from './engines'
import { ClaudeSession, type PermissionRequest } from './engines/claudeSession'
import { runTurn, type TurnResult } from './runner'
import { GIT_FLAGS, gitExe } from './git'
import { createWorktree, isOurWorktree, mergeWorktree, removeWorktree, worktreeDiff, worktreeDirty } from './worktree'
import { confirmTeam, effectiveTeam, trustTeam, unconfirmedTeam } from './trust'
import { chatBusyIn, describe } from './chat'
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
    if (!n.endsWith('.json')) continue
    const run = readJson<TeamRun | null>(userDir('team-runs', n), null)
    if (!run || !ID_RE.test(run.id) || !Array.isArray(run.turns)) continue
    for (const t of run.turns) t.kind ??= 'agent'
    // An edited run file must not point remove/merge/reveal at another folder or branch.
    if (run.worktree !== undefined && !isOurWorktree(run.worktree)) delete run.worktree
    if (run.status === 'running') {
      run.status = 'stopped' // a turn cannot survive an app restart
      for (const t of run.turns) if (t.status === 'running') t.status = 'stopped'
    }
    run.pending = []
    runs.set(run.id, { run, hopBase: run.hops, turnBase: agentTurns(run), costBase: run.costUsd, sessions: new Map(), gen: 0 })
  }
}

function save(r: TeamRun): void {
  if (!runs.has(r.id)) return // removed while its last turn was winding down
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
  onTool: (n: string) => void,
  onActivity: (a: Activity) => void
): AgentTurn {
  const adapter = getAdapter(agent.engine)
  if (agent.engine !== 'claude') {
    const opts = { prompt, model: agent.model, effort: agent.effort, approval: agent.permission, resumeId: adapter.resumes ? resumeId : undefined, mcpConfig: mcpConfigJson(state.run.projectId) }
    return runTurn(adapter, cwd, opts, (e) => {
      if (e.type === 'text') onText(e.text, e.delta)
      else if (e.type === 'tool') onTool(e.name)
      if (e.type === 'text' || e.type === 'tool') onActivity(e.type === 'text' ? { kind: 'writing', at: Date.now() } : { kind: 'tool', tool: e.name, at: Date.now() })
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
    onActivity,
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
  const project = getProject(run.projectId).path
  const team = effectiveTeam(project, readTeam(run.projectId))
  // Memory, trust and the team file stay the project's; the agents themselves work in the thread's worktree.
  const cwd = run.worktree?.path ?? project
  const settings = getSettings()
  const { budget, routing } = team
  if (budget.usd > 0 && run.costUsd - state.costBase >= budget.usd) return finish(state, 'budget')
  if (budget.turns > 0 && agentTurns(run) - state.turnBase >= budget.turns) return finish(state, 'budget')
  if (run.hops - state.hopBase >= routing.hopLimit) return finish(state, 'hop-cap')

  const lead = leadOf(team)
  const agent = agentById(team, run.next?.agentId) ?? lead
  const note = run.next?.note
  // A handoff to a paused agent stays pending with its brief, for Continue once it is resumed (as in vi3ecode).
  if (agent.paused) {
    run.next = { agentId: agent.id, note: note ?? '' }
    return finish(state, 'waiting')
  }
  const from = [...run.turns].reverse().find((t) => t.kind === 'agent' && t.status !== 'running')?.agentName
  const adapter = getAdapter(agent.engine)

  const turn: TeamTurn = { id: randomUUID(), kind: 'agent', agentId: agent.id, agentName: agent.name, engine: agent.engine, text: '', tools: [], filesTouched: [], status: 'running', startedAt: Date.now() }
  run.turns.push(turn)
  run.next = undefined
  run.status = 'running'
  push(run, true)

  const blocked = !adapter.build
    ? `${adapter.label} runs in the terminal only; pick a headless engine for ${agent.name}.`
    : run.worktree && !existsSync(cwd)
      ? `The thread's worktree folder is missing: ${run.worktree.root}`
      : undefined
  if (blocked) {
    turn.status = 'error'
    turn.error = blocked
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
    wave: waveMembers?.map((id) => agentById(team, id)?.name ?? id)
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
    },
    (a) => {
      turn.activity = a
      push(run)
    }
  )
  state.turn = handle
  state.turnAgentId = agent.id
  const r = await handle.done
  delete turn.activity
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
  if (end.handoff) turn.handoff = { to: end.handoff.to.map((id) => (findAgent(team, id) ?? agentById(team, id))?.name ?? id).join(', '), note: end.handoff.note }
  if (end.done !== undefined) turn.done = end.done
  run.question = undefined

  // Inside a parallel wave every branch just reports; when the last one is done the issuer gets the results.
  if (state.wave?.members.includes(agent.id)) {
    const wave = state.wave
    const nextId = wave.queue.shift()
    if (nextId) run.next = { agentId: nextId, note: wave.note }
    else {
      run.hops++ // the results going back count as one hop, however many branches ran (as in vi3ecode)
      state.wave = undefined
      run.next = { agentId: wave.from, note: `Parallel results from ${wave.members.map((id) => agentById(team, id)?.name ?? id).join(', ')} are in the thread.` }
    }
    save(run)
    return runNext(state)
  }

  // The user addressed someone mid-turn: they go next and read the message from the transcript.
  if (state.redirect) {
    const to = agentById(team, state.redirect) ?? lead
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
function restart(state: RunState, agentId: string, note: string, wave?: RunState['wave']): void {
  state.hopBase = state.run.hops
  state.turnBase = agentTurns(state.run)
  state.costBase = state.run.costUsd
  // A half-done parallel wave only goes on when the restart continues it; a message to a role with copies starts one.
  if (wave) state.wave = wave
  else if (state.wave && agentId !== state.run.next?.agentId) state.wave = undefined
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

/** A user message that reaches several copies of a role is a wave whose results go to the lead. */
const waveOf = (team: Team, ids: string[], note: string): RunState['wave'] =>
  ids.length > 1 ? { from: leadOf(team).id, queue: ids.slice(1), members: ids, note } : undefined

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
  async start(projectId: string, goal: string, to?: string, isolation?: 'local' | 'worktree'): Promise<TeamRun> {
    loadAll()
    getProject(projectId)
    const text = String(goal ?? '').trim().slice(0, 20_000)
    if (!text) throw new Error('Write a goal first.')
    const team = readTeam(projectId)
    const ids = entryIds(team, to)
    const target = to ? (findAgent(team, to) ?? agentById(team, to)) : undefined
    const run: TeamRun = {
      id: randomUUID(),
      projectId,
      goal: text,
      status: 'running',
      turns: [userTurn(text, target)],
      hops: 0,
      costUsd: 0,
      pending: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    // Before the thread exists: if the checkout cannot be made, nothing is kept and the message stays in the composer.
    if (isolation === 'worktree') {
      run.worktree = await createWorktree(getProject(projectId).path, text.split('\n')[0]).catch((e: unknown) => {
        throw new Error(`The worktree could not be created. ${e instanceof Error ? e.message : String(e)}`)
      })
    }
    const state: RunState = { run, hopBase: 0, turnBase: 0, costBase: 0, sessions: new Map(), gen: 0 }
    runs.set(run.id, state)
    save(run)
    restart(state, ids[0], '', waveOf(team, ids, ''))
    return run
  },
  async send(runId: string, text: string, to?: string): Promise<void> {
    const state = getState(runId)
    const body = String(text ?? '').trim().slice(0, 20_000)
    if (!body) return
    const team = readTeam(state.run.projectId)
    const target = to ? (findAgent(team, to) ?? agentById(team, to)) : undefined
    const note = 'The user wrote to you in the thread; read their latest message.'
    const asked = state.run.question ? state.run.next?.agentId : undefined
    // Picked before the message is kept, so with every agent paused it stays in the composer.
    const ids = state.run.status === 'running' ? null : !target && asked ? [asked] : entryIds(team, to)
    state.run.turns.push(userTurn(body, target))
    if (!ids) {
      // Steer the running Claude turn when the message is for whoever is working (or for nobody in particular).
      if (state.turn?.steer && (!target || target.id === state.turnAgentId)) state.turn.steer(`Message from the user, sent while you work: ${body}`)
      // shortcut: a role with copies gets the message on its first copy only (vi3ecode queues it for each); queue per copy if that matters.
      else if (target) state.redirect = target.id
      save(state.run)
      push(state.run, true)
      return
    }
    save(state.run)
    state.run.question = undefined
    restart(state, ids[0], note, waveOf(team, ids, note))
  },
  async continue(runId: string, agentId?: string): Promise<void> {
    const state = getState(runId)
    if (state.run.status === 'running') return
    const team = readTeam(state.run.projectId)
    const pick = agentId ? agentById(team, agentId) : undefined
    restart(state, pick?.id ?? state.run.next?.agentId ?? leadOf(team).id, state.run.next?.note ?? '')
  },
  async respond(runId: string, approvalId: string, allow: boolean): Promise<void> {
    const state = getState(runId)
    const r = requests.get(approvalId)
    const pending = state.run.pending.find((p) => p.id === approvalId)
    state.run.pending = state.run.pending.filter((p) => p.id !== approvalId)
    requests.delete(approvalId)
    if (r && r.runId === runId && r.cs.alive) {
      const agent = agentById(readTeam(state.run.projectId), pending?.agentId)
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
  async remove(runId: string, force?: boolean): Promise<void> {
    const state = getState(runId)
    const wt = state.run.worktree
    const project = getProject(state.run.projectId).path
    // Asked before anything stops, so Cancel leaves a working thread working.
    if (wt && !force && (await worktreeDirty(project, wt))) throw new Error('WORK_WORKTREE_DIRTY')
    if (state.run.status === 'running') state.run.status = 'stopped'
    state.gen++
    state.turn?.stop()
    // The engine's process runs inside the tree: let it exit (stop kills it after 3 s) before the folder goes.
    if (wt) await Promise.race([state.chain, new Promise((r) => setTimeout(r, 5000))])
    if (wt) await removeWorktree(project, wt, force === true)
    runs.delete(runId)
    rmSync(file(runId), { force: true })
  },
  async merge(runId: string): Promise<void> {
    const { run } = getState(runId)
    if (!run.worktree) throw new Error('This thread works in the project folder; there is nothing to merge.')
    if (run.status === 'running') throw new Error('Wait for the team to finish first.')
    // Like vi3ecode: never merge into the project checkout while a thread is working in it.
    if (chatBusyIn(run.projectId) || [...runs.values()].some((s) => s.run.projectId === run.projectId && !s.run.worktree && s.run.status === 'running'))
      throw new Error('Another thread is working in the project folder. Merge once it finishes.')
    // shortcut: the leftover commit is titled with the goal's first line; vi3ecode has an engine write it from the diff.
    await mergeWorktree(getProject(run.projectId).path, run.worktree, run.goal.split('\n')[0].slice(0, 72) || 'Agent thread')
    record({ source: 'team', kind: 'worktree-merge', outcome: 'ok', projectId: run.projectId })
  },
  async diff(runId: string): Promise<string> {
    const { run } = getState(runId)
    return run.worktree ? worktreeDiff(getProject(run.projectId).path, run.worktree) : ''
  },
  async reveal(runId: string): Promise<void> {
    const { run } = getState(runId)
    if (run.worktree && existsSync(run.worktree.root) && statSync(run.worktree.root).isDirectory()) await shell.openPath(run.worktree.root)
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

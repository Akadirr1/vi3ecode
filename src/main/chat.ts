// Chat sessions: app-level (stored in userData, not in the repo).
// Claude Code chats keep one stream-json process per session: messages sent mid-turn steer the running
// turn and permission prompts become approval cards. Other engines run one process per turn and queue
// messages sent mid-turn.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ApprovalMode, ChatMessage, ChatSession, ChatSummary, EngineId } from '../shared/types'
import { approvalOf, ENGINE_IDS } from '../shared/schema'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { withHistory } from '../shared/prompt'
import { matchGuardrail } from '../shared/guardrails'
import { getProject, getSettings, userDir } from './store'
import { enginesApi, getAdapter, setUsage } from './engines'
import { canPlan, withRunMode } from '../shared/runMode'
import { classifierOf, classifierPrompt, FALLBACK, parseClassification, pickRoute, ROUTES } from '../shared/route'
import { ClaudeSession, toolDetail, type PermissionRequest } from './engines/claudeSession'
import { runTurn, type TurnHandle } from './runner'
import { applyMemoryWrites, listMemory } from './project'
import { mcpConfigJson } from './mcp'
import { BROWSER_ACT_TOOLS, BROWSER_READ_TOOLS } from './browserBridge'
import { emit, notify } from './events'
import { record, registerLive } from './activity'
import { readJson, writeJson } from './fsutil'

const sessions = new Map<string, ChatSession>()
/** One-shot turns of non-Claude engines. */
const running = new Map<string, TurnHandle>()
const queues = new Map<string, string[]>() // session id → queued user message ids
/** Persistent Claude Code processes. */
const claude = new Map<string, ClaudeSession>()
/** The assistant message the current turn writes into. */
const active = new Map<string, ChatMessage>()
/** Open permission requests, by approval id. */
const requests = new Map<string, { sessionId: string; req: PermissionRequest; cs: ClaudeSession }>()
/** Chats whose Auto classifier is running, and the route the next assistant message gets. */
const routing = new Map<string, TurnHandle | undefined>()
const routes = new Map<string, NonNullable<ChatMessage['route']>>()
let loaded = false

registerLive('workingChats', () => active.size)

const ID_RE = /^[\w-]{1,64}$/
const file = (id: string) => userDir('chats', `${id}.json`)

function loadAll(): void {
  if (loaded) return
  loaded = true
  let names: string[] = []
  try {
    names = readdirSync(userDir('chats'))
  } catch {
    return
  }
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const s = readJson<ChatSession | null>(userDir('chats', n), null)
    if (!s || !ID_RE.test(s.id) || !Array.isArray(s.messages)) continue
    // A turn cannot survive an app restart.
    for (const m of s.messages) if (m.status === 'running' || m.status === 'queued') m.status = 'stopped'
    s.approval = approvalOf(s.approval, 'ask')
    s.autoApprove = s.autoApprove === true
    s.auto = s.auto === true
    s.pending = []
    sessions.set(s.id, s)
  }
}

function get(id: string): ChatSession {
  loadAll()
  const s = ID_RE.test(id) ? sessions.get(id) : undefined
  if (!s) throw new Error(`Unknown chat: ${id}`)
  return s
}

function save(s: ChatSession): void {
  mkdirSync(userDir('chats'), { recursive: true })
  writeJson(file(s.id), { ...s, pending: [] })
}

let emitTimer: NodeJS.Timeout | null = null
const dirty = new Set<string>()
/** Streaming produces many events; coalesce pushes to the renderer to ~10/s. */
function push(s: ChatSession, now = false): void {
  s.updatedAt = Date.now()
  dirty.add(s.id)
  if (now) return flush()
  emitTimer ??= setTimeout(flush, 100)
}
function flush(): void {
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = null
  for (const id of dirty) {
    const s = sessions.get(id)
    if (s) emit('chat:session', s)
  }
  dirty.clear()
}

/** Memory brief and write-back rules ride ahead of each turn's prompt. */
function systemText(projectId: string): string | undefined {
  const settings = getSettings()
  const parts: string[] = []
  if (settings.memoryInject) {
    const brief = buildBrief(listMemory(projectId))
    if (brief) parts.push(brief)
  }
  if (settings.memoryWriteBack) parts.push(WRITE_BACK_INSTRUCTION)
  return parts.join('\n\n') || undefined
}

function newAssistant(s: ChatSession): ChatMessage {
  const route = routes.get(s.id)
  routes.delete(s.id)
  const msg: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', ts: Date.now(), engine: s.engine, model: s.model, tools: [], files: [], status: 'running', ...(route ? { route } : {}) }
  s.messages.push(msg)
  active.set(s.id, msg)
  return msg
}

function endTurn(s: ChatSession, r: { text: string; files: string[]; costUsd?: number; error?: string; stopped: boolean; durationMs: number }): void {
  const msg = active.get(s.id)
  active.delete(s.id)
  if (!msg || !sessions.has(s.id)) return // removed mid-turn
  msg.text = r.text || msg.text
  if (r.error) msg.text = `${msg.text ? msg.text + '\n\n' : ''}⚠ ${r.error}`
  msg.status = r.stopped ? 'stopped' : r.error ? 'error' : 'done'
  msg.costUsd = r.costUsd
  msg.durationMs = r.durationMs
  msg.files = [...new Set([...(msg.files ?? []), ...r.files])]
  if (getSettings().memoryWriteBack && msg.status === 'done') {
    applyMemoryWrites(s.projectId, msg.text).catch(() => {}) // best-effort; the reply stays as written
  }
  record({ source: 'chat', kind: 'turn', outcome: msg.status === 'done' ? 'ok' : msg.status === 'stopped' ? 'stopped' : 'error', projectId: s.projectId, engine: s.engine, durationMs: r.durationMs, costUsd: r.costUsd })
  save(s)
  push(s, true)
}

// ---- Claude Code: persistent session ----

/** What a Claude process was started with; a change takes effect on the next turn (a running one keeps steering). */
const spawnSig = (s: ChatSession) => [approvalFor(s) === 'read-only', s.model, s.effort, getSettings().guardrails, getSettings().browserTools].join('|')
const sigs = new Map<string, string>()

/** Plan run mode turns the chat read-only on engines that support it. */
const approvalFor = (s: ChatSession): ApprovalMode => (s.runMode === 'plan' && canPlan(s.engine) ? 'read-only' : s.approval)

function claudeFor(s: ChatSession): ClaudeSession {
  const existing = claude.get(s.id)
  if (existing?.alive && (existing.busy || sigs.get(s.id) === spawnSig(s))) return existing
  existing?.close()
  sigs.set(s.id, spawnSig(s))
  const cwd = getProject(s.projectId).path
  const cs: ClaudeSession = new ClaudeSession({
    cwd,
    approval: approvalFor(s),
    model: s.model,
    effort: s.effort,
    resumeId: s.engineSessionId,
    mcpConfig: mcpConfigJson(s.projectId),
    guarded: getSettings().guardrails,
    // Looking is always allowed; acting on the page too, except for read-only (the user watches the same panel).
    allowedTools: getSettings().browserTools ? [...BROWSER_READ_TOOLS, ...(approvalFor(s) === 'read-only' ? [] : BROWSER_ACT_TOOLS)] : undefined,
    onTurnStart: () => {
      if (!active.has(s.id)) newAssistant(s)
      push(s, true)
    },
    onText: (text, delta) => {
      const msg = active.get(s.id) ?? newAssistant(s)
      msg.text += delta || !msg.text ? text : `\n\n${text}`
      push(s)
    },
    onTool: (name, f, detail) => {
      const msg = active.get(s.id) ?? newAssistant(s)
      msg.tools!.push(detail ? `${name} ${detail}` : name)
      if (f) msg.files = [...new Set([...(msg.files ?? []), f])]
      push(s)
    },
    onSession: (sid) => (s.engineSessionId = sid),
    onRateLimit: (info) => setUsage('claude', info),
    onPermission: (req) => {
      const rule = getSettings().guardrails ? matchGuardrail(req.toolName, req.input) : null
      if (!rule && approvalFor(s) !== 'read-only' && (s.autoApprove || s.approval === 'full')) return cs.respond(req.id, req, true)
      requests.set(req.id, { sessionId: s.id, req, cs })
      s.pending.push({ id: req.id, tool: req.tool, detail: describe(req, cwd), ts: Date.now(), ...(rule ? { guardrail: rule.title } : {}) })
      notify(`${s.title}: approval needed`, `${req.tool} ${describe(req, cwd)}`)
      push(s, true)
    },
    onTurnEnd: (r) => {
      dropPending(s, cs)
      endTurn(s, { ...r, error: r.resumeFailed ? forgetSession(s, cs, r.error) : r.error, stopped: r.interrupted })
    },
    onExit: (error, resumeFailed) => {
      if (claude.get(s.id) === cs) claude.delete(s.id)
      dropPending(s, cs)
      if (resumeFailed) error = forgetSession(s, cs, error)
      if (error && active.has(s.id)) endTurn(s, { text: '', files: [], error, stopped: false, durationMs: 0 })
    }
  })
  claude.set(s.id, cs)
  return cs
}

/** One line for the approval card: the command, file or URL the tool acts on, paths relative to the project. */
export function describe(req: PermissionRequest, cwd: string): string {
  return toolDetail(req.input, cwd) || req.description.slice(0, 300)
}

/** Denies and forgets this process's open approvals; a replacement process may already have its own. */
function dropPending(s: ChatSession, cs: ClaudeSession): void {
  if (!s.pending.length) return
  for (const p of s.pending) {
    const r = requests.get(p.id)
    if (r?.cs !== cs) continue
    if (cs.alive) cs.respond(p.id, r.req, false)
    requests.delete(p.id)
  }
  s.pending = s.pending.filter((p) => requests.has(p.id))
}

/** Expired or unknown Claude session: drop it (and its dying process) so the next message starts fresh with the chat's history. */
function forgetSession(s: ChatSession, cs: ClaudeSession, error?: string): string {
  s.engineSessionId = undefined
  if (claude.get(s.id) === cs) closeClaude(s.id)
  save(s)
  return `${error ?? 'Claude Code exited.'}\n\nThe previous Claude session could not be resumed. Send your message again to continue with this chat's history.`
}

function closeClaude(id: string): void {
  claude.get(id)?.close()
  claude.delete(id)
}

// ---- other engines: one process per turn ----

function startTurn(s: ChatSession, userMsg: ChatMessage): void {
  const adapter = getAdapter(s.engine)
  const project = getProject(s.projectId)
  userMsg.status = undefined
  const msg = newAssistant(s)
  if (!adapter.build) {
    active.delete(s.id)
    msg.status = 'error'
    msg.text = `${adapter.label} runs in the terminal only. Open it from Terminal Mode.`
    push(s, true)
    save(s)
    return
  }
  const history = s.messages.slice(0, s.messages.indexOf(userMsg))
  const canResume = !!(adapter.resumes && s.engineSessionId)
  const text = withRunMode(userMsg, history)
  const prompt = canResume ? text : withHistory(history, text)
  const handle = runTurn(
    adapter,
    project.path,
    { prompt, system: systemText(s.projectId), model: s.model, effort: s.effort, approval: userMsg.mode === 'plan' ? 'read-only' : s.approval, resumeId: canResume ? s.engineSessionId : undefined, mcpConfig: mcpConfigJson(s.projectId) },
    (e) => {
      if (e.type === 'text') {
        msg.text += e.delta || !msg.text ? e.text : `\n\n${e.text}`
        push(s)
      } else if (e.type === 'tool') {
        msg.tools!.push(e.file ? `${e.name} ${e.file}` : e.name)
        push(s)
      } else if (e.type === 'session') s.engineSessionId = e.id
    }
  )
  running.set(s.id, handle)
  push(s, true)
  void handle.done.then((r) => {
    running.delete(s.id)
    if (r.sessionId) s.engineSessionId = r.sessionId
    else if (r.error && canResume) s.engineSessionId = undefined // a session that failed to resume would fail every turn
    endTurn(s, r)
    const next = queues.get(s.id)?.shift()
    const nextMsg = next ? s.messages.find((m) => m.id === next) : undefined
    if (nextMsg && !r.stopped && sessions.has(s.id)) startTurn(s, nextMsg)
  })
}

const isBusy = (id: string) => active.has(id) || running.has(id)

/** A chat turn is working in this project's folder right now. */
export const chatBusyIn = (projectId: string) => [...sessions.values()].some((s) => s.projectId === projectId && isBusy(s.id))

/** Auto: the cheapest available model classifies the message, then the best-scoring route takes the turn (switched through update). */
async function autoRoute(s: ChatSession, text: string): Promise<NonNullable<ChatMessage['route']>> {
  const engines = await enginesApi.list()
  // Codex cannot ask before an edit: with "Ask every time" it would edit freely, so Auto keeps to engines that ask.
  const ready = (id: EngineId) =>
    engines.some((e) => e.id === id && e.installed && e.enabled && e.headless) && (s.runMode !== 'plan' || canPlan(id)) && (id !== 'codex' || approvalFor(s) !== 'ask')
  const cands = ROUTES.filter((r) => ready(r.engine)).map((r) => ({ ...r, efforts: getAdapter(r.engine).efforts }))
  const c = classifierOf(cands)
  if (!c) throw new Error('Auto found no available engine. Enable or sign in to Claude or Codex, or pick a model manually.')
  const h = runTurn(getAdapter(c.engine), tmpdir(), { prompt: classifierPrompt(text), model: c.model, effort: 'low', approval: 'read-only', textOnly: true })
  routing.set(s.id, h)
  const timer = setTimeout(h.stop, 20_000) // the original's timeout is not known
  const r = await h.done
  clearTimeout(timer)
  if (r.stopped && !routing.has(s.id)) throw new Error('Stopped')
  const parsed = r.error ? null : parseClassification(r.text)
  const cls = parsed ?? FALLBACK
  // An engine whose classifier call failed (signed out, over its limit) would fail the turn too.
  const pool = r.error ? cands.filter((x) => x.engine !== c.engine) : cands
  if (!pool.length) throw new Error(r.error ?? 'Auto found no available engine.')
  await chatApi.update(s.id, pickRoute(pool, cls, s)!)
  return { reason: cls.reason || `${cls.taskKind} · ${cls.complexity}`, ...(parsed ? {} : { fallback: true }) }
}

export const chatApi = {
  async list(projectId: string): Promise<ChatSummary[]> {
    loadAll()
    return [...sessions.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({ id: s.id, title: s.title, engine: s.engine, model: s.model, updatedAt: s.updatedAt, running: isBusy(s.id), pinned: s.pinned }))
  },
  async get(id: string): Promise<ChatSession | null> {
    loadAll()
    return (ID_RE.test(id) && sessions.get(id)) || null
  },
  async create(projectId: string, engine?: EngineId): Promise<ChatSession> {
    loadAll()
    getProject(projectId)
    const settings = getSettings()
    const s: ChatSession = {
      id: randomUUID(),
      projectId,
      title: 'New chat',
      engine: engine && ENGINE_IDS.includes(engine) ? engine : settings.defaultEngine,
      approval: settings.approval,
      autoApprove: false,
      messages: [],
      pending: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    sessions.set(s.id, s)
    save(s)
    return s
  },
  async update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'engine' | 'approval' | 'model' | 'effort' | 'autoApprove' | 'auto' | 'pinned'>>): Promise<ChatSession> {
    const s = get(id)
    if (typeof patch.title === 'string' && patch.title.trim()) s.title = patch.title.trim().slice(0, 120)
    if (patch.engine && ENGINE_IDS.includes(patch.engine) && patch.engine !== s.engine) {
      if (isBusy(id)) throw new Error('Wait for the turn to finish before switching engines.')
      closeClaude(id)
      s.engine = patch.engine
      s.engineSessionId = undefined // the new engine starts fresh; history is replayed in the prompt
    }
    const was = approvalFor(s)
    if (patch.approval !== undefined) s.approval = approvalOf(patch.approval, s.approval)
    if ('runMode' in patch) s.runMode = patch.runMode === 'plan' ? 'plan' : undefined
    const now = approvalFor(s)
    const cs = claude.get(id)
    // read-only also removes tools from the process, so crossing it needs a fresh process.
    // A busy one switches mode now and is replaced after the turn (claudeFor compares spawnSig).
    if (cs && now !== was) {
      if ((now === 'read-only') !== (was === 'read-only') && !cs.busy) closeClaude(id)
      else cs.setApproval(now)
    }
    for (const k of ['model', 'effort'] as const) {
      if (k in patch && patch[k] !== s[k]) {
        const v = typeof patch[k] === 'string' && patch[k]!.trim() ? patch[k]!.trim().slice(0, 80) : undefined
        if (v !== s[k] && !claude.get(id)?.busy) closeClaude(id) // restarts with --resume on the next message
        s[k] = v
      }
    }
    if (typeof patch.auto === 'boolean') s.auto = patch.auto
    if (typeof patch.pinned === 'boolean') s.pinned = patch.pinned
    if (typeof patch.autoApprove === 'boolean') {
      s.autoApprove = patch.autoApprove
      if (s.autoApprove && approvalFor(s) !== 'read-only') for (const p of s.pending.filter((x) => !x.guardrail)) await chatApi.respond(id, p.id, true)
    }
    save(s)
    push(s, true)
    return s
  },
  async send(id: string, text: string): Promise<void> {
    const s = get(id)
    const body = String(text ?? '').trim()
    if (!body) return
    if (routing.has(id)) throw new Error('Auto is still choosing an engine…')
    const msg: ChatMessage = { id: randomUUID(), role: 'user', text: body.slice(0, 200_000), ts: Date.now() }
    const history = s.messages.slice()
    const title = s.title
    s.messages.push(msg)
    if (s.title === 'New chat') s.title = body.split('\n')[0].slice(0, 60)
    if (s.auto && !isBusy(id)) {
      routing.set(id, undefined)
      push(s, true)
      try {
        routes.set(id, await autoRoute(s, msg.text))
      } catch (e) {
        // The renderer puts the text back in the composer; a rename or pin meanwhile may have saved the message.
        s.messages = s.messages.filter((m) => m !== msg)
        s.title = title
        routes.delete(id)
        if (sessions.has(id)) save(s)
        push(s, true)
        throw e
      } finally {
        routing.delete(id)
      }
    }
    try {
      if (s.runMode === 'plan' && canPlan(s.engine)) msg.mode = 'plan' // after routing: Auto may switch the engine
      if (s.engine === 'claude') {
        const before = claude.get(id)
        const cs = claudeFor(s)
        const fresh = cs !== before
        if (cs.busy) {
          msg.status = 'steered' // folded into the running turn, in whatever mode that turn runs
          delete msg.mode
          cs.send(msg.text)
        } else {
          const sys = systemText(s.projectId)
          const text = withRunMode(msg, history)
          // A new process without a resumable session has no context: replay what the user saw.
          const prompt = fresh && !s.engineSessionId ? withHistory(history, text) : text
          cs.send(sys ? `${sys}\n\n---\n\n${prompt}` : prompt)
        }
        save(s)
        push(s, true)
        return
      }
      if (isBusy(id)) {
        msg.status = 'queued'
        queues.set(id, [...(queues.get(id) ?? []), msg.id])
        save(s)
        push(s, true)
        return
      }
      startTurn(s, msg)
      save(s)
    } catch (e) {
      routes.delete(id) // a reply that never started must not leave its route to a later one
      throw e
    }
  },
  async respond(id: string, approvalId: string, allow: boolean, always?: boolean): Promise<void> {
    const s = get(id)
    const r = requests.get(approvalId)
    s.pending = s.pending.filter((p) => p.id !== approvalId)
    requests.delete(approvalId)
    if (r && r.sessionId === id) {
      if (r.cs.alive) r.cs.respond(approvalId, r.req, !!allow && approvalFor(s) !== 'read-only', !!always)
      record({ source: 'chat', kind: allow ? 'approval-allowed' : 'approval-denied', outcome: 'info', projectId: s.projectId, engine: s.engine })
    }
    push(s, true)
  },
  async stop(id: string): Promise<void> {
    const s = get(id)
    for (const qid of queues.get(id) ?? []) {
      const m = s.messages.find((x) => x.id === qid)
      if (m) m.status = 'stopped'
    }
    queues.delete(id)
    stopRouting(id)
    running.get(id)?.stop()
    const cs = claude.get(id)
    if (cs) {
      dropPending(s, cs)
      cs.interrupt()
      // A process stuck in a tool may never answer the interrupt; a turn started since then is left alone.
      const turn = cs.turnNo
      setTimeout(() => cs.busy && cs.turnNo === turn && cs.kill(), 3000).unref()
    }
    push(s, true)
  },
  async remove(id: string): Promise<void> {
    get(id)
    queues.delete(id)
    running.get(id)?.stop()
    claude.get(id)?.kill()
    claude.delete(id)
    active.delete(id)
    routes.delete(id)
    stopRouting(id)
    sessions.delete(id)
    rmSync(file(id), { force: true })
  }
}

/** Ends a running Auto classifier; its send then fails and the text goes back to the composer. */
function stopRouting(id: string): void {
  const h = routing.get(id)
  routing.delete(id)
  h?.stop()
}

export function stopAllChats(): void {
  for (const id of [...routing.keys()]) stopRouting(id)
  for (const h of running.values()) h.stop()
  for (const cs of claude.values()) cs.kill()
}

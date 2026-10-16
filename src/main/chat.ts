// Chat sessions: app-level (stored in userData, not in the repo).
// Claude Code chats keep one stream-json process per session: messages sent mid-turn steer the running
// turn and permission prompts become approval cards. Other engines run one process per turn and queue
// messages sent mid-turn.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { ApprovalMode, ChatMessage, ChatSession, ChatSummary, EngineId } from '../shared/types'
import { approvalOf, ENGINE_IDS } from '../shared/schema'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { withHistory } from '../shared/prompt'
import { matchGuardrail } from '../shared/guardrails'
import { getProject, getSettings, userDir } from './store'
import { getAdapter, setUsage } from './engines'
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
const requests = new Map<string, { sessionId: string; req: PermissionRequest }>()
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
  const msg: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', ts: Date.now(), engine: s.engine, model: s.model, tools: [], files: [], status: 'running' }
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

function claudeFor(s: ChatSession): ClaudeSession {
  const existing = claude.get(s.id)
  if (existing?.alive) return existing
  const cwd = getProject(s.projectId).path
  const cs: ClaudeSession = new ClaudeSession({
    cwd,
    approval: s.approval,
    model: s.model,
    effort: s.effort,
    resumeId: s.engineSessionId,
    mcpConfig: mcpConfigJson(s.projectId),
    guarded: getSettings().guardrails,
    // Looking is always allowed; acting on the page too, except for read-only (the user watches the same panel).
    allowedTools: getSettings().browserTools ? [...BROWSER_READ_TOOLS, ...(s.approval === 'read-only' ? [] : BROWSER_ACT_TOOLS)] : undefined,
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
      if (!rule && s.approval !== 'read-only' && (s.autoApprove || s.approval === 'full')) return cs.respond(req.id, req, true)
      requests.set(req.id, { sessionId: s.id, req })
      s.pending.push({ id: req.id, tool: req.tool, detail: describe(req, cwd), ts: Date.now(), ...(rule ? { guardrail: rule.title } : {}) })
      notify(`${s.title}: approval needed`, `${req.tool} ${describe(req, cwd)}`)
      push(s, true)
    },
    onTurnEnd: (r) => {
      dropPending(s, cs)
      endTurn(s, { ...r, stopped: r.interrupted })
    },
    onExit: (error) => {
      if (claude.get(s.id) === cs) claude.delete(s.id)
      dropPending(s, cs)
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

function dropPending(s: ChatSession, cs: ClaudeSession): void {
  if (!s.pending.length) return
  for (const p of s.pending) {
    const r = requests.get(p.id)
    if (r && cs.alive) cs.respond(p.id, r.req, false)
    requests.delete(p.id)
  }
  s.pending = []
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
  const prompt = canResume ? userMsg.text : withHistory(history, userMsg.text)
  const handle = runTurn(
    adapter,
    project.path,
    { prompt, system: systemText(s.projectId), model: s.model, effort: s.effort, approval: s.approval, resumeId: canResume ? s.engineSessionId : undefined },
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
    endTurn(s, r)
    const next = queues.get(s.id)?.shift()
    const nextMsg = next ? s.messages.find((m) => m.id === next) : undefined
    if (nextMsg && !r.stopped && sessions.has(s.id)) startTurn(s, nextMsg)
  })
}

const isBusy = (id: string) => active.has(id) || running.has(id)

export const chatApi = {
  async list(projectId: string): Promise<ChatSummary[]> {
    loadAll()
    return [...sessions.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({ id: s.id, title: s.title, engine: s.engine, model: s.model, updatedAt: s.updatedAt, running: isBusy(s.id) }))
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
  async update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'engine' | 'approval' | 'model' | 'effort' | 'autoApprove'>>): Promise<ChatSession> {
    const s = get(id)
    if (typeof patch.title === 'string' && patch.title.trim()) s.title = patch.title.trim().slice(0, 120)
    if (patch.engine && ENGINE_IDS.includes(patch.engine) && patch.engine !== s.engine) {
      if (isBusy(id)) throw new Error('Wait for the turn to finish before switching engines.')
      closeClaude(id)
      s.engine = patch.engine
      s.engineSessionId = undefined // the new engine starts fresh; history is replayed in the prompt
    }
    if (patch.approval !== undefined) {
      const next: ApprovalMode = approvalOf(patch.approval, s.approval)
      const cs = claude.get(id)
      // read-only also removes tools from the process, so crossing it needs a fresh process.
      if (cs && (next === 'read-only') !== (s.approval === 'read-only')) {
        if (!cs.busy) closeClaude(id)
      } else cs?.setApproval(next)
      s.approval = next
    }
    for (const k of ['model', 'effort'] as const) {
      if (k in patch && patch[k] !== s[k]) {
        const v = typeof patch[k] === 'string' && patch[k]!.trim() ? patch[k]!.trim().slice(0, 80) : undefined
        if (v !== s[k] && !claude.get(id)?.busy) closeClaude(id) // restarts with --resume on the next message
        s[k] = v
      }
    }
    if (typeof patch.autoApprove === 'boolean') {
      s.autoApprove = patch.autoApprove
      if (s.autoApprove && s.approval !== 'read-only') for (const p of s.pending.filter((x) => !x.guardrail)) await chatApi.respond(id, p.id, true)
    }
    save(s)
    push(s, true)
    return s
  },
  async send(id: string, text: string): Promise<void> {
    const s = get(id)
    const body = String(text ?? '').trim()
    if (!body) return
    const msg: ChatMessage = { id: randomUUID(), role: 'user', text: body.slice(0, 200_000), ts: Date.now() }
    const history = s.messages.slice()
    s.messages.push(msg)
    if (s.title === 'New chat') s.title = body.split('\n')[0].slice(0, 60)
    if (s.engine === 'claude') {
      const fresh = !claude.get(id)?.alive
      const cs = claudeFor(s)
      if (cs.busy) {
        msg.status = 'steered' // folded into the running turn
        cs.send(msg.text)
      } else {
        const sys = systemText(s.projectId)
        // A new process without a resumable session has no context: replay what the user saw.
        const prompt = fresh && !s.engineSessionId ? withHistory(history, msg.text) : msg.text
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
  },
  async respond(id: string, approvalId: string, allow: boolean, always?: boolean): Promise<void> {
    const s = get(id)
    const r = requests.get(approvalId)
    s.pending = s.pending.filter((p) => p.id !== approvalId)
    requests.delete(approvalId)
    if (r && r.sessionId === id) {
      claude.get(id)?.respond(approvalId, r.req, !!allow && s.approval !== 'read-only', !!always)
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
    running.get(id)?.stop()
    const cs = claude.get(id)
    if (cs) {
      dropPending(s, cs)
      cs.interrupt()
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
    sessions.delete(id)
    rmSync(file(id), { force: true })
  }
}

export function stopAllChats(): void {
  for (const h of running.values()) h.stop()
  for (const cs of claude.values()) cs.kill()
}

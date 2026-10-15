// Chat sessions: app-level (stored in userData, not in the repo). One engine turn at a time per
// session; messages sent mid-turn are queued and run next.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { ChatMessage, ChatSession, ChatSummary, EngineId } from '../shared/types'
import { APPROVAL_MODES, ENGINE_IDS } from '../shared/schema'
import { buildBrief, WRITE_BACK_INSTRUCTION } from '../shared/memory'
import { withHistory } from '../shared/prompt'
import { getProject, getSettings, userDir } from './store'
import { getAdapter } from './engines'
import { runTurn, type TurnHandle } from './runner'
import { listMemory, reindexMemory } from './project'
import { emit } from './events'
import { record, registerLive } from './activity'
import { readJson, writeJson } from './fsutil'

const sessions = new Map<string, ChatSession>()
const running = new Map<string, TurnHandle>()
const queues = new Map<string, string[]>() // session id → queued user message ids
let loaded = false

registerLive('workingChats', () => running.size)

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
  writeJson(file(s.id), s)
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

function startTurn(s: ChatSession, userMsg: ChatMessage): void {
  const adapter = getAdapter(s.engine)
  const project = getProject(s.projectId)
  const settings = getSettings()
  userMsg.status = undefined
  const msg: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', ts: Date.now(), engine: s.engine, tools: [], status: 'running' }
  s.messages.push(msg)
  if (!adapter.build) {
    msg.status = 'error'
    msg.text = `${adapter.label} runs in the terminal only. Open it from the Terminal view.`
    push(s, true)
    save(s)
    return
  }

  const system: string[] = []
  if (settings.memoryInject) {
    const brief = buildBrief(listMemory(s.projectId))
    if (brief) system.push(brief)
  }
  if (settings.memoryWriteBack) system.push(WRITE_BACK_INSTRUCTION)

  const history = s.messages.slice(0, s.messages.indexOf(userMsg))
  const canResume = !!(adapter.resumes && s.engineSessionId)
  const prompt = canResume ? userMsg.text : withHistory(history, userMsg.text)

  const handle = runTurn(
    adapter,
    project.path,
    { prompt, system: system.join('\n\n') || undefined, model: s.model, approval: s.approval, resumeId: canResume ? s.engineSessionId : undefined },
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
    if (!sessions.has(s.id)) return // removed mid-turn
    msg.text = r.text || msg.text
    if (r.error) msg.text = `${msg.text ? msg.text + '\n\n' : ''}⚠ ${r.error}`
    msg.status = r.stopped ? 'stopped' : r.error ? 'error' : 'done'
    msg.costUsd = r.costUsd
    if (r.sessionId) s.engineSessionId = r.sessionId
    if (settings.memoryWriteBack) {
      try {
        reindexMemory(s.projectId)
      } catch {
        // index regeneration is best-effort
      }
    }
    record({ source: 'chat', kind: 'turn', outcome: msg.status === 'done' ? 'ok' : msg.status === 'stopped' ? 'stopped' : 'error', projectId: s.projectId, engine: s.engine, durationMs: r.durationMs, costUsd: r.costUsd })
    save(s)
    push(s, true)
    const next = queues.get(s.id)?.shift()
    const nextMsg = next ? s.messages.find((m) => m.id === next) : undefined
    if (nextMsg && !r.stopped) startTurn(s, nextMsg)
  })
}

export const chatApi = {
  async list(projectId: string): Promise<ChatSummary[]> {
    loadAll()
    return [...sessions.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({ id: s.id, title: s.title, engine: s.engine, updatedAt: s.updatedAt, running: running.has(s.id) }))
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
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    sessions.set(s.id, s)
    save(s)
    return s
  },
  async update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'engine' | 'approval' | 'model'>>): Promise<ChatSession> {
    const s = get(id)
    if (typeof patch.title === 'string' && patch.title.trim()) s.title = patch.title.trim().slice(0, 120)
    if (patch.engine && ENGINE_IDS.includes(patch.engine) && patch.engine !== s.engine) {
      s.engine = patch.engine
      s.engineSessionId = undefined // the new engine starts fresh; history is replayed in the prompt
    }
    if (patch.approval && APPROVAL_MODES.includes(patch.approval)) s.approval = patch.approval
    if ('model' in patch) s.model = typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim().slice(0, 80) : undefined
    save(s)
    push(s, true)
    return s
  },
  async send(id: string, text: string): Promise<void> {
    const s = get(id)
    const body = String(text ?? '').trim()
    if (!body) return
    const msg: ChatMessage = { id: randomUUID(), role: 'user', text: body.slice(0, 200_000), ts: Date.now() }
    s.messages.push(msg)
    if (s.title === 'New chat') s.title = body.split('\n')[0].slice(0, 60)
    if (running.has(id)) {
      msg.status = 'queued'
      queues.set(id, [...(queues.get(id) ?? []), msg.id])
      save(s)
      push(s, true)
      return
    }
    startTurn(s, msg)
    save(s)
  },
  async stop(id: string): Promise<void> {
    const s = get(id)
    for (const qid of queues.get(id) ?? []) {
      const m = s.messages.find((x) => x.id === qid)
      if (m) m.status = 'stopped'
    }
    queues.delete(id)
    running.get(id)?.stop()
    push(s, true)
  },
  async remove(id: string): Promise<void> {
    get(id)
    queues.delete(id)
    running.get(id)?.stop()
    sessions.delete(id)
    rmSync(file(id), { force: true })
  }
}

export function stopAllChats(): void {
  for (const h of running.values()) h.stop()
}

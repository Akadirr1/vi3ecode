// Contract shared by main, preload and renderer. Everything crossing IPC is plain JSON.

export type EngineId =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'cursor'
  | 'kimi'
  | 'grok'
  | 'kiro'
  | 'cline'
  | 'command'
  | 'antigravity'

/** read-only: no writes. supervised: edits inside the project only. auto: no prompts. */
export type ApprovalMode = 'read-only' | 'supervised' | 'auto'

export interface EngineInfo {
  id: EngineId
  label: string
  bin: string
  installed: boolean
  version?: string
  /** Can be driven headless (chat + agent mode). Otherwise terminal-only. */
  headless: boolean
  enabled: boolean
  installHint: string
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
}

export interface Settings {
  theme: 'system' | 'dark' | 'light'
  defaultEngine: EngineId
  approval: ApprovalMode
  memoryInject: boolean
  memoryWriteBack: boolean
  autoHandoff: boolean
  hopCap: number
  budgetUsd: number
  hiddenEngines: EngineId[]
}

// ---- chat ----

export type MessageStatus = 'running' | 'done' | 'error' | 'stopped' | 'queued'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  ts: number
  engine?: EngineId
  tools?: string[]
  costUsd?: number
  status?: MessageStatus
}

export interface ChatSession {
  id: string
  projectId: string
  title: string
  engine: EngineId
  model?: string
  approval: ApprovalMode
  /** Engine-side session/thread id used to resume the conversation. */
  engineSessionId?: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ChatSummary {
  id: string
  title: string
  engine: EngineId
  updatedAt: number
  running: boolean
}

// ---- agent mode ----

export interface Agent {
  id: string
  name: string
  role: string
  /** Single emoji or 1–2 letters shown as the agent's face. */
  avatar: string
  color: string
  engine: EngineId
  model?: string
  permission: ApprovalMode
  instructions: string
  lead?: boolean
}

export interface Team {
  version: 1
  agents: Agent[]
}

export type TurnStatus = 'running' | 'done' | 'error' | 'stopped'

export interface TeamTurn {
  id: string
  agentId: string
  agentName: string
  engine: EngineId
  text: string
  tools: string[]
  filesTouched: string[]
  costUsd?: number
  handoff?: { to: string; note: string }
  done?: string
  status: TurnStatus
  error?: string
  startedAt: number
  endedAt?: number
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'error' | 'budget' | 'hop-cap'

export interface TeamRun {
  id: string
  projectId: string
  goal: string
  status: RunStatus
  turns: TeamTurn[]
  hops: number
  costUsd: number
  /** Set while status === 'waiting': who goes next if the user presses continue. */
  next?: { agentId: string; note: string }
  createdAt: number
  updatedAt: number
}

// ---- project files under .vi3ecode/ ----

export interface KanbanCard {
  id: string
  title: string
  body: string
  labels: string[]
  createdAt: number
}

export interface KanbanColumn {
  id: string
  title: string
  cards: KanbanCard[]
}

export interface Kanban {
  version: 1
  columns: KanbanColumn[]
}

export interface Note {
  id: string
  title: string
  body: string
  updatedAt: number
}

export interface Notes {
  version: 1
  notes: Note[]
}

export const MEMORY_TYPES = [
  'fact',
  'decision',
  'pattern',
  'context',
  'lesson',
  'warning',
  'todo',
  'reference'
] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemoryNote {
  /** File name without .md, [a-z0-9-]. */
  slug: string
  title: string
  type: MemoryType
  tags: string[]
  body: string
  created: string
  updated: string
  /** Slugs referenced as [[slug]] in the body. */
  links: string[]
}

// ---- activity ----

export type ActivitySource = 'chat' | 'team' | 'terminal' | 'system'

/** Never holds conversation text, tool arguments, file contents or command output. */
export interface ActivityEvent {
  ts: number
  source: ActivitySource
  kind: string
  outcome: 'ok' | 'error' | 'stopped' | 'info'
  projectId?: string
  engine?: EngineId
  durationMs?: number
  costUsd?: number
}

export interface ActivityFilter {
  source?: ActivitySource
  projectId?: string
  failuresOnly?: boolean
  limit?: number
}

export interface LiveState {
  workingChats: number
  runningTeams: number
  waitingTeams: number
  terminals: number
}

// ---- terminal ----

export interface PtyInfo {
  id: string
  projectId: string
  title: string
}

// ---- API exposed on window.api by the preload script ----

export type Unsubscribe = () => void

export interface Api {
  projects: {
    list(): Promise<Project[]>
    /** Shows a folder picker; returns the project or null when cancelled. */
    open(): Promise<Project | null>
    remove(id: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  engines: {
    list(refresh?: boolean): Promise<EngineInfo[]>
  }
  chat: {
    list(projectId: string): Promise<ChatSummary[]>
    get(id: string): Promise<ChatSession | null>
    create(projectId: string, engine?: EngineId): Promise<ChatSession>
    update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'engine' | 'approval' | 'model'>>): Promise<ChatSession>
    /** Starts a turn, or queues the text if a turn is already running. */
    send(id: string, text: string): Promise<void>
    stop(id: string): Promise<void>
    remove(id: string): Promise<void>
    onSession(cb: (session: ChatSession) => void): Unsubscribe
  }
  team: {
    get(projectId: string): Promise<Team>
    save(projectId: string, team: Team): Promise<Team>
    runs(projectId: string): Promise<TeamRun[]>
    start(projectId: string, goal: string): Promise<TeamRun>
    /** Continue a waiting run; optional agentId overrides who goes next. */
    continue(runId: string, agentId?: string): Promise<void>
    stop(runId: string): Promise<void>
    onRun(cb: (run: TeamRun) => void): Unsubscribe
  }
  board: {
    get(projectId: string): Promise<Kanban>
    save(projectId: string, board: Kanban): Promise<Kanban>
  }
  notes: {
    get(projectId: string): Promise<Notes>
    save(projectId: string, notes: Notes): Promise<Notes>
  }
  memory: {
    list(projectId: string): Promise<MemoryNote[]>
    save(projectId: string, note: Omit<MemoryNote, 'links' | 'created' | 'updated'> & { created?: string }): Promise<MemoryNote>
    remove(projectId: string, slug: string): Promise<void>
  }
  activity: {
    list(filter?: ActivityFilter): Promise<ActivityEvent[]>
    live(): Promise<LiveState>
  }
  pty: {
    /** Starts a shell (or `command` through the shell) in the project folder. */
    create(projectId: string, opts: { cols: number; rows: number; command?: string; title?: string }): Promise<PtyInfo>
    list(projectId: string): Promise<PtyInfo[]>
    /** Returns buffered output so a re-mounted view can restore scrollback. */
    attach(id: string): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    onData(cb: (id: string, data: string) => void): Unsubscribe
    onExit(cb: (id: string, code: number) => void): Unsubscribe
  }
}

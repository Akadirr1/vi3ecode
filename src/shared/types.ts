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

/**
 * read-only: never writes. ask: every action needing permission asks first (in-app approval card).
 * edits: file edits are approved automatically, other actions ask. full: the engine's permission bypass mode.
 */
export type ApprovalMode = 'read-only' | 'ask' | 'edits' | 'full'

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
  /** Model aliases offered in pickers; free text is also accepted. */
  models: string[]
  /** Reasoning effort levels the engine accepts (empty: no effort control). */
  efforts: string[]
  usage?: EngineUsage
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
}

export interface Settings {
  theme: 'system' | 'dark' | 'light'
  language: 'en' | 'tr'
  defaultEngine: EngineId
  approval: ApprovalMode
  memoryInject: boolean
  memoryWriteBack: boolean
  /** Destructive operations always ask, even under Full access or AUTO-APPROVE. */
  guardrails: boolean
  /** Engines get the vi3ecode-browser MCP server and can drive the browser panel. */
  browserTools: boolean
  hiddenEngines: EngineId[]
  /** Project ids open as tabs, in tab order. */
  openProjects: string[]
}

// ---- chat ----

/** steered: sent while a turn was running and folded into that turn (Claude Code). */
export type MessageStatus = 'running' | 'done' | 'error' | 'stopped' | 'queued' | 'steered'

/** What a running turn last did and when; `tool` is the tool being called. Cleared when the turn ends. */
export interface Activity {
  kind: 'thinking' | 'writing' | 'tool'
  tool?: string
  at: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  ts: number
  engine?: EngineId
  model?: string
  tools?: string[]
  /** Files the turn wrote, relative to the project. */
  files?: string[]
  costUsd?: number
  durationMs?: number
  status?: MessageStatus
  /** A user message sent in Plan run mode. */
  mode?: 'plan'
  /** Why Auto picked this reply's engine; fallback: the task analysis failed and Auto used a balanced choice. */
  route?: { reason: string; fallback?: boolean }
  activity?: Activity
}

export interface ChatSession {
  id: string
  projectId: string
  title: string
  engine: EngineId
  model?: string
  effort?: string
  approval: ApprovalMode
  /** Composer switch: answer every approval request with allow (never widens read-only). */
  autoApprove: boolean
  /** Composer run mode: Plan runs read-only and ends in a plan (engines in PLAN_ENGINES); missing means Build. */
  runMode?: 'plan'
  /** Auto engine routing: each new turn picks the engine, model and effort for its message. */
  auto?: boolean
  /** Listed first in the sidebar. */
  pinned?: boolean
  /** Engine-side session/thread id used to resume the conversation. */
  engineSessionId?: string
  messages: ChatMessage[]
  /** Approval requests waiting for the user. */
  pending: PendingApproval[]
  createdAt: number
  updatedAt: number
}

export interface ChatSummary {
  id: string
  title: string
  engine: EngineId
  model?: string
  updatedAt: number
  running: boolean
  pinned?: boolean
}

// ---- agent mode ----

export interface Agent {
  id: string
  name: string
  role: string
  /** One sentence shown under the name. */
  description: string
  /** 'portrait:<0-11>', 'glyph:<0-11>' or a short emoji/text. */
  avatar: string
  color: string
  engine: EngineId
  model?: string
  effort?: string
  permission: ApprovalMode
  instructions: string
  lead?: boolean
  /** Agent ids this agent may hand off to; empty means anyone. */
  handoffs: string[]
  /** A paused agent takes no turns: handoffs to it wait, user messages go to the lead. */
  paused?: boolean
  /** Parallel copies of this role, 1–8 (`dev`, `dev~2`…); the lead always runs as one. */
  instanceCount?: number
}

export interface TeamRouting {
  /** Auto-relay: a handoff starts the next turn by itself. */
  autoRelay: boolean
  /** Unclear endings and non-lead "done" go back to the lead. */
  returnToLead: boolean
  /** Handoffs per stretch before the chain pauses (1–50). */
  hopLimit: number
  /** Composer switch: approval requests from agents are answered with allow (never widens read-only). */
  autoApprove: boolean
}

export interface TeamBudget {
  /** Agent turns per stretch; 0 = no limit. */
  turns: number
  /** Dollars per stretch, where the engine reports cost; 0 = no limit. */
  usd: number
}

export interface Team {
  version: 1
  agents: Agent[]
  routing: TeamRouting
  budget: TeamBudget
}

/** A team kept in the app-level library (vi3ecode's "Global agents"); handoffs live only in project teams. */
export interface GlobalTeam {
  id: string
  name: string
  savedAt: number
  team: Team
}

export type TurnStatus = 'running' | 'done' | 'error' | 'stopped'

export interface TeamTurn {
  id: string
  /** 'user' entries are messages the user sent into the thread. */
  kind: 'agent' | 'user'
  /** For user entries: the agent the user addressed (empty = lead routes). */
  to?: string
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
  activity?: Activity
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
  /** Approval requests waiting for the user, tagged with the asking agent. */
  pending: (PendingApproval & { agentId: string })[]
  /** Set while waiting on an agent's @ask-user question; the user's next message answers it. */
  question?: string
  /** Isolated worktree: a work/<name> branch checked out beside the repository; every agent turn runs there. */
  worktree?: { root: string; path: string; branch: string }
  createdAt: number
  updatedAt: number
}

// ---- project files under .vi3ecode/ ----

export interface KanbanCard {
  id: string
  title: string
  body: string
  labels: string[]
  /** Agent id from the project team. */
  assignee?: string
  createdAt: number
}

export interface KanbanColumn {
  id: string
  title: string
  /** Dot colour (#rrggbb). */
  color?: string
  cards: KanbanCard[]
}

export interface Kanban {
  version: 1
  columns: KanbanColumn[]
}

export interface SketchStroke {
  color: string
  width: number
  /** Flattened x,y pairs in a 1000×600 canvas space. */
  points: number[]
}

export interface Note {
  id: string
  title: string
  body: string
  /** Freehand sketch drawn beside the text. */
  strokes: SketchStroke[]
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

export type ActivitySource = 'chat' | 'team' | 'flow' | 'terminal' | 'system'

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
  /** Set for engine panes (the CLI runs interactively in the shell). */
  engine?: EngineId
  model?: string
  effort?: string
}

/** What a pane runs, saved per project so the grid reopens after a restart (never its output). */
export interface SavedPane {
  engine?: EngineId
  model?: string
  effort?: string
  title: string
  /** False when the pane's bell is off. */
  notify?: boolean
}

// ---- approvals (engines that ask before acting) ----

export interface PendingApproval {
  id: string
  tool: string
  /** Set when a guardrail rule raised this card. */
  guardrail?: string
  /** One line: the file, command or URL the tool wants to act on. */
  detail: string
  ts: number
}

// ---- engine usage (where the provider reports it) ----

export interface EngineUsage {
  status?: string
  window?: string
  resetsAt?: number
  updatedAt: number
}

// ---- explorer & git ----

export interface FileEntry {
  name: string
  /** Relative to the project root, forward slashes. */
  path: string
  dir: boolean
  size?: number
}

export interface FileContent {
  text: string
  binary: boolean
  truncated: boolean
  size: number
}

export interface GitFile {
  path: string
  /** Porcelain XY codes: index (staged) and worktree status. */
  index: string
  worktree: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files: GitFile[]
}

export interface GitCommit {
  hash: string
  subject: string
  author: string
  date: string
}

// ---- plugins & skills ----

export type PluginPermission = 'run-commands' | 'read-project' | 'write-project' | 'network'

export interface PluginInfo {
  id: string
  name: string
  description: string
  homepage?: string
  /** Declared before activation, shown to the user. */
  permissions: PluginPermission[]
  /** Stdio MCP server handed to engines that support it while the plugin is active. */
  mcp?: { command: string; args: string[] }
  active: boolean
}

export interface Skill {
  /** Folder name under .vi3ecode/skills/, [a-z0-9-]. */
  name: string
  description: string
  body: string
  /** Copied into the engines' own skill folders (.claude/skills, .opencode/skill) and AGENTS.md. */
  installed: boolean
}

// ---- flow (beta) ----

export type FlowStepKind = 'task' | 'review' | 'gate'

export interface FlowStep {
  id: string
  kind: FlowStepKind
  title: string
  /** Instructions for a task/review step; the question shown at a human gate. */
  prompt: string
  engine?: EngineId
  model?: string
  approval?: ApprovalMode
}

export interface Flow {
  version: 1
  id: string
  name: string
  goal: string
  steps: FlowStep[]
  updatedAt: number
}

export type FlowStepStatus = 'pending' | 'running' | 'done' | 'error' | 'waiting' | 'skipped' | 'rejected'

export interface FlowRunStep {
  stepId: string
  title: string
  kind: FlowStepKind
  status: FlowStepStatus
  text: string
  costUsd?: number
  error?: string
  startedAt?: number
  endedAt?: number
}

export interface FlowRun {
  id: string
  flowId: string
  flowName: string
  projectId: string
  status: 'running' | 'waiting' | 'done' | 'error' | 'stopped'
  steps: FlowRunStep[]
  costUsd: number
  createdAt: number
  updatedAt: number
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
    update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'engine' | 'approval' | 'model' | 'effort' | 'autoApprove' | 'auto' | 'pinned'>> & { runMode?: 'plan' | '' }): Promise<ChatSession>
    /** Starts a turn. While one runs: steers it (Claude Code) or queues the text (other engines). */
    send(id: string, text: string): Promise<void>
    /** Answers an approval card. `always` also allows this kind of action for the rest of the session. */
    respond(id: string, approvalId: string, allow: boolean, always?: boolean): Promise<void>
    stop(id: string): Promise<void>
    remove(id: string): Promise<void>
    onSession(cb: (session: ChatSession) => void): Unsubscribe
  }
  team: {
    get(projectId: string): Promise<Team>
    save(projectId: string, team: Team): Promise<Team>
    /** Full access ('<agent id>') and 'autoApprove' that came with the project files and are not allowed on this machine yet. */
    unconfirmed(projectId: string): Promise<string[]>
    /** Allow them; returns what is still unconfirmed (nothing). */
    confirm(projectId: string): Promise<string[]>
    runs(projectId: string): Promise<TeamRun[]>
    /** `isolation: 'worktree'` gives the thread its own work/<name> checkout, created before the first turn. */
    start(projectId: string, goal: string, to?: string, isolation?: 'local' | 'worktree'): Promise<TeamRun>
    /** Message the thread. Running: the next turn reads it (and goes to `to` if set). Idle: resumes the thread. */
    send(runId: string, text: string, to?: string): Promise<void>
    /** Continue a waiting run; optional agentId overrides who goes next. */
    continue(runId: string, agentId?: string): Promise<void>
    respond(runId: string, approvalId: string, allow: boolean): Promise<void>
    stop(runId: string): Promise<void>
    /** A worktree thread also loses its checkout and branch; without `force` that fails with WORK_WORKTREE_DIRTY when work would be lost. */
    remove(runId: string, force?: boolean): Promise<void>
    /** Worktree threads: merge the branch into the project checkout, show what changed, open the folder. */
    merge(runId: string): Promise<void>
    diff(runId: string): Promise<string>
    reveal(runId: string): Promise<void>
    /** Global agents: teams saved for reuse in other projects. */
    globals(): Promise<GlobalTeam[]>
    saveGlobal(projectId: string, name: string): Promise<GlobalTeam[]>
    useGlobal(projectId: string, id: string): Promise<Team>
    removeGlobal(id: string): Promise<GlobalTeam[]>
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
    /** Starts a shell in the project folder; with `engine`, launches that CLI interactively in it. */
    create(projectId: string, opts: { cols: number; rows: number; engine?: EngineId; model?: string; effort?: string; command?: string; title?: string }): Promise<PtyInfo>
    list(projectId: string): Promise<PtyInfo[]>
    /** Returns buffered output so a re-mounted view can restore scrollback. */
    attach(id: string): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    /** The project's panes as last saved, in grid order. */
    layout(projectId: string): Promise<SavedPane[]>
    saveLayout(projectId: string, panes: SavedPane[]): Promise<void>
    /** OS notification for a pane that finished, shown only while the app is in the background. */
    alert(id: string, text: string): Promise<void>
    onData(cb: (id: string, data: string) => void): Unsubscribe
    onExit(cb: (id: string, code: number) => void): Unsubscribe
  }
  files: {
    list(projectId: string, dir: string): Promise<FileEntry[]>
    read(projectId: string, path: string): Promise<FileContent>
  }
  git: {
    status(projectId: string): Promise<GitStatus>
    diff(projectId: string, path?: string, staged?: boolean): Promise<string>
    stage(projectId: string, paths: string[]): Promise<void>
    unstage(projectId: string, paths: string[]): Promise<void>
    commit(projectId: string, message: string): Promise<void>
    log(projectId: string, limit?: number): Promise<GitCommit[]>
  }
  plugins: {
    list(projectId: string): Promise<PluginInfo[]>
    setActive(projectId: string, id: string, active: boolean): Promise<PluginInfo[]>
  }
  skills: {
    list(projectId: string): Promise<Skill[]>
    save(projectId: string, skill: Omit<Skill, 'installed'>): Promise<Skill>
    remove(projectId: string, name: string): Promise<void>
    setInstalled(projectId: string, name: string, installed: boolean): Promise<Skill[]>
  }
  flows: {
    list(projectId: string): Promise<Flow[]>
    save(projectId: string, flow: Flow): Promise<Flow>
    remove(projectId: string, id: string): Promise<void>
    runs(projectId: string): Promise<FlowRun[]>
    run(projectId: string, flowId: string): Promise<FlowRun>
    /** Answer a human gate. */
    decide(runId: string, approve: boolean): Promise<void>
    stop(runId: string): Promise<void>
    onRun(cb: (run: FlowRun) => void): Unsubscribe
  }
  ai: {
    /** One-shot, read-only answer from an engine (Ask AI in notes, commit messages). */
    ask(projectId: string, prompt: string, engine?: EngineId): Promise<string>
  }
  browser: {
    /** Saves a PNG data URL under .vi3ecode/captures/ and returns its project-relative path. */
    saveCapture(projectId: string, dataUrl: string): Promise<string>
    /** The browser panel's <webview> registers its webContents id (null when it closes) so engines can drive it. */
    register(webContentsId: number | null): Promise<void>
    /** An engine wants the browser: open the panel. */
    onOpen(cb: () => void): Unsubscribe
  }
}

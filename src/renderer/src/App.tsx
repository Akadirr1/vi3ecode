import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EngineInfo, LiveState, Project, Settings } from '../../shared/types'
import { api } from './api'
import { AppContext, type AppCtx, type Intent, type View } from './context'
import { ChatView } from './views/ChatView'
import { TeamView } from './views/TeamView'
import { TerminalView } from './views/TerminalView'
import { BoardView } from './views/BoardView'
import { NotesView } from './views/NotesView'
import { MemoryView } from './views/MemoryView'
import { ActivityView } from './views/ActivityView'
import { SettingsView } from './views/SettingsView'

const NAV: { view: View; label: string; icon: string }[] = [
  { view: 'chat', label: 'Chat', icon: '💬' },
  { view: 'team', label: 'Agent team', icon: '👥' },
  { view: 'terminal', label: 'Terminal', icon: '⌨' },
  { view: 'board', label: 'Task board', icon: '▦' },
  { view: 'notes', label: 'Notepad', icon: '✎' },
  { view: 'memory', label: 'Memory', icon: '◈' },
  { view: 'activity', label: 'Activity', icon: '≋' },
  { view: 'settings', label: 'Settings', icon: '⚙' }
]

const LAST_PROJECT = 'vi3ecode.lastProject'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(() => safeGet(LAST_PROJECT))
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [view, setView] = useState<View>('chat')
  const [live, setLive] = useState<LiveState | null>(null)
  const [chatIntent, setChatIntent] = useState<Intent | null>(null)
  const [terminalIntent, setTerminalIntent] = useState<Intent | null>(null)

  useEffect(() => {
    void api.projects.list().then(setProjects)
    void api.settings.get().then(setSettingsState)
    void api.engines.list().then(setEngines)
  }, [])

  useEffect(() => {
    const tick = () => void api.activity.live().then(setLive)
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const theme = settings?.theme ?? 'system'
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [settings?.theme])

  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null

  const selectProject = (id: string) => {
    setProjectId(id)
    safeSet(LAST_PROJECT, id)
  }

  const openFolder = async () => {
    const p = await api.projects.open()
    if (!p) return
    setProjects(await api.projects.list())
    selectProject(p.id)
  }

  const removeProject = async (id: string) => {
    await api.projects.remove(id)
    setProjects(await api.projects.list())
  }

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettingsState(await api.settings.set(patch))
  }, [])
  const refreshEngines = useCallback(async () => setEngines(await api.engines.list(true)), [])

  const ctx = useMemo<AppCtx | null>(() => {
    if (!project || !settings) return null
    return {
      project,
      settings,
      engines,
      setSettings,
      refreshEngines,
      go: setView,
      removeProject,
      openChat: (text) => {
        setChatIntent({ text, nonce: Date.now() })
        setView('chat')
      },
      sendToTerminal: (text) => {
        setTerminalIntent({ text, nonce: Date.now() })
        setView('terminal')
      },
      chatIntent,
      terminalIntent
    }
  }, [project, settings, engines, setSettings, refreshEngines, chatIntent, terminalIntent])

  const visibleEngines = engines.filter((e) => e.enabled)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">v3</span>
          <span className="brand-name">vi3ecode</span>
        </div>

        <div className="side-section">
          <div className="side-label">Project</div>
          {projects.length > 0 ? (
            <select className="select" value={project?.id ?? ''} onChange={(e) => selectProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className="btn ghost small" onClick={openFolder}>
            + Open folder
          </button>
        </div>

        <nav className="nav" aria-label="Views">
          {NAV.map((n) => (
            <button
              key={n.view}
              className={`nav-item${view === n.view ? ' active' : ''}`}
              onClick={() => setView(n.view)}
              disabled={!ctx && n.view !== 'settings'}
              aria-current={view === n.view ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="side-section engines">
          <div className="side-label">
            Engines
            <button className="link" onClick={refreshEngines} title="Re-detect engines">
              ↻
            </button>
          </div>
          {visibleEngines.map((e) => (
            <div key={e.id} className="engine-row" title={e.installed ? `${e.bin} ${e.version ?? ''}` : e.installHint}>
              <span className={`dot ${e.installed ? 'on' : 'off'}`} />
              <span className="engine-name">{e.label}</span>
              {!e.headless && e.installed ? <span className="badge">terminal</span> : null}
            </div>
          ))}
        </div>

        {live ? (
          <div className="live" aria-live="polite">
            {live.workingChats} chat · {live.runningTeams} team · {live.waitingTeams} waiting · {live.terminals} term
          </div>
        ) : null}
      </aside>

      <main className="main">
        {ctx ? (
          <AppContext.Provider value={ctx}>
            {/* Terminal stays mounted so panes keep their xterm state across view switches. */}
            <div className="view" hidden={view !== 'terminal'}>
              <TerminalView key={ctx.project.id} active={view === 'terminal'} />
            </div>
            {view === 'chat' && <ChatView key={ctx.project.id} />}
            {view === 'team' && <TeamView key={ctx.project.id} />}
            {view === 'board' && <BoardView key={ctx.project.id} />}
            {view === 'notes' && <NotesView key={ctx.project.id} />}
            {view === 'memory' && <MemoryView key={ctx.project.id} />}
            {view === 'activity' && <ActivityView />}
            {view === 'settings' && <SettingsView />}
          </AppContext.Provider>
        ) : (
          <Welcome onOpen={openFolder} hasSettings={!!settings} />
        )}
      </main>
    </div>
  )
}

function Welcome({ onOpen, hasSettings }: { onOpen: () => void; hasSettings: boolean }) {
  return (
    <div className="welcome">
      <h1>Build with your agent team.</h1>
      <p className="muted">
        Open a folder to make it a project. Board, notes, memory and team live in <code>.vi3ecode/</code> and travel
        with your commits. Each engine signs in to its own account — vi3ecode never handles a password or token.
      </p>
      <ol className="steps">
        <li>Install the coding-agent CLIs you already use (Claude Code, Codex, Gemini CLI…).</li>
        <li>Open a folder.</li>
        <li>Chat, open a terminal, or hand a goal to your agent team.</li>
      </ol>
      <button className="btn primary" onClick={onOpen} disabled={!hasSettings}>
        Open folder
      </button>
    </div>
  )
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // per-viewer convenience only
  }
}

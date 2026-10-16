import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, LayoutGrid, MessageSquarePlus, UsersRound } from 'lucide-react'
import type { EngineInfo, Project, Settings } from '../../shared/types'
import { api } from './api'
import { AppContext, useApp, type AppCtx, type Intent, type Mode, type Tool } from './context'
import { setLanguage, t } from './i18n'
import { TopBar } from './shell/TopBar'
import { Sidebar } from './shell/Sidebar'
import { Rail } from './shell/Rail'
import { ToolView } from './shell/ToolView'
import { ToolsModal } from './shell/ToolsModal'
import { SettingsModal } from './shell/SettingsModal'
import { ChatSidebar } from './modes/chat/ChatSidebar'
import { ChatMain } from './modes/chat/ChatMain'
import { AgentSidebar } from './modes/agent/AgentSidebar'
import { AgentMain } from './modes/agent/AgentMain'
import { TerminalSidebar } from './modes/terminal/TerminalSidebar'
import { TerminalMain } from './modes/terminal/TerminalMain'

const UI_KEY = 'vi3ecode.ui'

/** Per-viewer conveniences only (mode, dock, last project); real state lives in main. */
function loadUi(): { mode?: Mode; dock?: Tool | null; projectId?: string } {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function App() {
  const initial = useMemo(loadUi, [])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(initial.projectId ?? null)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [mode, setModeState] = useState<Mode>(initial.mode ?? 'chat')
  const [tool, openTool] = useState<Tool | null>(null)
  const [dock, setDock] = useState<Tool | null>(initial.dock ?? null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [chatIntent, setChatIntent] = useState<(Intent & { append?: boolean }) | null>(null)
  const [terminalIntent, setTerminalIntent] = useState<Intent | null>(null)

  // One tool lives in one place: docking it closes it in the main area and vice versa, so two instances never fight over saves.
  const dockTool = (next: Tool | null) => {
    if (next) openTool((cur) => (cur === next ? null : cur))
    setDock(next)
  }
  const showTool = (next: Tool | null) => {
    if (next) setDock((cur) => (cur === next ? null : cur))
    openTool(next)
  }

  useEffect(() => {
    void api.projects.list().then(setProjects)
    void api.settings.get().then(setSettingsState)
    void api.engines.list().then(setEngines)
    // Usage meters arrive with Claude turns; refresh the list now and then without re-detecting.
    const tick = setInterval(() => void api.engines.list().then(setEngines), 30_000)
    // An engine asked for the browser panel (vi3ecode-browser MCP): open it so its webview can register.
    const off = api.browser.onOpen(() => dockTool('browser'))
    return () => (clearInterval(tick), off())
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ mode, dock, projectId }))
    } catch {
      // storage unavailable: fine
    }
  }, [mode, dock, projectId])

  useEffect(() => {
    const theme = settings?.theme ?? 'dark'
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [settings?.theme])

  if (settings) setLanguage(settings.language)

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettingsState(await api.settings.set(patch))
  }, [])
  const refreshEngines = useCallback(async () => setEngines(await api.engines.list(true)), [])

  // Tabs are the open projects in tab order; other registered projects are on the welcome screen.
  const tabs = (settings?.openProjects ?? []).map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p)
  const project = tabs.find((p) => p.id === projectId) ?? tabs[0] ?? null

  const selectProject = (id: string) => {
    setProjectId(id)
    setChatId(null)
    setRunId(null)
    openTool(null)
    if (settings && !settings.openProjects.includes(id)) void setSettings({ openProjects: [...settings.openProjects, id] })
  }

  const openFolder = async () => {
    const p = await api.projects.open()
    if (!p) return
    setProjects(await api.projects.list())
    selectProject(p.id)
  }

  const closeTab = (id: string) => {
    if (id === project?.id) {
      openTool(null)
      setChatId(null)
      setRunId(null)
    }
    if (settings) void setSettings({ openProjects: settings.openProjects.filter((x) => x !== id) })
  }

  const removeProject = useCallback(
    async (id: string) => {
      await api.projects.remove(id)
      setProjects(await api.projects.list())
      if (settings) await setSettings({ openProjects: settings.openProjects.filter((x) => x !== id) })
    },
    [settings, setSettings]
  )

  const ctx = useMemo<AppCtx | null>(() => {
    if (!project || !settings) return null
    return {
      project,
      projects,
      settings,
      engines,
      setSettings,
      refreshEngines,
      mode,
      setMode: (m) => {
        setModeState(m)
        openTool(null)
      },
      tool,
      openTool: showTool,
      dock,
      setDock: dockTool,
      openSettings: () => setSettingsOpen(true),
      openTools: () => setToolsOpen(true),
      chatId,
      setChatId,
      runId,
      setRunId,
      openChat: (text) => {
        setChatIntent({ text, nonce: Date.now() })
        setModeState('chat')
        openTool(null)
      },
      attachToChat: (text) => {
        setChatIntent({ text, nonce: Date.now(), append: true })
        setModeState('chat')
        openTool(null) // a full-size tool would cover the composer the text just went into
      },
      sendToTerminal: (text) => {
        setTerminalIntent({ text, nonce: Date.now() })
        setModeState('terminal')
        openTool(null)
      },
      chatIntent,
      terminalIntent,
      removeProject
    }
  }, [project, projects, settings, engines, setSettings, refreshEngines, mode, tool, dock, chatId, runId, chatIntent, terminalIntent, removeProject])

  if (!ctx) {
    return (
      <div className="app">
        <TopBar tabs={tabs} activeId={null} dockOpen={false} onSelect={selectProject} onClose={closeTab} onAdd={openFolder} onToggleDock={() => {}} />
        <Welcome projects={projects} onOpen={openFolder} onPick={selectProject} ready={!!settings} />
      </div>
    )
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app" key={ctx.settings.language}>
        <TopBar
          tabs={tabs}
          activeId={ctx.project.id}
          dockOpen={!!dock}
          onSelect={selectProject}
          onClose={closeTab}
          onAdd={openFolder}
          onToggleDock={() => dockTool(dock ? null : 'explorer')}
        />
        <div className="body" style={{ gridTemplateColumns: `var(--sidebar-w) minmax(0, 1fr) ${dock ? 'auto' : '0px'} var(--rail-w)` }}>
          <Sidebar>
            <SideActions />
            {mode === 'chat' && <ChatSidebar key={ctx.project.id} />}
            {mode === 'agent' && <AgentSidebar key={ctx.project.id} />}
            {mode === 'terminal' && <TerminalSidebar key={ctx.project.id} />}
          </Sidebar>
          <main className="main">
            {/* Terminal stays mounted so panes keep their xterm state across mode and tool switches. */}
            <div className="view" hidden={mode !== 'terminal' || !!tool}>
              <TerminalMain key={ctx.project.id} active={mode === 'terminal' && !tool} />
            </div>
            {tool ? <ToolView key={ctx.project.id} tool={tool} docked={false} /> : null}
            {!tool && mode === 'chat' && <ChatMain key={ctx.project.id} />}
            {!tool && mode === 'agent' && <AgentMain key={ctx.project.id} />}
          </main>
          {dock ? (
            <aside className="dock">
              <ToolView key={`${ctx.project.id}-${dock}`} tool={dock} docked />
            </aside>
          ) : (
            <span />
          )}
          <Rail />
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        {toolsOpen && <ToolsModal onClose={() => setToolsOpen(false)} />}
      </div>
    </AppContext.Provider>
  )
}

/** "New chat" / "New agent thread" and "Tools", above the mode's own list. */
function SideActions() {
  const { mode, openTools, setChatId, setRunId, openTool } = useApp()
  return (
    <>
      {mode === 'chat' && (
        <button className="side-action" onClick={() => (openTool(null), setChatId(null))}>
          <MessageSquarePlus size={15} />
          {t('New chat')}
        </button>
      )}
      {mode === 'agent' && (
        <button className="side-action" onClick={() => (openTool(null), setRunId(null))}>
          <UsersRound size={15} />
          {t('New agent team')}
        </button>
      )}
      <button className="side-action" onClick={openTools}>
        <LayoutGrid size={15} />
        {t('Tools')}
      </button>
    </>
  )
}

function Welcome({ projects, onOpen, onPick, ready }: { projects: Project[]; onOpen(): void; onPick(id: string): void; ready: boolean }) {
  return (
    <div className="welcome">
      <h1>{t('Build your AI agent team.')}</h1>
      <p className="muted">
        {t('Open a folder to make it a project. Board, notes, memory and team live in .vi3ecode/ and travel with your commits. Each engine signs in to its own account — vi3ecode never handles a password or a token.')}
      </p>
      <ol className="steps">
        <li>{t('Install the coding-agent CLIs you already use (Claude Code, Codex, Gemini CLI…).')}</li>
        <li>{t('Open a folder.')}</li>
        <li>{t('Chat, open a terminal, or hand a goal to your agent team.')}</li>
      </ol>
      <button className="btn primary" onClick={onOpen} disabled={!ready}>
        <FolderOpen size={15} />
        {t('Open folder')}
      </button>
      {projects.length ? (
        <div className="col" style={{ marginTop: 28 }}>
          <div className="micro">{t('Recent projects')}</div>
          {projects.map((p) => (
            <button key={p.id} className="side-action" onClick={() => onPick(p.id)} title={p.path}>
              <FolderOpen size={15} />
              <span className="grow">{p.name}</span>
              <span className="faint small mono welcome-path">{p.path}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

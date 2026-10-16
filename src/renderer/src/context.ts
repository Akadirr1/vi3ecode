import { createContext, useContext } from 'react'
import type { EngineInfo, Project, Settings } from '../../shared/types'

export type Mode = 'chat' | 'terminal' | 'agent'
export type Tool = 'explorer' | 'browser' | 'git' | 'board' | 'notes' | 'memory' | 'flow' | 'skills' | 'plugins' | 'activity'

/** A one-shot request from another view; `nonce` changes on every request. */
export interface Intent {
  text: string
  nonce: number
}

export interface AppCtx {
  project: Project
  projects: Project[]
  settings: Settings
  engines: EngineInfo[]
  setSettings(patch: Partial<Settings>): Promise<void>
  refreshEngines(): Promise<void>
  mode: Mode
  setMode(mode: Mode): void
  /** Tool shown in the main area instead of the mode surface; null shows the mode surface. */
  tool: Tool | null
  openTool(tool: Tool | null): void
  /** Tool docked on the right, beside the mode surface. */
  dock: Tool | null
  setDock(tool: Tool | null): void
  openSettings(): void
  openTools(): void
  /** Selected chat in Chat Mode and thread in Agent Mode (shared by sidebar and main area). */
  chatId: string | null
  setChatId(id: string | null): void
  runId: string | null
  setRunId(id: string | null): void
  /** Opens a new chat with `draft` placed in the composer (not sent). */
  openChat(draft: string): void
  /** Appends `text` to the composer of the open chat (or a new one), e.g. a browser capture path. */
  attachToChat(text: string): void
  /** Types `text` into the active terminal pane (creating one if needed). */
  sendToTerminal(text: string): void
  chatIntent: (Intent & { append?: boolean }) | null
  terminalIntent: Intent | null
  /** Drops a project from the app's list (files on disk are untouched). */
  removeProject(id: string): Promise<void>
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppContext')
  return ctx
}

/** Engines that are installed, not hidden, and can run headless turns. */
export function usableEngines(ctx: Pick<AppCtx, 'engines'>): EngineInfo[] {
  return ctx.engines.filter((e) => e.installed && e.enabled && e.headless)
}

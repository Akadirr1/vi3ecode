import { createContext, useContext } from 'react'
import type { EngineInfo, Project, Settings } from '../../shared/types'

export type View = 'chat' | 'team' | 'terminal' | 'board' | 'notes' | 'memory' | 'activity' | 'settings'

/** A one-shot request from another view; `nonce` changes on every request. */
export interface Intent {
  text: string
  nonce: number
}

export interface AppCtx {
  project: Project
  settings: Settings
  engines: EngineInfo[]
  setSettings(patch: Partial<Settings>): Promise<void>
  refreshEngines(): Promise<void>
  go(view: View): void
  /** Drops a project from the app's list (files on disk are untouched). */
  removeProject(id: string): Promise<void>
  /** Opens a new chat with `draft` placed in the composer (not sent). */
  openChat(draft: string): void
  /** Types `text` into the active terminal pane (creating one if needed). */
  sendToTerminal(text: string): void
  chatIntent: Intent | null
  terminalIntent: Intent | null
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppContext')
  return ctx
}

/** Engines that are installed, not hidden, and can run headless turns. */
export function usableEngines(ctx: AppCtx): EngineInfo[] {
  return ctx.engines.filter((e) => e.installed && e.enabled && e.headless)
}

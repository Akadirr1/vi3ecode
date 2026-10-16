import { ipcMain } from 'electron'
import type { Api } from '../shared/types'
import { projectsApi, settingsApi } from './store'
import { enginesApi } from './engines'
import { chatApi } from './chat'
import { teamApi } from './team'
import { boardApi, notesApi, memoryApi } from './project'
import { activityApi } from './activity'
import { ptyApi, writePty, resizePty } from './pty'
import { filesApi } from './files'
import { gitApi } from './git'
import { pluginsApi } from './plugins'
import { skillsApi } from './skills'
import { flowsApi } from './flows'
import { aiApi } from './ai'
import { browserApi } from './browser'

type Listener = 'onSession' | 'onRun' | 'onData' | 'onExit' | 'write' | 'resize'
/** What main implements: the Api minus renderer-side subscriptions and fire-and-forget sends. */
export type MainApi = { [K in keyof Api]: Omit<Api[K], Listener> }

const impl: MainApi = {
  projects: projectsApi,
  settings: settingsApi,
  engines: enginesApi,
  chat: chatApi,
  team: teamApi,
  board: boardApi,
  notes: notesApi,
  memory: memoryApi,
  activity: activityApi,
  pty: ptyApi,
  files: filesApi,
  git: gitApi,
  plugins: pluginsApi,
  skills: skillsApi,
  flows: flowsApi,
  ai: aiApi,
  browser: browserApi
}

export function registerIpc(): void {
  for (const [ns, methods] of Object.entries(impl)) {
    for (const [name, fn] of Object.entries(methods as Record<string, (...a: unknown[]) => unknown>)) {
      ipcMain.handle(`${ns}:${name}`, (_e, ...args) => fn(...args))
    }
  }
  ipcMain.on('pty:write', (_e, id: string, data: string) => writePty(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => resizePty(id, cols, rows))
}

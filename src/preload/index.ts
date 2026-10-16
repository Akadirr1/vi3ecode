import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

// Channel convention: `${namespace}:${method}`, handled in src/main/ipc.ts.
const call =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args)
const on =
  (ch: string) =>
  (cb: (...args: never[]) => void) => {
    const h = (_e: unknown, ...args: unknown[]) => (cb as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(ch, h)
    return () => void ipcRenderer.removeListener(ch, h)
  }
const ns = <T extends string>(name: string, methods: T[]) =>
  Object.fromEntries(methods.map((m) => [m, call(`${name}:${m}`)]))

const api = {
  projects: ns('projects', ['list', 'open', 'remove']),
  settings: ns('settings', ['get', 'set']),
  engines: ns('engines', ['list']),
  chat: { ...ns('chat', ['list', 'get', 'create', 'update', 'send', 'respond', 'stop', 'remove']), onSession: on('chat:session') },
  team: { ...ns('team', ['get', 'save', 'runs', 'start', 'send', 'continue', 'respond', 'stop', 'remove', 'globals', 'saveGlobal', 'useGlobal', 'removeGlobal']), onRun: on('team:run') },
  board: ns('board', ['get', 'save']),
  notes: ns('notes', ['get', 'save']),
  memory: ns('memory', ['list', 'save', 'remove']),
  activity: ns('activity', ['list', 'live']),
  pty: {
    ...ns('pty', ['create', 'list', 'attach', 'kill']),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    onData: on('pty:data'),
    onExit: on('pty:exit')
  },
  files: ns('files', ['list', 'read']),
  git: ns('git', ['status', 'diff', 'stage', 'unstage', 'commit', 'log']),
  plugins: ns('plugins', ['list', 'setActive']),
  skills: ns('skills', ['list', 'save', 'remove', 'setInstalled']),
  flows: { ...ns('flows', ['list', 'save', 'remove', 'runs', 'run', 'decide', 'stop']), onRun: on('flows:run') },
  ai: ns('ai', ['ask']),
  browser: { ...ns('browser', ['saveCapture', 'register']), onOpen: on('browser:open') }
} as unknown as Api

contextBridge.exposeInMainWorld('api', api)

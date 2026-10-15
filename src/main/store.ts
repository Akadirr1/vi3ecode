// App-level state (not committed with any repo): the project list and settings.
import { app, BrowserWindow, dialog } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project, Settings } from '../shared/types'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../shared/schema'
import { readJson, writeJson } from './fsutil'

interface State {
  projects: Project[]
  settings: Settings
}

let state: State | null = null

export const userDir = (...parts: string[]) => join(app.getPath('userData'), ...parts)
const stateFile = () => userDir('state.json')

function load(): State {
  if (state) return state
  const raw = readJson<Partial<State>>(stateFile(), {})
  state = {
    projects: Array.isArray(raw.projects) ? raw.projects.filter((p) => p && typeof p.path === 'string') : [],
    settings: sanitizeSettings(raw.settings ?? {}, DEFAULT_SETTINGS)
  }
  return state
}

const save = () => writeJson(stateFile(), load())

export function getSettings(): Settings {
  return load().settings
}

/** Resolves a project id coming from the renderer; throws for anything not registered. */
export function getProject(id: string): Project {
  const p = load().projects.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown project: ${id}`)
  return p
}

export function addProject(path: string): Project {
  const abs = resolve(path)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`)
  const s = load()
  const existing = s.projects.find((p) => p.path === abs)
  if (existing) return existing
  const project: Project = { id: randomUUID(), name: basename(abs) || abs, path: abs, addedAt: Date.now() }
  s.projects.push(project)
  save()
  return project
}

export const projectsApi = {
  async list(): Promise<Project[]> {
    return load().projects
  },
  async open(): Promise<Project | null> {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return addProject(res.filePaths[0])
  },
  async remove(id: string): Promise<void> {
    const s = load()
    s.projects = s.projects.filter((p) => p.id !== id)
    save()
  }
}

export const settingsApi = {
  async get(): Promise<Settings> {
    return getSettings()
  },
  async set(patch: Partial<Settings>): Promise<Settings> {
    const s = load()
    s.settings = sanitizeSettings(patch, s.settings)
    save()
    return s.settings
  }
}

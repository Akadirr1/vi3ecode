// Open panes per project, shared by the sidebar (Processes) and the grid. Kept for the window's lifetime,
// like the PTYs in main, so switching projects keeps pane order and renamed titles.
import { useSyncExternalStore } from 'react'
import type { PtyInfo } from '../../../../shared/types'

export interface Pane {
  info: PtyInfo
  exitCode?: number
  busy?: boolean
  /** False when the pane's bell is off (engine panes ring by default). */
  notify?: boolean
}

export interface PaneState {
  panes: Pane[]
  focused: string | null
  /** Bumped by every focus request, so asking for the already-focused pane still moves keyboard focus. */
  tick: number
}

const state = new Map<string, PaneState>()
const listeners = new Set<() => void>()
const EMPTY: PaneState = { panes: [], focused: null, tick: 0 }

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const getPanes = (projectId: string): PaneState => state.get(projectId) ?? EMPTY

export function usePanes(projectId: string): PaneState {
  return useSyncExternalStore(subscribe, () => getPanes(projectId))
}

/** `patch` returns null when nothing changed, so idle ticks don't re-render. */
export function setPanes(projectId: string, patch: (s: PaneState) => Partial<PaneState> | null): void {
  const cur = getPanes(projectId)
  const next = patch(cur)
  if (!next) return
  state.set(projectId, { ...cur, ...next })
  listeners.forEach((l) => l())
}

export const focusPane = (projectId: string, id: string): void => setPanes(projectId, (s) => ({ focused: id, tick: s.tick + 1 }))

// The open project's team and threads, shared by the sidebar, the thread view and the team dialog.
import { useEffect, useSyncExternalStore } from 'react'
import type { RunStatus, Team, TeamRun } from '../../../../shared/types'
import { api } from '../../api'

const teams = new Map<string, Team>()
const runs = new Map<string, TeamRun[]>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
const EMPTY: TeamRun[] = []
let live = false

const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Adds or replaces a thread; an older copy (e.g. a start() result after live events) never wins. */
export function putRun(run: TeamRun): void {
  const list = runs.get(run.projectId) ?? []
  const cur = list.find((r) => r.id === run.id)
  if (cur && cur.updatedAt > run.updatedAt) return
  runs.set(run.projectId, [run, ...list.filter((r) => r.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt))
  notify()
}

function load(projectId: string): void {
  if (!live) {
    live = true
    api.team.onRun(putRun)
  }
  if (requested.has(projectId)) return
  requested.add(projectId)
  void api.team.runs(projectId).then((list) => list.forEach(putRun))
  void api.team.get(projectId).then((t) => setTeam(projectId, t))
}

export function useTeam(projectId: string): Team | null {
  useEffect(() => load(projectId), [projectId])
  return useSyncExternalStore(subscribe, () => teams.get(projectId) ?? null)
}

export function useRuns(projectId: string): TeamRun[] {
  useEffect(() => load(projectId), [projectId])
  return useSyncExternalStore(subscribe, () => runs.get(projectId) ?? EMPTY)
}

/** Local update only (live UI while editing); persist with saveTeam or api.team.save. */
export function setTeam(projectId: string, team: Team): void {
  teams.set(projectId, team)
  notify()
}

/** Persists and adopts the sanitized copy main returns. */
export async function saveTeam(projectId: string, team: Team): Promise<Team> {
  setTeam(projectId, team)
  const saved = await api.team.save(projectId, team)
  setTeam(projectId, saved)
  return saved
}

/** Agent ids with a turn running in any of these threads. */
export function workingAgents(list: TeamRun[]): Set<string> {
  const ids = new Set<string>()
  for (const r of list) if (r.status === 'running') for (const turn of r.turns) if (turn.kind === 'agent' && turn.status === 'running') ids.add(turn.agentId)
  return ids
}

/** Thread status chip: label and badge tone. */
export const RUN_STATUS: Record<RunStatus, [string, string]> = {
  running: ['running', 'brand'],
  waiting: ['waiting on you', 'warn'],
  done: ['awaiting you', 'ok'],
  stopped: ['stopped', ''],
  error: ['error', 'danger'],
  budget: ['budget reached', 'warn'],
  'hop-cap': ['hop limit', 'warn']
}

export { errorText } from '../../components/format'

/** Agent text without the protocol line the handoff / done card already shows. */
export const stripProtocol = (text: string): string =>
  text.replace(/\n?[\s>*_`#-]*(@(handoff|done|ask-user)\b|(HANDOFF|DONE)[*_`]*\s*[:：])[^\n]*\s*$/i, '').trim()

export const clock = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

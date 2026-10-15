// Local activity record: what happened and how it turned out — never conversation text, tool
// arguments, file contents, command output, secrets or paths. It never leaves the machine.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ActivityEvent, ActivityFilter, LiveState } from '../shared/types'
import { userDir } from './store'

const MAX = 2000
let events: ActivityEvent[] | null = null
const file = () => userDir('activity.jsonl')

function load(): ActivityEvent[] {
  if (events) return events
  try {
    events = readFileSync(file(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as ActivityEvent]
        } catch {
          return []
        }
      })
      .slice(-MAX)
  } catch {
    events = []
  }
  return events
}

export function record(e: Omit<ActivityEvent, 'ts'>): void {
  // Copy only the known, content-free fields.
  const ev: ActivityEvent = {
    ts: Date.now(),
    source: e.source,
    kind: String(e.kind).slice(0, 60),
    outcome: e.outcome,
    ...(e.projectId ? { projectId: e.projectId } : {}),
    ...(e.engine ? { engine: e.engine } : {}),
    ...(typeof e.durationMs === 'number' ? { durationMs: Math.round(e.durationMs) } : {}),
    ...(typeof e.costUsd === 'number' ? { costUsd: e.costUsd } : {})
  }
  const all = load()
  all.push(ev)
  try {
    mkdirSync(dirname(file()), { recursive: true })
    if (all.length > MAX * 1.5) {
      events = all.slice(-MAX)
      writeFileSync(file(), events.map((x) => JSON.stringify(x)).join('\n') + '\n')
    } else appendFileSync(file(), JSON.stringify(ev) + '\n')
  } catch {
    // The record is best-effort; never break a run because logging failed.
  }
}

type Counter = () => number
const counters: Partial<Record<keyof LiveState, Counter>> = {}

/** Modules owning live work register a counter, so this module imports none of them. */
export function registerLive(key: keyof LiveState, fn: Counter): void {
  counters[key] = fn
}

export const activityApi = {
  async list(filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
    let out = load()
    if (filter.source) out = out.filter((e) => e.source === filter.source)
    if (filter.projectId) out = out.filter((e) => e.projectId === filter.projectId)
    if (filter.failuresOnly) out = out.filter((e) => e.outcome === 'error')
    return out.slice(-(filter.limit ?? 500)).reverse()
  },
  async live(): Promise<LiveState> {
    const v = (k: keyof LiveState) => counters[k]?.() ?? 0
    return { workingChats: v('workingChats'), runningTeams: v('runningTeams'), waitingTeams: v('waitingTeams'), terminals: v('terminals') }
  }
}

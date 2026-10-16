// Settings that skip approvals (Full access, auto-approve) count only once someone chose them on this machine:
// a cloned repo's .vi3ecode files cannot switch them on by themselves (the same rule as plugins). What was
// confirmed is the exact set, so a later commit that adds Full access to another agent is not covered.
import { createHash } from 'node:crypto'
import type { Flow, Team } from '../shared/types'
import { userDir } from './store'
import { readJson, writeJson } from './fsutil'

const file = () => userDir('trusted-settings.json')
const key = (path: string, what: string, risky: unknown) => createHash('sha256').update(`${path}\n${what}\n${JSON.stringify(risky)}`).digest('hex')

function trusted(): Set<string> {
  const raw = readJson<unknown>(file(), [])
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
}

function trust(k: string): void {
  const all = trusted()
  if (all.has(k)) return
  all.add(k)
  writeJson(file(), [...all].slice(-1000))
}

const teamRisk = (t: Team) => ({ auto: t.routing.autoApprove, full: t.agents.filter((a) => a.permission === 'full').map((a) => a.id).sort() })
const flowRisk = (f: Flow) => f.steps.filter((s) => s.approval === 'full').map((s) => s.id).sort()

/** The user saved this team here (dialog, library): its Full access and auto-approve are theirs. */
export function trustTeam(path: string, team: Team): void {
  trust(key(path, 'team', teamRisk(team)))
}

/** The team as it may run: unconfirmed Full access drops to Edits and auto-approve to off. */
export function effectiveTeam(path: string, team: Team): Team {
  const r = teamRisk(team)
  if ((!r.auto && !r.full.length) || trusted().has(key(path, 'team', r))) return team
  return {
    ...team,
    routing: { ...team.routing, autoApprove: false },
    agents: team.agents.map((a) => (a.permission === 'full' ? { ...a, permission: 'edits' } : a))
  }
}

export function trustFlow(path: string, flow: Flow): void {
  trust(key(path, `flow:${flow.id}`, flowRisk(flow)))
}

export function effectiveFlow(path: string, flow: Flow): Flow {
  const r = flowRisk(flow)
  if (!r.length || trusted().has(key(path, `flow:${flow.id}`, r))) return flow
  return { ...flow, steps: flow.steps.map((s) => (s.approval === 'full' ? { ...s, approval: 'edits' } : s)) }
}

// Settings that skip approvals (Full access, auto-approve) count only once someone switched them on in this app,
// on this machine: a cloned repo's .vi3ecode files cannot turn them on by themselves (the same rule as plugins).
// Trust is per setting. Saving a file trusts only what the save switched on, so an unrelated save (a renamed agent,
// the Auto-relay toggle) never confirms a Full access that came in with the repo.
import { createHash } from 'node:crypto'
import type { Flow, Team } from '../shared/types'
import { userDir } from './store'
import { readJson, writeJson } from './fsutil'

const file = () => userDir('trusted-settings.json')
const key = (path: string, item: string) => createHash('sha256').update(`${path}\n${item}`).digest('hex')

function trusted(): Set<string> {
  const raw = readJson<unknown>(file(), [])
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
}

function trustNew(path: string, items: string[], before: string[]): void {
  const had = new Set(before)
  const fresh = items.filter((i) => !had.has(i)).map((i) => key(path, i))
  if (!fresh.length) return
  const all = trusted()
  for (const k of fresh) all.add(k)
  writeJson(file(), [...all].slice(-2000))
}

const teamItems = (t: Team | null) =>
  t ? [...(t.routing.autoApprove ? ['team:autoApprove'] : []), ...t.agents.filter((a) => a.permission === 'full').map((a) => `team:full:${a.id}`)] : []
const flowItems = (f: Flow | null) => (f ? f.steps.filter((s) => s.approval === 'full').map((s) => `flow:${f.id}:full:${s.id}`) : [])

/** The user saved `team` over `before` in this app: what the save switched on is theirs. */
export function trustTeam(path: string, team: Team, before: Team | null): void {
  trustNew(path, teamItems(team), teamItems(before))
}

/** The team as it may run: unconfirmed Full access drops to Edits, unconfirmed auto-approve to off. */
export function effectiveTeam(path: string, team: Team): Team {
  if (!teamItems(team).length) return team
  const ok = trusted()
  const has = (item: string) => ok.has(key(path, item))
  return {
    ...team,
    routing: { ...team.routing, autoApprove: team.routing.autoApprove && has('team:autoApprove') },
    agents: team.agents.map((a) => (a.permission === 'full' && !has(`team:full:${a.id}`) ? { ...a, permission: 'edits' } : a))
  }
}

/** What the team file switches on that is not confirmed here: 'autoApprove' and agent ids with Full access. */
export function unconfirmedTeam(path: string, team: Team): string[] {
  const eff = effectiveTeam(path, team)
  return [...(team.routing.autoApprove && !eff.routing.autoApprove ? ['autoApprove'] : []), ...team.agents.filter((a, i) => a.permission !== eff.agents[i].permission).map((a) => a.id)]
}

/** The user looked at the team's Full access and auto-approve and allowed them on this machine. */
export function confirmTeam(path: string, team: Team): void {
  trustNew(path, teamItems(team), [])
}

export function trustFlow(path: string, flow: Flow, before: Flow | null): void {
  trustNew(path, flowItems(flow), flowItems(before))
}

export function effectiveFlow(path: string, flow: Flow): Flow {
  if (!flowItems(flow).length) return flow
  const ok = trusted()
  return { ...flow, steps: flow.steps.map((s) => (s.approval === 'full' && !ok.has(key(path, `flow:${flow.id}:full:${s.id}`)) ? { ...s, approval: 'edits' } : s)) }
}

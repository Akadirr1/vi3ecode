import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEAM, sanitizeFlow } from '../src/shared/schema'
import type { Team } from '../src/shared/types'

const data = mkdtempSync(join(tmpdir(), 'vi3e-trust-'))
vi.mock('../src/main/store', () => ({ userDir: (...p: string[]) => join(data, ...p) }))
const { effectiveFlow, effectiveTeam, trustFlow, trustTeam } = await import('../src/main/trust')

const risky: Team = { ...DEFAULT_TEAM, routing: { ...DEFAULT_TEAM.routing, autoApprove: true }, agents: DEFAULT_TEAM.agents.map((a, i) => (i === 1 ? { ...a, permission: 'full' } : a)) }

describe('repo settings that skip approvals', () => {
  it('drop to Edits and no auto-approve until switched on in the app', () => {
    const t = effectiveTeam('/p', risky)
    expect(t.routing.autoApprove).toBe(false)
    expect(t.agents[1].permission).toBe('edits')
  })
  it('are not confirmed by an unrelated save of the same file', () => {
    trustTeam('/p', { ...risky, agents: risky.agents.map((a, i) => (i === 0 ? { ...a, name: 'Boss' } : a)) }, risky)
    expect(effectiveTeam('/p', risky).agents[1].permission).toBe('edits')
    expect(effectiveTeam('/p', risky).routing.autoApprove).toBe(false)
  })
  it('count once the user switches them on, one by one and per project', () => {
    const edits = { ...risky, agents: risky.agents.map((a, i) => (i === 1 ? { ...a, permission: 'edits' as const } : a)) }
    trustTeam('/p', risky, edits) // the user set agent 1 back to Full
    expect(effectiveTeam('/p', risky).agents[1].permission).toBe('full')
    expect(effectiveTeam('/p', risky).routing.autoApprove).toBe(false) // was already on in the file: still unconfirmed
    expect(effectiveTeam('/other', risky).agents[1].permission).toBe('edits')
    const more = { ...risky, agents: risky.agents.map((a, i) => (i === 2 ? { ...a, permission: 'full' as const } : a)) }
    expect(effectiveTeam('/p', more).agents[2].permission).toBe('edits')
  })
  it('apply to flow steps too', () => {
    const flow = sanitizeFlow({ id: 'f1', name: 'F', steps: [{ id: 's1', kind: 'task', title: 'x', prompt: 'y', approval: 'full' }] })
    expect(effectiveFlow('/p', flow).steps[0].approval).toBe('edits')
    trustFlow('/p', flow, flow)
    expect(effectiveFlow('/p', flow).steps[0].approval).toBe('edits')
    trustFlow('/p', flow, null)
    expect(effectiveFlow('/p', flow).steps[0].approval).toBe('full')
  })
})

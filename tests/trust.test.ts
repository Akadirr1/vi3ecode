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
  it('drop to Edits and no auto-approve until saved on this machine', () => {
    const t = effectiveTeam('/p', risky)
    expect(t.routing.autoApprove).toBe(false)
    expect(t.agents[1].permission).toBe('edits')
    trustTeam('/p', risky)
    expect(effectiveTeam('/p', risky)).toBe(risky)
    expect(effectiveTeam('/other', risky).routing.autoApprove).toBe(false)
  })
  it('need a new confirmation when another agent gets Full access', () => {
    const more = { ...risky, agents: risky.agents.map((a, i) => (i === 2 ? { ...a, permission: 'full' as const } : a)) }
    expect(effectiveTeam('/p', more).agents[2].permission).toBe('edits')
  })
  it('apply to flow steps too', () => {
    const flow = sanitizeFlow({ id: 'f1', name: 'F', steps: [{ id: 's1', kind: 'task', title: 'x', prompt: 'y', approval: 'full' }] })
    expect(effectiveFlow('/p', flow).steps[0].approval).toBe('edits')
    trustFlow('/p', flow)
    expect(effectiveFlow('/p', flow).steps[0].approval).toBe('full')
  })
})

import { describe, expect, it } from 'vitest'
import { buildTeamPrompt, decideNext, parseTurnEnd, withHistory } from '../src/shared/prompt'
import { DEFAULT_TEAM, sanitizeTeam } from '../src/shared/schema'
import type { TeamTurn } from '../src/shared/types'

const team = DEFAULT_TEAM
const names = team.agents.map((a) => a.name)
const agent = (id: string) => team.agents.find((a) => a.id === id)!

describe('parseTurnEnd', () => {
  it('reads a handoff with an em dash note', () => {
    expect(parseTurnEnd('Mapped the deps.\n\nHANDOFF: Developer — implement token refresh', names)).toEqual({
      handoff: { to: 'Developer', note: 'implement token refresh' }
    })
  })
  it('tolerates markdown decoration, case and "to"', () => {
    expect(parseTurnEnd('**handoff:** to @qa: review the patch', names).handoff).toEqual({ to: 'QA', note: 'review the patch' })
  })
  it('matches multi-word names before shorter prefixes', () => {
    expect(parseTurnEnd('HANDOFF: QA Lead - sign off', ['QA', 'QA Lead']).handoff).toEqual({ to: 'QA Lead', note: 'sign off' })
  })
  it('does not match a name that is only a prefix of a word', () => {
    expect(parseTurnEnd('HANDOFF: QAX - x', ['QA']).handoff?.to).toBe('QAX')
  })
  it('takes the last marker and reads DONE', () => {
    expect(parseTurnEnd('HANDOFF: QA - check\nQA approved.\nDONE: shipped session refresh', names)).toEqual({ done: 'shipped session refresh' })
  })
  it('returns nothing without a marker', () => {
    expect(parseTurnEnd('just some text', names)).toEqual({})
  })
})

describe('decideNext', () => {
  it('routes a handoff to the named teammate', () => {
    expect(decideNext(team, agent('lead'), { handoff: { to: 'Analyst', note: 'map it' } })).toEqual({ kind: 'handoff', agentId: 'analyst', note: 'map it' })
  })
  it('only the lead can finish', () => {
    expect(decideNext(team, agent('lead'), { done: 'ok' })).toEqual({ kind: 'done', summary: 'ok' })
    expect(decideNext(team, agent('qa'), { done: 'ok' })).toMatchObject({ kind: 'handoff', agentId: 'lead' })
  })
  it('honours allowed handoff targets and return-to-lead off', () => {
    const t = structuredClone(team)
    const dev = t.agents.find((a) => a.id === 'developer')!
    dev.handoffs = ['qa']
    expect(decideNext(t, dev, { handoff: { to: 'Designer', note: 'x' } })).toMatchObject({ kind: 'handoff', agentId: 'lead' })
    expect(decideNext(t, dev, { handoff: { to: 'QA', note: 'x' } })).toMatchObject({ kind: 'handoff', agentId: 'qa' })
    t.routing.returnToLead = false
    expect(decideNext(t, dev, {})).toMatchObject({ kind: 'wait' })
    expect(decideNext(t, agent('qa'), { done: 'ok' })).toMatchObject({ kind: 'done' })
  })
  it('sends unclear endings back to the lead, and makes a silent lead wait', () => {
    expect(decideNext(team, agent('developer'), {})).toMatchObject({ kind: 'handoff', agentId: 'lead' })
    expect(decideNext(team, agent('developer'), { handoff: { to: 'Nobody', note: '' } })).toMatchObject({ kind: 'handoff', agentId: 'lead' })
    expect(decideNext(team, agent('lead'), {})).toMatchObject({ kind: 'wait' })
    expect(decideNext(team, agent('lead'), { handoff: { to: 'Lead', note: '' } })).toMatchObject({ kind: 'wait' })
  })
})

describe('buildTeamPrompt', () => {
  it('includes roster, goal, permission, protocol and the handoff note', () => {
    const turns: TeamTurn[] = [
      { id: 't1', kind: 'agent', agentId: 'lead', agentName: 'Lead', engine: 'claude', text: 'x'.repeat(5000), tools: [], filesTouched: ['a.ts'], status: 'done', startedAt: 0 }
    ]
    const p = buildTeamPrompt({ team, agent: agent('developer'), goal: 'Add refresh', turns, note: 'do track A', from: 'Lead' })
    expect(p).toContain('You are Developer')
    expect(p).toContain('- QA (tests & review)')
    expect(p).toContain('Add refresh')
    expect(p).toContain('Lead handed off to you: do track A')
    expect(p).toContain('HANDOFF: <teammate name>')
    expect(p).toContain('hand off to Lead instead')
    expect(p).toContain('[truncated]')
    expect(p).toContain('files touched: a.ts')
    expect(p).toContain('Permission: edits')
    expect(p).toContain('You may hand off to: Lead, Analyst, QA, Designer.')
  })
})

describe('withHistory', () => {
  it('returns the text alone without history and replays recent history otherwise', () => {
    expect(withHistory([], 'hi')).toBe('hi')
    const h = withHistory(
      [
        { id: '1', role: 'user', text: 'first', ts: 0 },
        { id: '2', role: 'assistant', text: 'answer', ts: 0 }
      ],
      'next'
    )
    expect(h).toMatch(/User: first\n\nAssistant: answer\n<\/conversation-so-far>\n\nnext$/)
  })
})

describe('sanitizeTeam', () => {
  it('keeps exactly one lead and unique names and ids', () => {
    const t = sanitizeTeam({ agents: [{ id: 'a', name: 'Dev' }, { id: 'a', name: 'dev', lead: true }, { id: 'b', name: 'X', lead: true, engine: 'nope' }] })
    expect(t.agents.filter((a) => a.lead).map((a) => a.name)).toEqual(['dev 2'])
    expect(new Set(t.agents.map((a) => a.id)).size).toBe(3)
    expect(t.agents[2].engine).toBe('claude')
  })
  it('falls back to the default team on garbage', () => {
    expect(sanitizeTeam(null).agents.length).toBe(DEFAULT_TEAM.agents.length)
  })
})

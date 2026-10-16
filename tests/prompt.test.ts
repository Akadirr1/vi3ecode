import { describe, expect, it } from 'vitest'
import { buildTeamPrompt, decideNext, parseTurnEnd, withHistory } from '../src/shared/prompt'
import { DEFAULT_TEAM, sanitizeTeam } from '../src/shared/schema'
import type { TeamTurn } from '../src/shared/types'

const team = DEFAULT_TEAM
const names = team.agents.map((a) => a.name)
const agent = (id: string) => team.agents.find((a) => a.id === id)!

describe('parseTurnEnd', () => {
  it('reads @handoff with one or more ids, copies and decoration', () => {
    expect(parseTurnEnd('Mapped the deps.\n\n@handoff dev: implement token refresh', names)).toEqual({ handoff: { to: ['dev'], note: 'implement token refresh' } })
    expect(parseTurnEnd('**@handoff qa, designer, dev~2: check it**', names).handoff).toEqual({ to: ['qa', 'designer', 'dev'], note: 'check it' })
  })
  it('reads @done and @ask-user (text or questions JSON)', () => {
    expect(parseTurnEnd('All good.\n@done: shipped session refresh', names)).toEqual({ done: 'shipped session refresh' })
    expect(parseTurnEnd('@ask-user: Which branch?', names)).toEqual({ ask: 'Which branch?' })
    const json = '@ask-user: {"questions":[{"question":"Which plan?","header":"Plan","options":[{"label":"Monthly"},{"label":"Yearly"}],"multiSelect":false}]}'
    expect(parseTurnEnd(json, names)).toEqual({ ask: 'Which plan? (Monthly / Yearly)' })
  })
  it('still understands legacy HANDOFF/DONE lines', () => {
    expect(parseTurnEnd('HANDOFF: Developer — implement it', names)).toEqual({ handoff: { to: ['Developer'], note: 'implement it' } })
    expect(parseTurnEnd('**handoff:** to @qa: review the patch', names).handoff).toEqual({ to: ['QA'], note: 'review the patch' })
    expect(parseTurnEnd('HANDOFF: QA Lead - sign off', ['QA', 'QA Lead']).handoff).toEqual({ to: ['QA Lead'], note: 'sign off' })
  })
  it('takes the last protocol line and returns nothing without one', () => {
    expect(parseTurnEnd('@handoff qa: check\nQA approved.\n@done: ok', names)).toEqual({ done: 'ok' })
    expect(parseTurnEnd('just some text', names)).toEqual({})
  })
})

describe('decideNext', () => {
  it('routes a handoff by id or name, and starts waves', () => {
    expect(decideNext(team, agent('lead'), { handoff: { to: ['analyst'], note: 'map it' } })).toEqual({ kind: 'handoff', agentIds: ['analyst'], note: 'map it' })
    expect(decideNext(team, agent('lead'), { handoff: { to: ['QA', 'designer'], note: 'look' } })).toEqual({ kind: 'handoff', agentIds: ['qa', 'designer'], note: 'look' })
  })
  it('only the lead can finish; questions go to the user', () => {
    expect(decideNext(team, agent('lead'), { done: 'ok' })).toEqual({ kind: 'done', summary: 'ok' })
    expect(decideNext(team, agent('qa'), { done: 'ok' })).toMatchObject({ kind: 'handoff', agentIds: ['lead'] })
    expect(decideNext(team, agent('dev'), { ask: 'Which db?' })).toEqual({ kind: 'ask', question: 'Which db?' })
  })
  it('honours allowed handoff targets and return-to-lead off', () => {
    const t = structuredClone(team)
    const dev = t.agents.find((a) => a.id === 'dev')!
    expect(decideNext(t, dev, { handoff: { to: ['designer'], note: 'x' } })).toMatchObject({ kind: 'handoff', agentIds: ['lead'] })
    expect(decideNext(t, dev, { handoff: { to: ['qa'], note: 'x' } })).toMatchObject({ kind: 'handoff', agentIds: ['qa'] })
    t.routing.returnToLead = false
    expect(decideNext(t, dev, {})).toMatchObject({ kind: 'wait' })
    expect(decideNext(t, t.agents.find((a) => a.id === 'qa')!, { done: 'ok' })).toMatchObject({ kind: 'done' })
  })
  it('sends unclear endings back to the lead, and makes a silent lead wait', () => {
    expect(decideNext(team, agent('dev'), {})).toMatchObject({ kind: 'handoff', agentIds: ['lead'] })
    expect(decideNext(team, agent('dev'), { handoff: { to: ['Nobody'], note: '' } })).toMatchObject({ kind: 'handoff', agentIds: ['lead'] })
    expect(decideNext(team, agent('lead'), {})).toMatchObject({ kind: 'wait' })
    expect(decideNext(team, agent('lead'), { handoff: { to: ['lead'], note: '' } })).toMatchObject({ kind: 'wait' })
  })
})

const turn = (over: Partial<TeamTurn>): TeamTurn => ({ id: 't', kind: 'agent', agentId: 'lead', agentName: 'Lead', engine: 'claude', text: '', tools: [], filesTouched: [], status: 'done', startedAt: 0, ...over })

describe('buildTeamPrompt', () => {
  it('first turn: persona, team, permission, whole thread, task and protocol', () => {
    const turns = [turn({ kind: 'user', agentName: 'You', text: 'Add refresh' }), turn({ text: 'x'.repeat(9000), filesTouched: ['a.ts'] })]
    const p = buildTeamPrompt({ team, agent: agent('dev'), goal: 'Add refresh', turns, note: 'do track A', from: 'Lead' })
    expect(p).toContain('You are Developer, the Implementation agent')
    expect(p).toContain('- qa — QA (Tests & review)')
    expect(p).toContain('THREAD SO FAR')
    expect(p).toContain('[User] Add refresh')
    expect(p).toContain('[truncated]')
    expect(p).toContain('files touched: a.ts')
    expect(p).toContain('Lead handed off to you: do track A')
    expect(p).toContain('you may hand off to: lead, qa')
    expect(p).toContain('YOUR PERMISSION: edits')
  })
  it('resumed turn: only what is new since the agent spoke', () => {
    const turns = [turn({ text: 'old' }), turn({ agentId: 'dev', agentName: 'Developer', text: 'mine' }), turn({ agentName: 'QA', text: 'new finding' })]
    const p = buildTeamPrompt({ team, agent: agent('dev'), goal: 'g', turns, since: 1, note: 'fix it', from: 'QA' })
    expect(p.startsWith('NEW IN THE THREAD SINCE YOUR LAST TURN')).toBe(true)
    expect(p).toContain('[QA] new finding')
    expect(p).not.toContain('old')
  })
  it('parallel branch turns may only finish with @done', () => {
    const p = buildTeamPrompt({ team, agent: agent('qa'), goal: 'g', turns: [], note: 'check', wave: ['Designer'] })
    expect(p).toContain('PARALLEL BRANCH: Designer')
    expect(p).not.toContain('HANDOFF PROTOCOL')
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

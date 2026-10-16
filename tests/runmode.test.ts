import { describe, expect, it } from 'vitest'
import { canPlan, withRunMode } from '../src/shared/runMode'
import type { ChatMessage } from '../src/shared/types'

const user = (text: string, mode?: 'plan', status?: ChatMessage['status']): ChatMessage => ({ id: text, role: 'user', text, ts: 0, ...(mode ? { mode } : {}), ...(status ? { status } : {}) })
const reply: ChatMessage = { id: 'r', role: 'assistant', text: 'ok', ts: 0 }

describe('chat run mode', () => {
  it('prefixes a Plan turn with the plan instruction', () => {
    expect(withRunMode(user('add login', 'plan'), [])).toMatch(/^\[Plan mode: analyze in read-only mode.*\]\n\nadd login$/s)
  })
  it('tells the first Build turn after a plan that plan mode is over, and only that one', () => {
    const afterPlan = [user('add login', 'plan'), reply]
    expect(withRunMode(user('go ahead'), afterPlan)).toMatch(/^\[System note: plan mode has ended.*\]\n\ngo ahead$/s)
    expect(withRunMode(user('more'), [...afterPlan, user('go ahead'), reply])).toBe('more')
    // a message folded into a running turn does not count as the previous turn
    expect(withRunMode(user('go'), [...afterPlan, user('also this', undefined, 'steered')])).toMatch(/^\[System note/)
  })
  it('is offered for the engines the original offers it for', () => {
    expect(['claude', 'codex', 'cursor', 'gemini', 'opencode'].map((e) => canPlan(e as never))).toEqual([true, true, true, false, false])
  })
})

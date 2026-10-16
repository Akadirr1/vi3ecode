import { describe, expect, it, vi } from 'vitest'
import type { EngineAdapter } from '../src/main/engines/types'

// The fake engine is node itself, printing Codex JSONL.
vi.mock('../src/main/engines', () => ({ binOf: () => process.execPath, spawnTarget: (bin: string) => ({ command: bin, args: [] }) }))
const { runTurn } = await import('../src/main/runner')
const { codex } = await import('../src/main/engines/codex')

const fake = (lines: object[]): EngineAdapter => ({
  ...codex,
  build: () => ({ args: ['-e', `for (const l of ${JSON.stringify(lines.map((l) => JSON.stringify(l)))}) console.log(l)`] })
})
const notice = { type: 'item.completed', item: { type: 'error', message: 'model luna is not available on this plan; using the default' } }
const answer = { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }

describe('runTurn', () => {
  it('a completed turn with an answer is not failed by an earlier notice', async () => {
    const r = await runTurn(fake([notice, answer, { type: 'turn.completed' }]), process.cwd(), { prompt: 'x', approval: 'read-only' }).done
    expect(r.text).toBe('hi')
    expect(r.error).toBeUndefined()
  })

  it('a notice without an answer is still the error', async () => {
    const r = await runTurn(fake([notice, { type: 'turn.completed' }]), process.cwd(), { prompt: 'x', approval: 'read-only' }).done
    expect(r.error).toMatch(/luna/)
  })
})

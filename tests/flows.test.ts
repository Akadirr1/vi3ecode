import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Flow, FlowRun, FlowRunStep } from '../src/shared/types'
import { CONTEXT_CAP, parseVerdict, stepPrompt } from '../src/shared/flow'

const root = mkdtempSync(join(tmpdir(), 'vi3e-flows-'))
const replies: string[] = []
const prompts: string[] = []
vi.mock('../src/main/store', () => ({
  getProject: (id: string) => ({ id, name: 'p', path: join(root, 'proj'), addedAt: 0 }),
  getSettings: () => ({ defaultEngine: 'claude' }),
  userDir: (...p: string[]) => join(root, 'user', ...p)
}))
vi.mock('../src/main/events', () => ({ emit: () => {}, notify: () => {} }))
vi.mock('../src/main/activity', () => ({ record: () => {} }))
vi.mock('../src/main/engines', () => ({ getAdapter: (id: string) => ({ id }) }))
vi.mock('../src/main/runner', () => ({
  runTurn: (_a: unknown, _cwd: string, o: { prompt: string }) => {
    prompts.push(o.prompt)
    const text = replies.shift() ?? 'ok'
    return { done: Promise.resolve({ text, tools: [], files: [], costUsd: 0.01, stopped: false, durationMs: 1 }), stop() {} }
  }
}))
const { flowsApi } = await import('../src/main/flows')

const flow = (kinds: ('task' | 'review' | 'gate')[]): Flow => ({
  version: 1,
  id: 'f1',
  name: 'Ship',
  goal: 'Add a login page',
  steps: kinds.map((kind, i) => ({ id: `s${i}`, kind, title: `Step ${i + 1}`, prompt: `do ${i + 1}` })),
  updatedAt: 0
})
const done = (title: string, text: string): FlowRunStep => ({ stepId: title, title, kind: 'task', status: 'done', text })

describe('step prompt', () => {
  it('carries the goal, earlier outputs and the step; reviews ask for a verdict', () => {
    const p = stepPrompt(flow(['task', 'review']), 1, [done('Step 1', 'built it')])
    expect(p).toContain('Add a login page')
    expect(p).toContain('built it')
    expect(p).toContain('do 2')
    expect(p).toContain('VERDICT: PASS')
    expect(stepPrompt(flow(['task']), 0, [])).not.toContain('VERDICT')
  })
  it('keeps the newest output when earlier steps are long', () => {
    const p = stepPrompt(flow(['task', 'task', 'task']), 2, [done('a', 'x'.repeat(20_000)), done('b', 'NEWEST')])
    expect(p).toContain('NEWEST')
    expect(p.length).toBeLessThan(CONTEXT_CAP + 1000)
  })
})

describe('verdicts', () => {
  it('reads the last verdict line, with or without markdown', () => {
    expect(parseVerdict('looks good\nVERDICT: PASS')).toEqual({ pass: true, reason: '' })
    expect(parseVerdict('**VERDICT: FAIL — tests break**')).toEqual({ pass: false, reason: 'tests break' })
    expect(parseVerdict('VERDICT: FAIL - x\nfixed\nverdict: pass')?.pass).toBe(true)
    expect(parseVerdict('no verdict here')).toBeNull()
  })
})

async function settle(runId: string, until: (r: FlowRun) => boolean): Promise<FlowRun> {
  for (let i = 0; i < 100; i++) {
    const r = (await flowsApi.runs('p1')).find((x) => x.id === runId)!
    if (until(r)) return r
    await new Promise((res) => setTimeout(res, 5))
  }
  throw new Error('run did not settle')
}

describe('runner', () => {
  it('a failing review stops the run', async () => {
    await flowsApi.save('p1', flow(['task', 'review', 'task']))
    replies.push('implemented', 'VERDICT: FAIL — no tests')
    const run = await flowsApi.run('p1', 'f1')
    const r = await settle(run.id, (x) => x.status !== 'running')
    expect(r.status).toBe('error')
    expect(r.steps.map((s) => s.status)).toEqual(['done', 'error', 'skipped'])
    expect(r.steps[1].error).toContain('no tests')
    expect(r.costUsd).toBeCloseTo(0.02)
    expect(prompts.at(-1)).toContain('implemented')
  })
  it('a gate waits; approve continues, reject ends the run', async () => {
    await flowsApi.save('p1', flow(['task', 'gate', 'task']))
    const a = await flowsApi.run('p1', 'f1')
    await settle(a.id, (x) => x.status === 'waiting')
    await flowsApi.decide(a.id, true)
    expect((await settle(a.id, (x) => x.status === 'done')).steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])

    const b = await flowsApi.run('p1', 'f1')
    await settle(b.id, (x) => x.status === 'waiting')
    await flowsApi.decide(b.id, false)
    const rb = await settle(b.id, (x) => x.status === 'error')
    expect(rb.steps.map((s) => s.status)).toEqual(['done', 'rejected', 'skipped'])
    await expect(flowsApi.decide(b.id, true)).rejects.toThrow()
  })
  it('stop ends a waiting run', async () => {
    const c = await flowsApi.run('p1', 'f1')
    await settle(c.id, (x) => x.status === 'waiting')
    await flowsApi.stop(c.id)
    expect((await settle(c.id, (x) => x.status === 'stopped')).steps[1].status).toBe('error')
  })
  it('stores flows by id and refuses path-like ids', async () => {
    expect((await flowsApi.list('p1')).map((f) => f.id)).toEqual(['f1'])
    await expect(flowsApi.remove('p1', '../x')).rejects.toThrow()
    await flowsApi.remove('p1', 'f1')
    expect(await flowsApi.list('p1')).toEqual([])
  })
})

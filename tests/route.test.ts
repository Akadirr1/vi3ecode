import { describe, expect, it } from 'vitest'
import { classifierOf, FALLBACK, parseClassification, pickRoute, ROUTES, type Candidate, type Classification } from '../src/shared/route'

const EFFORTS = { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['minimal', 'low', 'medium', 'high', 'xhigh'] } as Record<string, string[]>
const all: Candidate[] = ROUTES.map((r) => ({ ...r, efforts: EFFORTS[r.engine] }))
const cls = (patch: Partial<Classification>): Classification => ({ ...FALLBACK, ...patch })

describe('Auto routing', () => {
  it('reads the classifier JSON, also inside a fence, and rejects anything else', () => {
    expect(parseClassification('{"taskKind":"debugTest","complexity":"high","needsLongContext":true,"needsVision":"yes","reason":"fix failing test"}')).toEqual({
      taskKind: 'debugTest',
      complexity: 'high',
      needsLongContext: true,
      needsVision: false,
      reason: 'fix failing test'
    })
    expect(parseClassification('```json\n{"taskKind":"quick","complexity":"low"}\n```')?.taskKind).toBe('quick')
    expect(parseClassification('{"taskKind":"chat","complexity":"low"}')).toBeNull()
    expect(parseClassification('no json here')).toBeNull()
    expect(parseClassification(`{"taskKind":"quick","complexity":"low","reason":"  ${'x'.repeat(300)} "}`)?.reason).toHaveLength(160)
  })
  it('scores like the original', () => {
    // haiku and luna tie at 500; ties go to the current pick, then to candidate order
    expect(pickRoute(all, cls({ taskKind: 'quick', complexity: 'low' }))).toEqual({ engine: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' })
    expect(pickRoute(all, cls({ taskKind: 'quick', complexity: 'low' }), { engine: 'codex', model: 'gpt-5.6-luna' })?.model).toBe('gpt-5.6-luna')
    expect(pickRoute(all, FALLBACK)).toEqual({ engine: 'codex', model: 'gpt-5.6-terra', effort: 'medium' })
    expect(pickRoute(all, cls({ taskKind: 'reviewArchitecture', complexity: 'high' }))).toEqual({ engine: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' })
    // long context drops the context-3 models
    expect(pickRoute(all, cls({ taskKind: 'quick', complexity: 'low', needsLongContext: true }))?.model).toBe('gpt-5.6-terra')
  })
  it("leaves the effort to the engine when its adapter does not take the route's effort", () => {
    expect(pickRoute([{ ...all[1], efforts: [] }], FALLBACK)).toEqual({ engine: 'claude', model: 'claude-opus-5-5', effort: '' })
    expect(pickRoute([], FALLBACK)).toBeNull()
  })
  it('classifies with the cheapest model, Claude before Codex', () => {
    expect(classifierOf(all)?.model).toBe('claude-haiku-4-5-20251001')
    expect(classifierOf(all.filter((r) => r.engine === 'codex'))?.model).toBe('gpt-5.6-luna')
    expect(classifierOf([])).toBeUndefined()
  })
})

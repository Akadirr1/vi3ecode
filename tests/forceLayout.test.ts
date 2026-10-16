import { describe, expect, it } from 'vitest'
import { forceLayout } from '../src/renderer/src/tools/forceLayout'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('forceLayout', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['d', 'e'],
    ['a', 'missing'],
    ['f', 'f']
  ]

  it('is deterministic and stays inside the padded box', () => {
    const p = forceLayout(ids, edges, 600, 400, 30)
    expect(forceLayout(ids, edges, 600, 400, 30)).toEqual(p)
    for (const { x, y } of p.values()) {
      expect(x).toBeGreaterThanOrEqual(30)
      expect(x).toBeLessThanOrEqual(570)
      expect(y).toBeGreaterThanOrEqual(30)
      expect(y).toBeLessThanOrEqual(370)
    }
  })

  it('pulls linked notes together and pushes unlinked ones apart', () => {
    const p = forceLayout(ids, edges, 600, 400)
    const g = (id: string) => p.get(id)!
    expect(dist(g('a'), g('b'))).toBeLessThan(dist(g('a'), g('e')))
    expect(dist(g('d'), g('e'))).toBeLessThan(dist(g('d'), g('c')))
    // nothing collapses onto another node
    for (const a of ids) for (const b of ids) if (a < b) expect(dist(g(a), g(b))).toBeGreaterThan(20)
  })

  it('centres a single node', () => {
    expect(forceLayout(['x'], [], 600, 400).get('x')).toEqual({ x: 300, y: 200 })
  })
})

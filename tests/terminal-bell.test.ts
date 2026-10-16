import { describe, expect, it } from 'vitest'

// xterm.ts imports the preload api at load time; a bare stub is enough for the pure helpers.
;(globalThis as { window?: unknown }).window = { api: {} }
const { IDLE, observe, streamHint } = await import('../src/renderer/src/modes/terminal/xterm')

/** Feeds observations [ms, hint, output] and returns the times at which the bell rang. */
function run(steps: [number, boolean, boolean][]): number[] {
  let a = IDLE
  const rang: number[] = []
  for (const [at, hint, output] of steps) {
    const r = observe(a, { hint, output, at })
    a = r.next
    if (r.done) rang.push(at)
  }
  return rang
}

describe('pane bell', () => {
  it('rings once when a working engine goes quiet', () => {
    const working: [number, boolean, boolean][] = [0, 300, 600, 900].map((t) => [t, true, true])
    const quiet: [number, boolean, boolean][] = [1500, 2500, 3500, 4000, 4500].map((t) => [t, false, false])
    expect(run([...working, ...quiet])).toEqual([3500])
  })

  it('does not ring for a status line seen under 500 ms, or while output keeps coming', () => {
    expect(run([[0, true, true], [300, true, true], [3500, false, false]])).toEqual([])
    expect(run([[0, true, true], [600, true, true], [3200, false, true], [3500, false, false], [4300, false, false]])).toEqual([4300])
  })

  it('finds the status line through colour codes', () => {
    expect(streamHint('\x1b[2m(12s · esc to \x1b[1minterrupt)\x1b[0m')).toBe(true)
    expect(streamHint('$ ls\r\nREADME.md')).toBe(false)
  })
})

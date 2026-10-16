import { describe, expect, it, vi } from 'vitest'

vi.mock('node-pty', () => ({}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { engineArgs, shellQuote } = await import('../src/main/pty')

describe('engine pane command line', () => {
  it('quotes only what needs it, for sh and PowerShell', () => {
    expect(shellQuote('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(shellQuote('model_reasoning_effort=high')).toBe('model_reasoning_effort=high')
    expect(shellQuote("/p/it's here/x.md", false)).toBe(`'/p/it'\\''s here/x.md'`)
    expect(shellQuote('$(rm -rf ~); `x`', false)).toBe(`'$(rm -rf ~); \`x\`'`)
    expect(shellQuote("C:\\My Repo\\it's.md", true)).toBe(`'C:\\My Repo\\it''s.md'`)
    expect(shellQuote('a’b $env:X', true)).toBe(`'a’’b $env:X'`)
  })

  it('uses each CLI’s own interactive flags', () => {
    expect(engineArgs('claude', 'opus', 'high')).toEqual(['--model', 'opus', '--effort', 'high'])
    expect(engineArgs('codex', 'gpt-5.5', 'low')).toEqual(['--no-alt-screen', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort=low'])
    expect(engineArgs('opencode', 'openai/gpt-5')).toEqual(['-m', 'openai/gpt-5'])
    expect(engineArgs('cline')).toEqual(['--auto-approve', 'false'])
    expect(engineArgs('kiro')).toEqual(['chat'])
    expect(engineArgs('kimi', 'kimi-code/k3')).toEqual(['--model', 'kimi-code/k3'])
    expect(engineArgs('claude')).toEqual([])
  })
})

describe('saved terminal layout', () => {
  it('keeps only what relaunching a pane needs', async () => {
    const { sanitizeLayout } = await import('../src/main/pty')
    expect(sanitizeLayout('x')).toEqual([])
    expect(
      sanitizeLayout([null, { engine: 'claude', model: 'opus', title: 'A'.repeat(60), command: 'rm -rf ~', notify: false }, { title: 'Terminal 2', notify: true }])
    ).toEqual([
      { engine: 'claude', model: 'opus', title: 'A'.repeat(40), notify: false },
      { title: 'Terminal 2' }
    ].map((p) => ({ engine: undefined, model: undefined, effort: undefined, ...p })))
    expect(sanitizeLayout(Array(100).fill({ title: 't' }))).toHaveLength(48)
  })
})

import { describe, expect, it } from 'vitest'
import { claude } from '../src/main/engines/claude'
import { codex } from '../src/main/engines/codex'
import { gemini } from '../src/main/engines/gemini'
import { opencode } from '../src/main/engines/opencode'
import type { EngineAdapter } from '../src/main/engines/types'

const parseAll = (a: EngineAdapter, lines: unknown[]) => lines.flatMap((l) => a.parse!(JSON.stringify(l)))

describe('claude adapter', () => {
  it('maps approval modes to permission modes and puts the prompt on stdin', () => {
    const ro = claude.build!({ prompt: 'hi', system: 'SYS', approval: 'read-only', resumeId: 'abc' })
    expect(ro.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--resume', 'abc']))
    expect(ro.args).toContain('--disallowedTools')
    expect(ro.stdin).toBe('SYS\n\n---\n\nhi')
    expect(claude.build!({ prompt: 'x', approval: 'full' }).args).toContain('bypassPermissions')
    expect(claude.build!({ prompt: 'x', approval: 'edits' }).args).toContain('acceptEdits')
  })
  it('parses a recorded stream (shapes captured from Claude Code 2.1)', () => {
    const ev = parseAll(claude, [
      { type: 'system', subtype: 'hook_started' },
      { type: 'system', subtype: 'init', session_id: 's1', tools: [] },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Editing' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.ts' } }] } },
      { type: 'rate_limit_event', rate_limit_info: {} },
      { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.02, session_id: 's1' }
    ])
    expect(ev).toEqual([
      { type: 'session', id: 's1' },
      { type: 'text', text: 'Editing' },
      { type: 'tool', name: 'Edit', file: '/p/a.ts' },
      { type: 'result', text: 'done', costUsd: 0.02, isError: false },
      { type: 'session', id: 's1' }
    ])
    expect(claude.parse!('not json')).toEqual([])
  })
})

describe('codex adapter', () => {
  it('builds exec / resume invocations reading stdin', () => {
    expect(codex.build!({ prompt: 'p', approval: 'read-only' }).args).toEqual(['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-'])
    expect(codex.build!({ prompt: 'p', approval: 'full', resumeId: 't1', model: 'm' }).args).toEqual([
      'exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-m', 'm', 'resume', 't1', '-'
    ])
  })
  it('parses thread, items and failures; ignores reconnect noise', () => {
    const ev = parseAll(codex, [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'error', message: 'Reconnecting... 2/5' },
      { type: 'item.completed', item: { type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }] } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } },
      { type: 'turn.failed', error: { message: 'boom' } }
    ])
    expect(ev).toEqual([
      { type: 'session', id: 't1' },
      { type: 'tool', name: 'shell' },
      { type: 'tool', name: 'edit', file: 'src/a.ts' },
      { type: 'text', text: 'Done.' },
      { type: 'result', isError: true, text: 'boom' }
    ])
  })
})

describe('gemini adapter', () => {
  it('streams assistant deltas and maps approval modes', () => {
    expect(gemini.build!({ prompt: 'p', approval: 'read-only' }).args).toEqual(expect.arrayContaining(['--approval-mode', 'plan', '-o', 'stream-json']))
    const ev = parseAll(gemini, [
      { type: 'init', session_id: 'g1' },
      { type: 'message', role: 'user', content: 'p' },
      { type: 'message', role: 'assistant', content: 'Hel', delta: true },
      { type: 'tool_use', tool_name: 'write_file', parameters: { file_path: 'a.md' } },
      { type: 'result', status: 'success' }
    ])
    expect(ev).toEqual([
      { type: 'session', id: 'g1' },
      { type: 'text', text: 'Hel', delta: true },
      { type: 'tool', name: 'write_file', file: 'a.md' },
      { type: 'result', isError: false, text: undefined }
    ])
  })
})

describe('opencode adapter', () => {
  it('uses the read-only plan agent and parses parts', () => {
    expect(opencode.build!({ prompt: 'p', approval: 'read-only' }).args).toEqual(['run', '--format', 'json', '--agent', 'plan', 'p'])
    const ev = parseAll(opencode, [{ type: 'text', sessionID: 'o1', part: { text: 'hi' } }, { type: 'step_finish', sessionID: 'o1', part: { cost: 0.01 } }])
    expect(ev).toEqual([
      { type: 'session', id: 'o1' },
      { type: 'text', text: 'hi' },
      { type: 'session', id: 'o1' },
      { type: 'result', costUsd: 0.01 }
    ])
  })
})

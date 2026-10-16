import { describe, expect, it, vi } from 'vitest'
import type { Activity } from '../src/shared/types'

// The fake Claude is node printing a stream-json turn; `--` keeps Claude's flags away from node.
const lines = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } } },
  { type: 'result', subtype: 'success', result: 'done', session_id: 's1' }
]
const script = `for (const l of ${JSON.stringify(lines.map((l) => JSON.stringify(l)))}) console.log(l)`
vi.mock('../src/main/engines/index', () => ({
  getAdapter: () => ({}),
  binOf: () => process.execPath,
  spawnTarget: (bin: string) => ({ command: bin, args: ['-e', script, '--'] })
}))
const { ClaudeSession } = await import('../src/main/engines/claudeSession')

describe('ClaudeSession activity', () => {
  it('reports thinking, the tool being called, and writing as the stream goes', async () => {
    const seen: Activity[] = []
    await new Promise<void>((resolve) => {
      const cs = new ClaudeSession({
        cwd: process.cwd(),
        approval: 'read-only',
        onTurnStart() {},
        onText() {},
        onTool() {},
        onActivity: (a) => seen.push(a),
        onSession() {},
        onPermission() {},
        onTurnEnd: () => resolve(cs.close()),
        onExit: () => resolve()
      })
      cs.send('go')
    })
    // message_start and thinking_delta land within a second: one thinking event; input_json_delta repeats Read.
    expect(seen.map((a) => (a.tool ? `${a.kind}:${a.tool}` : a.kind))).toEqual(['thinking', 'tool:Read', 'thinking', 'writing'])
  })
})

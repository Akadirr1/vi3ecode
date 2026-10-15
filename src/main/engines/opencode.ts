import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// opencode 1.x: `opencode run --format json <message>` emits JSONL events carrying a `part`.
// Read-only uses opencode's built-in read-only `plan` agent.
export const opencode: EngineAdapter = {
  id: 'opencode',
  label: 'opencode',
  bin: 'opencode',
  installHint: 'npm install -g opencode-ai, then run `opencode auth login`',
  resumes: true,
  build(o) {
    const args = ['run', '--format', 'json']
    if (o.approval === 'read-only') args.push('--agent', 'plan')
    if (o.approval === 'auto') args.push('--auto')
    if (o.model) args.push('-m', o.model)
    if (o.resumeId) args.push('-s', o.resumeId)
    // shortcut: prompt goes on argv (opencode run takes the message as positionals); very long prompts may hit Windows' ~8k argv limit.
    args.push(withSystem(o))
    return { args }
  },
  parse(line) {
    const e = tryJson(line)
    if (!e) return []
    const out: EngineEvent[] = []
    if (typeof e.sessionID === 'string') out.push({ type: 'session', id: e.sessionID })
    const part = (e.part ?? {}) as Record<string, unknown>
    switch (e.type) {
      case 'text':
        if (typeof part.text === 'string') out.push({ type: 'text', text: part.text })
        break
      case 'tool_use': {
        const name = String(part.tool ?? 'tool')
        const input = ((part.state as Record<string, unknown> | undefined)?.input ?? {}) as Record<string, unknown>
        const file = /write|edit|patch/i.test(name) ? String(input.filePath ?? input.path ?? '') : ''
        out.push(file ? { type: 'tool', name, file } : { type: 'tool', name })
        break
      }
      case 'step_finish':
        if (typeof part.cost === 'number') out.push({ type: 'result', costUsd: part.cost })
        break
      case 'error': {
        const err = (e.error ?? {}) as Record<string, unknown>
        const data = (err.data ?? {}) as Record<string, unknown>
        out.push({ type: 'error', message: String(data.message ?? err.message ?? err.name ?? 'error') })
        break
      }
    }
    return out
  }
}

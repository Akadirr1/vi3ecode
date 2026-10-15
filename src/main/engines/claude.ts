import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// Verified against Claude Code 2.1.x: `claude -p --output-format stream-json --verbose`, prompt on stdin.
const MODE = { 'read-only': 'dontAsk', supervised: 'acceptEdits', auto: 'bypassPermissions' } as const

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const claude: EngineAdapter = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  installHint: 'npm install -g @anthropic-ai/claude-code, then run `claude` once to sign in',
  resumes: true,
  build(o) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', MODE[o.approval]]
    // dontAsk already denies edits; also drop the edit tools so the model does not try them.
    if (o.approval === 'read-only') args.push('--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit')
    if (o.resumeId) args.push('--resume', o.resumeId)
    if (o.model) args.push('--model', o.model)
    return { args, stdin: withSystem(o) }
  },
  parse(line) {
    const e = tryJson(line)
    if (!e) return []
    const out: EngineEvent[] = []
    if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') {
      out.push({ type: 'session', id: e.session_id })
    } else if (e.type === 'assistant') {
      const content = (e.message as { content?: unknown[] } | undefined)?.content ?? []
      for (const c of content as Record<string, unknown>[]) {
        if (c.type === 'text' && typeof c.text === 'string') out.push({ type: 'text', text: c.text })
        else if (c.type === 'tool_use') {
          const name = String(c.name ?? 'tool')
          const input = (c.input ?? {}) as Record<string, unknown>
          const file = FILE_TOOLS.has(name) ? String(input.file_path ?? input.notebook_path ?? '') : ''
          out.push(file ? { type: 'tool', name, file } : { type: 'tool', name })
        }
      }
    } else if (e.type === 'result') {
      out.push({
        type: 'result',
        text: typeof e.result === 'string' ? e.result : undefined,
        costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined,
        isError: e.is_error === true
      })
      if (typeof e.session_id === 'string') out.push({ type: 'session', id: e.session_id })
    }
    return out
  }
}

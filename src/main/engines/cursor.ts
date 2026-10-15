import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// Cursor CLI: `cursor-agent -p --output-format stream-json`; events mirror Claude Code's
// (system init, assistant, result) plus tool_call started/completed.
export const cursor: EngineAdapter = {
  id: 'cursor',
  label: 'Cursor CLI',
  bin: 'cursor-agent',
  installHint: 'curl https://cursor.com/install -fsS | bash, then `cursor-agent login`',
  resumes: true,
  build(o) {
    const args = ['-p', '--output-format', 'stream-json']
    if (o.approval === 'auto') args.push('--force')
    if (o.model) args.push('-m', o.model)
    if (o.resumeId) args.push('--resume', o.resumeId)
    // shortcut: Cursor has no documented read-only flag; read-only is enforced by instruction only.
    const ro = o.approval === 'read-only' ? 'You are read-only: do not modify any files.\n\n' : ''
    args.push(ro + withSystem(o))
    return { args }
  },
  parse(line) {
    const e = tryJson(line)
    if (!e) return []
    const out: EngineEvent[] = []
    if (e.type === 'system' && typeof e.session_id === 'string') out.push({ type: 'session', id: e.session_id })
    else if (e.type === 'assistant') {
      for (const c of ((e.message as { content?: Record<string, unknown>[] })?.content ?? [])) {
        if (c.type === 'text' && typeof c.text === 'string') out.push({ type: 'text', text: c.text })
      }
    } else if (e.type === 'tool_call' && e.subtype === 'started') {
      const call = (e.tool_call ?? {}) as Record<string, { args?: Record<string, unknown> }>
      const key = Object.keys(call)[0] ?? 'tool'
      const path = call[key]?.args?.path
      const name = key.replace(/ToolCall$/, '')
      out.push(/write|edit/i.test(name) && typeof path === 'string' ? { type: 'tool', name, file: path } : { type: 'tool', name })
    } else if (e.type === 'result') {
      out.push({ type: 'result', isError: e.is_error === true || e.subtype === 'error', text: typeof e.result === 'string' ? e.result : undefined })
      if (typeof e.session_id === 'string') out.push({ type: 'session', id: e.session_id })
    }
    return out
  }
}

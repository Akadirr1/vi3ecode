import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// gemini-cli 0.64: `gemini -p ""` runs headless and appends the -p text to stdin input.
// stream-json events: init, message (role, content, delta), tool_use, tool_result, error, result.
const MODE = { 'read-only': 'plan', ask: 'default', edits: 'auto_edit', full: 'yolo' } as const

export const gemini: EngineAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  bins: ['gemini'],
  models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  efforts: [],
  installHint: 'npm install -g @google/gemini-cli, then run `gemini` once to sign in',
  build(o) {
    const args = ['-p', '', '-o', 'stream-json', '--approval-mode', MODE[o.approval], '--skip-trust']
    if (o.model) args.push('-m', o.model)
    return { args, stdin: withSystem(o) }
  },
  parse(line) {
    const e = tryJson(line)
    if (!e) return []
    switch (e.type) {
      case 'init':
        return typeof e.session_id === 'string' ? [{ type: 'session', id: e.session_id }] : []
      case 'message':
        if (e.role !== 'assistant' || typeof e.content !== 'string') return []
        return [{ type: 'text', text: e.content, delta: e.delta === true }]
      case 'tool_use': {
        const name = String(e.tool_name ?? 'tool')
        const params = (e.parameters ?? {}) as Record<string, unknown>
        const file = /write|edit|replace/i.test(name) ? String(params.file_path ?? params.absolute_path ?? params.path ?? '') : ''
        const ev: EngineEvent = file ? { type: 'tool', name, file } : { type: 'tool', name }
        return [ev]
      }
      case 'error':
        return [{ type: 'error', message: String(e.message ?? 'error') }]
      case 'result':
        return [{ type: 'result', isError: e.status === 'error', text: e.status === 'error' ? String((e.error as { message?: string })?.message ?? 'error') : undefined }]
      default:
        return []
    }
  }
}

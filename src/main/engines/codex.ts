import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// Verified against codex-cli 0.163: `codex exec --json -` reads the prompt from stdin, JSONL on stdout.
const SANDBOX = { 'read-only': ['-s', 'read-only'], supervised: ['-s', 'workspace-write'], auto: ['--dangerously-bypass-approvals-and-sandbox'] }

export const codex: EngineAdapter = {
  id: 'codex',
  label: 'Codex',
  bin: 'codex',
  installHint: 'npm install -g @openai/codex, then run `codex` once to sign in',
  resumes: true,
  build(o) {
    const args = ['exec', '--json', '--skip-git-repo-check', ...SANDBOX[o.approval]]
    if (o.model) args.push('-m', o.model)
    if (o.resumeId) args.push('resume', o.resumeId)
    args.push('-')
    return { args, stdin: withSystem(o) }
  },
  parse(line) {
    const e = tryJson(line)
    if (!e) return []
    if (e.type === 'thread.started' && typeof e.thread_id === 'string') return [{ type: 'session', id: e.thread_id }]
    if (e.type === 'turn.completed') return [{ type: 'result' }]
    if (e.type === 'turn.failed') return [{ type: 'result', isError: true, text: String((e.error as { message?: string })?.message ?? 'Turn failed') }]
    if (e.type === 'error') {
      const msg = String(e.message ?? 'error')
      return /^Reconnecting/.test(msg) ? [] : [{ type: 'error', message: msg }]
    }
    if (e.type !== 'item.completed') return []
    const item = (e.item ?? {}) as Record<string, unknown>
    const out: EngineEvent[] = []
    switch (item.type) {
      case 'agent_message':
        if (typeof item.text === 'string') out.push({ type: 'text', text: item.text })
        break
      case 'command_execution':
        out.push({ type: 'tool', name: 'shell' })
        break
      case 'file_change':
        for (const c of (item.changes as { path?: string }[] | undefined) ?? []) {
          out.push(c.path ? { type: 'tool', name: 'edit', file: c.path } : { type: 'tool', name: 'edit' })
        }
        break
      case 'mcp_tool_call':
        out.push({ type: 'tool', name: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}` })
        break
      case 'web_search':
        out.push({ type: 'tool', name: 'web_search' })
        break
      case 'error':
        out.push({ type: 'error', message: String(item.message ?? 'error') })
        break
    }
    return out
  }
}

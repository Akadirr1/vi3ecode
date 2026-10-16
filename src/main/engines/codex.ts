import type { EngineAdapter, EngineEvent } from './types'
import { tryJson, withSystem } from './types'

// Verified against codex-cli 0.163: `codex exec --json -` reads the prompt from stdin, JSONL on stdout.
// `codex exec` cannot pause for approval, so `ask` runs sandboxed like `edits`: writes stay in the workspace, no network.
const SANDBOX = {
  'read-only': ['-s', 'read-only'],
  ask: ['-s', 'workspace-write'],
  edits: ['-s', 'workspace-write'],
  full: ['--dangerously-bypass-approvals-and-sandbox']
}

/** MCP servers as `-c mcp_servers.<name>.…` config overrides (TOML values; JSON strings and arrays are valid TOML). */
export function codexMcpOverrides(json: string): string[] {
  let servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> = {}
  try {
    servers = (JSON.parse(json) as { mcpServers?: typeof servers }).mcpServers ?? {}
  } catch {
    return []
  }
  return Object.entries(servers)
    .filter(([name, s]) => /^[\w-]+$/.test(name) && typeof s.command === 'string')
    .flatMap(([name, s]) => {
      const out = ['-c', `mcp_servers.${name}.command=${JSON.stringify(s.command)}`, '-c', `mcp_servers.${name}.args=${JSON.stringify(s.args ?? [])}`]
      const env = Object.entries(s.env ?? {}).filter(([k]) => /^\w+$/.test(k))
      if (env.length) out.push('-c', `mcp_servers.${name}.env={${env.map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(', ')}}`)
      return out
    })
}

export const codex: EngineAdapter = {
  id: 'codex',
  label: 'Codex',
  bins: ['codex'],
  models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  installHint: 'npm install -g @openai/codex, then run `codex` once to sign in',
  resumes: true,
  build(o) {
    const args = ['exec', '--json', '--skip-git-repo-check', ...SANDBOX[o.approval]]
    if (o.model) args.push('-m', o.model)
    if (o.effort) args.push('-c', `model_reasoning_effort=${o.effort}`)
    if (o.mcpConfig) args.push(...codexMcpOverrides(o.mcpConfig))
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
        out.push({ type: 'tool', name: typeof item.command === 'string' ? `shell ${item.command.replace(/\s+/g, ' ').slice(0, 200)}` : 'shell' })
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

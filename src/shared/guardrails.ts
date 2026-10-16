// Guardrails: destructive operations always raise an approval card, even under Full access or AUTO-APPROVE.
// Same four built-in rules as vi3ecode (ids, titles and what they match); patterns are our own.

export interface GuardrailRule {
  id: 'db-destructive' | 'file-delete' | 'git-destructive' | 'system-destructive'
  title: string
  /** commands: only shell tools are checked; all: every tool's input. */
  scope: 'commands' | 'all'
  patterns: RegExp[]
}

export const GUARDRAILS: GuardrailRule[] = [
  {
    id: 'db-destructive',
    title: 'Database destructive operations',
    scope: 'all',
    patterns: [
      /\bdrop\s+(table|database|schema|index|collection|view|sequence)\b/i,
      /\btruncate\s+table\b/i,
      /\bdelete\s+from\s+\w/i,
      /\bdrizzle-kit\s+(push|drop)\b/i,
      /\bprisma\s+(migrate\s+reset|db\s+push)\b/i,
      /\b(migrate:fresh|db:(reset|drop|wipe|nuke|push))\b/i,
      /\bflush(all|db)\b/i
    ]
  },
  {
    id: 'file-delete',
    title: 'Recursive / forced file deletion',
    scope: 'commands',
    patterns: [
      /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
      /\brm\s+--(recursive|force)\b/i,
      /\brmdir\b/i,
      /\bfind\b[^|;&]*\s-delete\b/i,
      /\bshutil\.rmtree\b/,
      /\brimraf\b/i,
      /\bfs\.rm(Sync)?\([^)]*recursive/i,
      /\b(del|erase)\s+\/[sq]\b/i,
      /\brd\s+\/s\b/i,
      /\bRemove-Item\b[^|;]*-Recurse/i
    ]
  },
  {
    id: 'git-destructive',
    title: 'Destructive git operations',
    scope: 'commands',
    patterns: [
      /\bgit\s+push\b[^|;&]*\s(--force(-with-lease)?|-f)\b/i,
      /\bgit\s+reset\s+--hard\b/i,
      /\bgit\s+clean\s+-[a-z]*[df]/i,
      /\bgit\s+push\b[^|;&]*\s(--delete|-d)\b/i,
      /\bgit\s+stash\s+(drop|clear)\b/i,
      /\bgit\s+filter-branch\b/i,
      /\bgit\s+checkout\b[^|;&]*\s(--\s+)?\.(\s|$)/i,
      /\bgit\s+restore\b(?![^|;&]*--staged\b)/i,
      /\bgit\s+branch\s+[^|;&]*-D\b/,
      /\bgit\s+push\b[^|;&]*\s\+\S/i
    ]
  },
  {
    id: 'system-destructive',
    title: 'Dangerous system commands',
    scope: 'commands',
    patterns: [
      /\bdiskutil\s+(erase\w*|apfs\s+delete\w*|partitiondisk)\b/i,
      /\bdd\b[^|;&]*\bof=\/dev\//i,
      /\bformat\s+[a-z]:/i,
      /\bchmod\s+(-R\s+)?0?777\b/i,
      /\bsudo\s+rm\b/i,
      /\b(shutdown|reboot)\b/i,
      /:\(\)\s*\{\s*:\|:&\s*\};:/
    ]
  }
]

const SHELL_TOOLS = /^(bash|shell|powershell|command|exec|run_shell_command|local_shell)$/i

/** The rule an action trips, if any. `tool` is the engine's tool name, `input` its arguments. */
export function matchGuardrail(tool: string, input: Record<string, unknown>): GuardrailRule | null {
  const isShell = SHELL_TOOLS.test(tool)
  const command = String(input.command ?? input.cmd ?? '')
  const everything = JSON.stringify(input)
  for (const rule of GUARDRAILS) {
    const subject = rule.scope === 'commands' ? (isShell ? command : '') : isShell ? command : everything
    if (subject && rule.patterns.some((p) => p.test(subject))) return rule
  }
  return null
}

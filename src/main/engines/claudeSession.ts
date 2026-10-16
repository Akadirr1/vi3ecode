// A long-lived Claude Code process speaking stream-json on stdin/stdout (verified with Claude Code 2.1).
// One process per chat: messages sent mid-turn steer the running turn, `interrupt` stops a turn
// without killing the session, and tool permission prompts arrive as control requests the app answers.
import spawn from 'cross-spawn'
import type { ChildProcess } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import type { ApprovalMode } from '../../shared/types'
import { killTree, relPath, type TurnHandle, type TurnResult } from '../runner'
import { matchGuardrail } from '../../shared/guardrails'
import { binOf, getAdapter, spawnTarget } from './index'

export interface PermissionRequest {
  id: string
  tool: string
  /** Claude's internal tool name (e.g. Bash), for guardrail matching. */
  toolName: string
  /** Short human description from Claude (e.g. a file name or command). */
  description: string
  input: Record<string, unknown>
  suggestions: unknown[]
}

export interface ClaudeTurnEnd {
  text: string
  tools: string[]
  files: string[]
  costUsd?: number
  error?: string
  interrupted: boolean
  durationMs: number
  /** The resumed session does not exist (expired or unknown id); the process exits right after. */
  resumeFailed?: boolean
}

export interface ClaudeSessionOpts {
  cwd: string
  approval: ApprovalMode
  model?: string
  effort?: string
  resumeId?: string
  /** JSON for --mcp-config (plugin MCP servers). */
  mcpConfig?: string
  /**
   * Full access with guardrails: run in manual mode and let the app allow every request except the ones a
   * guardrail rule matches. Without guardrails, Full access is Claude's own bypass mode.
   */
  guarded?: boolean
  /** Tools pre-approved for this session (no prompt), e.g. the browser panel's tools. */
  allowedTools?: string[]
  onTurnStart(): void
  onText(text: string, delta?: boolean): void
  /** `detail`: one line of the tool's argument (command, path, pattern or URL), relative paths. */
  onTool(name: string, file?: string, detail?: string): void
  onSession(id: string): void
  onPermission(req: PermissionRequest): void
  onRateLimit?(info: Record<string, unknown>): void
  onTurnEnd(r: ClaudeTurnEnd): void
  /** `resumeFailed`: the process died before starting the resumed session (expired or unknown id). */
  onExit(error?: string, resumeFailed?: boolean): void
}

const MODE: Record<ApprovalMode, string> = { 'read-only': 'dontAsk', ask: 'manual', edits: 'acceptEdits', full: 'bypassPermissions' }
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

export function claudeArgs(o: Pick<ClaudeSessionOpts, 'approval' | 'model' | 'effort' | 'resumeId' | 'mcpConfig' | 'guarded' | 'allowedTools'>): string[] {
  const mode = o.approval === 'full' && o.guarded ? 'manual' : MODE[o.approval]
  // Same transport as vi3ecode: partial messages stream tokens; replayed user messages acknowledge steering.
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    mode
  ]
  if (o.approval === 'read-only') args.push('--disallowedTools', ...EDIT_TOOLS)
  if (o.resumeId) args.push('--resume', o.resumeId)
  if (o.model) args.push('--model', o.model)
  if (o.effort) args.push('--effort', o.effort)
  if (o.mcpConfig) args.push('--mcp-config', o.mcpConfig)
  if (o.allowedTools?.length) args.push('--allowedTools', ...o.allowedTools)
  return args
}

export class ClaudeSession {
  private child: ChildProcess
  private buf = ''
  private stderr = ''
  private reqSeq = 0
  private turn: { texts: string[]; tools: string[]; files: Set<string>; started: number; interrupted: boolean } | null = null
  private closed = false
  /** Assistant message ids whose text already arrived as deltas (the full message repeats it). */
  private streamed = new Set<string>()
  private curMsg = ''
  private initSeen = false

  constructor(private o: ClaudeSessionOpts) {
    const target = spawnTarget(binOf(getAdapter('claude')))
    this.child = spawn(target.command, [...target.args, ...claudeArgs(o)], {
      cwd: o.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    this.child.stdout?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        this.handle(line)
      }
    })
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (c: string) => (this.stderr = (this.stderr + c).slice(-4000)))
    this.child.stdin?.on('error', () => {})
    this.child.on('error', (err: NodeJS.ErrnoException) => {
      this.finishTurn(err.code === 'ENOENT' ? 'claude was not found on PATH. npm install -g @anthropic-ai/claude-code' : err.message)
      this.exit(err.message)
    })
    this.child.on('close', (code) => {
      const msg = this.closed ? undefined : this.stderr.trim().split('\n').slice(-6).join('\n') || `claude exited with code ${code}`
      this.finishTurn(msg)
      this.exit(msg)
    })
    this.write({ type: 'control_request', request_id: this.nextId(), request: { subtype: 'initialize' } })
  }

  get busy(): boolean {
    return !!this.turn
  }

  get alive(): boolean {
    return !this.closed && this.child.exitCode === null
  }

  /** Starts a turn, or steers the running one. */
  send(text: string): void {
    if (!this.turn) this.beginTurn()
    this.write({ type: 'user', message: { role: 'user', content: text } })
  }

  respond(requestId: string, req: PermissionRequest, allow: boolean, always = false, why = 'The user denied this action in vi3ecode.'): void {
    const response = allow
      ? { behavior: 'allow', updatedInput: req.input, ...(always && req.suggestions.length ? { updatedPermissions: req.suggestions } : {}) }
      : { behavior: 'deny', message: why }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  setApproval(approval: ApprovalMode): void {
    const mode = approval === 'full' && this.o.guarded ? 'manual' : MODE[approval]
    this.write({ type: 'control_request', request_id: this.nextId(), request: { subtype: 'set_permission_mode', mode } })
  }

  interrupt(): void {
    if (!this.turn) return
    this.turn.interrupted = true
    this.write({ type: 'control_request', request_id: this.nextId(), request: { subtype: 'interrupt' } })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.child.stdin?.end()
    const t = setTimeout(() => killTree(this.child), 2000)
    t.unref()
  }

  kill(): void {
    this.closed = true
    killTree(this.child)
  }

  private nextId(): string {
    return `v3-${++this.reqSeq}`
  }

  private write(o: unknown): void {
    if (this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(o) + '\n')
  }

  private beginTurn(): void {
    this.turn = { texts: [], tools: [], files: new Set(), started: Date.now(), interrupted: false }
    this.o.onTurnStart()
  }

  private finishTurn(error?: string, costUsd?: number, resultText?: string, resumeFailed?: boolean): void {
    const t = this.turn
    if (!t) return
    this.turn = null
    const text = t.texts.join('\n\n').trim() || (resultText ?? '').trim()
    this.o.onTurnEnd({
      text,
      tools: t.tools,
      files: [...t.files],
      costUsd,
      error: t.interrupted ? undefined : error,
      interrupted: t.interrupted,
      durationMs: Date.now() - t.started,
      ...(resumeFailed ? { resumeFailed } : {})
    })
  }

  private exit(error?: string): void {
    if (this.closed && error === undefined) return this.o.onExit()
    this.closed = true
    this.o.onExit(error, !!error && !!this.o.resumeId && !this.initSeen)
  }

  private handle(line: string): void {
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    switch (e.type) {
      case 'system':
        if (e.subtype === 'init') this.initSeen = true
        if (e.subtype === 'init' && typeof e.session_id === 'string') this.o.onSession(e.session_id)
        return
      case 'stream_event': {
        const ev = (e.event ?? {}) as Record<string, unknown>
        if (ev.type === 'message_start') this.curMsg = String((ev.message as { id?: string } | undefined)?.id ?? '')
        else if (ev.type === 'content_block_start' && (ev.content_block as { type?: string } | undefined)?.type === 'text') {
          if (!this.turn) this.beginTurn()
          this.streamed.add(this.curMsg)
          this.turn!.texts.push('')
          this.o.onText('', false) // paragraph break before a new text block
        } else if (ev.type === 'content_block_delta') {
          const d = (ev.delta ?? {}) as { type?: string; text?: string }
          if (d.type === 'text_delta' && d.text && this.turn) {
            this.turn.texts[this.turn.texts.length - 1] += d.text
            this.o.onText(d.text, true)
          }
        }
        return
      }
      case 'assistant': {
        // A steer that landed after the previous result starts a new turn on its own.
        if (!this.turn) this.beginTurn()
        const msgId = String((e.message as { id?: string } | undefined)?.id ?? '')
        const content = ((e.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[]
        for (const c of content) {
          if (c.type === 'text' && typeof c.text === 'string') {
            if (this.streamed.has(msgId)) continue
            this.turn!.texts.push(c.text)
            this.o.onText(c.text)
          } else if (c.type === 'tool_use') {
            const name = String(c.name ?? 'tool')
            const input = (c.input ?? {}) as Record<string, unknown>
            let file = EDIT_TOOLS.includes(name) ? String(input.file_path ?? input.notebook_path ?? '') : ''
            if (file) file = relPath(this.o.cwd, file)
            const detail = toolDetail(input, this.o.cwd)
            this.turn!.tools.push(detail ? `${name} ${detail}` : name)
            if (file) this.turn!.files.add(file)
            this.o.onTool(name, file || undefined, detail || undefined)
          }
        }
        return
      }
      case 'result': {
        const isError = e.is_error === true || (typeof e.subtype === 'string' && e.subtype.startsWith('error'))
        // An unknown --resume id ends in an error result before any init, echoing the bad id back.
        const resumeFailed = isError && !!this.o.resumeId && !this.initSeen
        if (typeof e.session_id === 'string' && !resumeFailed) this.o.onSession(e.session_id)
        const err = resumeFailed ? `No conversation found with session ID ${this.o.resumeId}.` : String(e.result ?? e.subtype ?? 'error')
        this.finishTurn(isError ? err : undefined, typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined, typeof e.result === 'string' ? e.result : undefined, resumeFailed)
        return
      }
      case 'rate_limit_event':
        if (e.rate_limit_info && typeof e.rate_limit_info === 'object') this.o.onRateLimit?.(e.rate_limit_info as Record<string, unknown>)
        return
      case 'control_request': {
        const id = String(e.request_id ?? '')
        const req = (e.request ?? {}) as Record<string, unknown>
        if (req.subtype === 'can_use_tool') {
          this.o.onPermission({
            id,
            tool: String(req.display_name ?? req.tool_name ?? 'tool'),
            toolName: String(req.tool_name ?? req.display_name ?? 'tool'),
            description: String(req.description ?? ''),
            input: (req.input ?? {}) as Record<string, unknown>,
            suggestions: Array.isArray(req.permission_suggestions) ? req.permission_suggestions : []
          })
        } else {
          // Never leave Claude waiting on a request type we do not implement.
          this.write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `vi3ecode does not handle ${String(req.subtype)}` } })
        }
        return
      }
    }
  }
}

/** One readable line for a tool call or permission request: the command, file, pattern or URL it acts on. */
export function toolDetail(input: Record<string, unknown>, cwd: string): string {
  const pick = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description
  let s = typeof pick === 'string' ? pick : ''
  if (s && isAbsolute(s) && !s.includes('\n')) {
    const rel = relative(cwd, s)
    if (!rel.startsWith('..')) s = rel || '.'
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * One Full-access turn under guardrails with nobody to ask (Flow steps): everything is allowed except what
 * a guardrail rule matches, which is denied and explained to Claude.
 */
export function guardedClaudeTurn(cwd: string, o: { prompt: string; model?: string; mcpConfig?: string }, onText: (text: string, delta?: boolean) => void): TurnHandle {
  let resolve!: (r: TurnResult) => void
  const done = new Promise<TurnResult>((r) => (resolve = r))
  let settled = false
  let sessionId: string | undefined
  const end = (r: TurnResult) => {
    if (settled) return
    settled = true
    resolve({ ...r, sessionId })
    cs.close()
  }
  const cs: ClaudeSession = new ClaudeSession({
    cwd,
    approval: 'full',
    guarded: true,
    model: o.model,
    mcpConfig: o.mcpConfig,
    onTurnStart: () => {},
    onText,
    onTool: () => {},
    onSession: (id) => (sessionId = id),
    onPermission: (req) => {
      const rule = matchGuardrail(req.toolName, req.input)
      cs.respond(req.id, req, !rule, false, rule ? `Blocked by the "${rule.title}" guardrail: a Flow step cannot ask the user. Find another way or stop and explain.` : undefined)
    },
    onTurnEnd: (r) => end({ text: r.text, tools: r.tools, files: r.files, costUsd: r.costUsd, error: r.error, stopped: r.interrupted, durationMs: r.durationMs }),
    onExit: (error) => end({ text: '', tools: [], files: [], error: error ?? 'Claude Code exited before finishing the turn.', stopped: false, durationMs: 0 })
  })
  cs.send(o.prompt)
  return {
    done,
    stop: () => {
      cs.interrupt()
      setTimeout(() => {
        if (settled) return
        cs.kill()
        end({ text: '', tools: [], files: [], stopped: true, durationMs: 0 })
      }, 3000).unref()
    }
  }
}

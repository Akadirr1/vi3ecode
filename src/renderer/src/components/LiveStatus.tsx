import { useEffect, useState } from 'react'
import type { Activity } from '../../../shared/types'
import { t } from '../i18n'

const TOOL_VERBS: [RegExp, string][] = [
  [/^(task|agent)$/i, 'Delegating'],
  [/^(edit|write|multiedit|notebookedit|apply_?patch|patch|str_replace|create)/i, 'Editing'],
  [/^(bash|shell|exec|command|run|terminal)/i, 'Executing'],
  [/^(web_?search|search)|fetch|browse|^web/i, 'Searching'],
  [/^(grep|glob|find|ls|list)/i, 'Exploring'],
  [/^(read|view|cat|open|notebookread)/i, 'Reading']
]
/** Silence longer than this outside a tool call shows as "engine quiet" (a stalled or retrying API call). */
export const QUIET_MS = 60_000

/** English verb (an i18n key) for what a running turn is doing; without live activity, guessed from its last step. */
export function liveVerb(activity: Activity | undefined, lastTool: string | undefined, hasText: boolean): string {
  const kind = activity?.kind ?? (lastTool ? 'tool' : hasText ? 'writing' : 'thinking')
  if (kind === 'thinking') return 'Thinking'
  if (kind === 'writing') return 'Responding'
  const tool = activity?.tool ?? lastTool ?? ''
  return TOOL_VERBS.find(([re]) => re.test(tool))?.[1] ?? 'Working'
}

const clockOf = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "Thinking · 0:42", ticking every second; warns when the engine has gone quiet (unless it waits on the user). */
export function LiveStatus({ since, activity, tools, text, waiting }: { since: number; activity?: Activity; tools?: string[]; text?: string; waiting?: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const verb = liveVerb(activity, tools?.at(-1)?.split(' ')[0], !!text)
  const quiet = now - (activity?.at ?? since)
  const showQuiet = !waiting && activity?.kind !== 'tool' && quiet > QUIET_MS
  return (
    <span className={`live-status${showQuiet ? ' quiet' : ''}`} role="status">
      <span className="live-verb">{waiting ? t('Waiting for approval') : t(verb)}…</span>
      <span className="mono faint">{clockOf(now - since)}</span>
      {showQuiet ? <span className="live-quiet">{t('engine quiet for {minutes} min', { minutes: Math.floor(quiet / 60_000) })}</span> : null}
    </span>
  )
}

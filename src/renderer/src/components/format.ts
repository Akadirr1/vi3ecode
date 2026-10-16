import { t } from '../i18n'

export const formatCost = (usd?: number): string => (typeof usd === 'number' ? (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`) : '')

export function formatDuration(ms?: number): string {
  if (typeof ms !== 'number') return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return t('now')
  if (s < 3600) return t('{n}m', { n: Math.round(s / 60) })
  if (s < 86400) return t('{n}h', { n: Math.round(s / 3600) })
  return t('{n}d', { n: Math.round(s / 86400) })
}

/** Approval modes as the composer and the team dialog name them. */
export const APPROVAL_LABEL: Record<string, { label: string; hint: string }> = {
  'read-only': { label: 'Read-only', hint: 'Never edits files or runs changing commands' },
  ask: { label: 'Ask every time', hint: 'Request confirmation before each action' },
  edits: { label: 'Approve edits', hint: 'Auto-approve file edits; other actions ask' },
  full: { label: 'Full access', hint: "Uses the engine's permission bypass mode; guardrails and engine restrictions may apply" }
}

/** Error text from a failed IPC call, without Electron's "Error invoking remote method" prefix. */
export const errorText = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

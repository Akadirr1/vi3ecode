// Flow step prompts and review verdicts. Pure: no engine, no fs, testable.
import type { Flow, FlowRunStep } from './types'

export const CONTEXT_CAP = 8000

/** Prompt for step `i`: the flow goal, what earlier steps produced (newest kept when over the cap), then this step. */
export function stepPrompt(flow: Flow, i: number, earlier: FlowRunStep[]): string {
  const step = flow.steps[i]
  let context = earlier
    .map((s, n) =>
      s.kind === 'gate'
        ? `### ${n + 1}. ${s.title} (human gate)\nApproved by the user.`
        : `### ${n + 1}. ${s.title} (${s.kind})\n${s.text.trim() || '(no output)'}`
    )
    .join('\n\n')
  if (context.length > CONTEXT_CAP) context = `…(earlier output trimmed)\n${context.slice(-CONTEXT_CAP)}`
  const parts = [
    `You are running step ${i + 1} of ${flow.steps.length} ("${step.title}") in the flow "${flow.name}". Other steps run before and after you; do only this step.`,
    `## Flow goal\n${flow.goal.trim() || '(none given)'}`
  ]
  if (context) parts.push(`## Earlier steps\n${context}`)
  parts.push(`## Your step: ${step.title}\n${step.prompt.trim() || '(no extra instructions)'}`)
  if (step.kind === 'review') {
    parts.push(
      'You are the reviewer. Check the work done so far against the goal and this step; inspect the files, run checks if useful, but do not redo the work. ' +
        'End your answer with exactly one line: "VERDICT: PASS" or "VERDICT: FAIL — <reason>".'
    )
  }
  return parts.join('\n\n')
}

/** The last VERDICT line in a review answer; null when there is none. Tolerates markdown emphasis. */
export function parseVerdict(text: string): { pass: boolean; reason: string } | null {
  const lines = [...text.matchAll(/^[\s>*_`]*VERDICT[*_`]*\s*:[\s*_`]*(PASS|FAIL)\b[*_`]*\s*(.*)$/gim)]
  const last = lines.at(-1)
  if (!last) return null
  const reason = last[2].replace(/^[\s—–:-]+/, '').replace(/[*_`]+$/, '').trim()
  return { pass: last[1].toUpperCase() === 'PASS', reason }
}

/** Ends a run's steps: the one in flight becomes an error with `reason`, the ones never reached are skipped. */
export function closeSteps(steps: FlowRunStep[], reason: string, now = Date.now()): FlowRunStep[] {
  return steps.map((s) =>
    s.status === 'running' || s.status === 'waiting'
      ? { ...s, status: 'error', error: s.error ?? reason, endedAt: now }
      : s.status === 'pending'
        ? { ...s, status: 'skipped' }
        : s
  )
}

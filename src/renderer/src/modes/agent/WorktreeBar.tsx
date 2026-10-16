import { useEffect, useState } from 'react'
import { FolderOpen, GitBranch, GitMerge, Trash2 } from 'lucide-react'
import type { TeamRun } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../context'
import { t } from '../../i18n'
import { diffLineClass } from '../../tools/GitTool'
import '../../tools/git.css'
import { errorText } from './store'

const MAX_LINES = 4000

/** Header controls of a worktree thread, as in vi3ecode: branch pill, Diff, Merge, reveal and remove. */
export function WorktreeBar({ run, diffOpen, setDiffOpen }: { run: TeamRun; diffOpen: boolean; setDiffOpen(open: boolean): void }) {
  const { setRunId } = useApp()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const wt = run.worktree!
  const merge = async () => {
    setBusy(true)
    setStatus('')
    try {
      await api.team.merge(run.id)
      setStatus(t('Merged {branch} into the project checkout', { branch: wt.branch }))
    } catch (e) {
      setStatus(`${t('Merge failed')}: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    try {
      await api.team.remove(run.id)
    } catch (e) {
      if (!errorText(e).includes('WORK_WORKTREE_DIRTY')) return setStatus(`${t("Could not remove the thread's worktree")}: ${errorText(e)}`)
      // shortcut: a native confirm, so its buttons read OK/Cancel instead of "Remove anyway"; an inline dialog would match vi3ecode exactly.
      const body = t('The worktree has uncommitted changes or {branch} has commits that are not merged yet. Removing now deletes them permanently.', { branch: wt.branch })
      if (!confirm(`${t('Unsaved work in the worktree')}\n\n${body}`)) return
      await api.team.remove(run.id, true).catch((err) => setStatus(`${t("Could not remove the thread's worktree")}: ${errorText(err)}`))
    }
    setRunId(null)
  }
  return (
    <div className="am-wt">
      <span className="am-wt-branch mono" title={wt.path}>
        <GitBranch size={12} aria-hidden />
        <span>{wt.branch}</span>
      </span>
      <button className={`btn small${diffOpen ? ' on' : ''}`} aria-pressed={diffOpen} onClick={() => setDiffOpen(!diffOpen)}>
        {t('Diff')}
      </button>
      <button className="btn small" onClick={() => void merge()} disabled={busy || run.status === 'running'} title={run.status === 'running' ? t('Wait for the team to finish first.') : undefined}>
        <GitMerge size={13} aria-hidden />
        {busy ? t('Merging…') : t('Merge')}
      </button>
      <button className="iconbtn" onClick={() => void api.team.reveal(run.id)} title={t('Reveal worktree folder')} aria-label={t('Reveal worktree folder')}>
        <FolderOpen size={14} />
      </button>
      <button className="iconbtn danger" onClick={() => void remove()} title={t('Remove thread and worktree')} aria-label={t('Remove thread and worktree')}>
        <Trash2 size={14} />
      </button>
      {status ? (
        <span className="am-wt-status small" role="status">
          {status}
        </span>
      ) : null}
    </div>
  )
}

/** Right-hand panel: everything the thread changed on its branch, committed or not. */
export function WorktreeDiff({ run }: { run: TeamRun }) {
  const [diff, setDiff] = useState<string | null>(null)
  // Refreshed whenever the thread moves on (a turn ends, a merge commits leftovers).
  useEffect(() => {
    void api.team.diff(run.id).then(setDiff, (e) => setDiff(errorText(e)))
  }, [run.id, run.updatedAt])
  const lines = diff?.split('\n') ?? []
  return (
    <aside className="am-wt-diff" aria-label={t('Diff')}>
      {diff === null ? (
        <div className="empty">{t('Loading…')}</div>
      ) : !diff.trim() ? (
        <div className="empty">{t('No differences.')}</div>
      ) : (
        <pre className="git-diff" tabIndex={0}>
          {lines.slice(0, MAX_LINES).map((l, i) => (
            <div key={i} className={diffLineClass(l)}>
              {l || ' '}
            </div>
          ))}
          {lines.length > MAX_LINES ? <div className="meta">{t('… {n} more lines not shown', { n: lines.length - MAX_LINES })}</div> : null}
        </pre>
      )}
    </aside>
  )
}

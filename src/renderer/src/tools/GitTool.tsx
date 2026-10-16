import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, GitBranch, LoaderCircle, Minus, Plus, RefreshCw, Sparkles } from 'lucide-react'
import type { GitCommit, GitFile, GitStatus } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { relativeTime } from '../components/format'
import './git.css'

export type GroupKey = 'staged' | 'changes' | 'untracked'
export interface Change {
  path: string
  /** One porcelain status letter: M A D R C T U or ? */
  code: string
}

/** Splits porcelain v2 entries into the panel's three groups; a file changed after staging is in both of the first two. */
export function groupChanges(files: GitFile[]): Record<GroupKey, Change[]> {
  const g: Record<GroupKey, Change[]> = { staged: [], changes: [], untracked: [] }
  for (const f of files) {
    if (f.index === '?') g.untracked.push({ path: f.path, code: '?' })
    else {
      if (f.index !== '.' && f.index !== 'U') g.staged.push({ path: f.path, code: f.index })
      if (f.worktree !== '.') g.changes.push({ path: f.path, code: f.worktree })
    }
  }
  return g
}

/** CSS class for one line of unified diff output. */
export function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk'
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(line)) return 'meta'
  if (line[0] === '+') return 'add'
  if (line[0] === '-') return 'del'
  return ''
}

const GROUPS: { key: GroupKey; label: string; action: string }[] = [
  { key: 'staged', label: 'Staged', action: 'Unstage all' },
  { key: 'changes', label: 'Changes', action: 'Stage all' },
  { key: 'untracked', label: 'Untracked', action: 'Stage all' }
]

// shortcut: huge diffs render only their first lines; add virtualised rendering if people need more.
const MAX_DIFF_LINES = 3000
const POLL_MS = 5000

// Keyed by project so a project switch clears the selection and draft message.
export function GitTool({ docked }: { docked: boolean }) {
  return <Git key={useApp().project.id} docked={docked} />
}

function Git({ docked }: { docked: boolean }) {
  const pid = useApp().project.id
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [tab, setTab] = useState<'changes' | 'history'>('changes')
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<'' | 'suggest' | 'commit' | 'stage'>('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const next = await api.git.status(pid)
    // Polling must not re-render (and re-fetch the diff) when nothing changed.
    setStatus((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
  }, [pid])
  const refreshLog = useCallback(() => api.git.log(pid, 50).then(setLog, () => setLog([])), [pid])

  useEffect(() => {
    void refresh()
    void refreshLog()
    const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshLog])

  useEffect(() => {
    if (!sel) return setDiff(null)
    let live = true
    api.git.diff(pid, sel.path, sel.staged).then(
      (d) => live && setDiff(d),
      (e: Error) => live && setDiff(e.message)
    )
    return () => {
      live = false
    }
  }, [pid, sel, status])

  if (!status) return <div className="empty">{t('Loading…')}</div>
  if (!status.isRepo)
    return (
      <div className="empty git-empty">
        <GitBranch size={22} aria-hidden />
        <div className="muted">{t('Not a git repository')}</div>
        <div className="small">{t('Run git init in the project folder, or open a folder that is inside a repository.')}</div>
      </div>
    )

  const groups = groupChanges(status.files)
  const total = new Set(status.files.map((f) => f.path)).size

  const act = async (group: GroupKey, paths: string[]) => {
    setBusy('stage')
    setError('')
    try {
      await (group === 'staged' ? api.git.unstage(pid, paths) : api.git.stage(pid, paths))
      if (sel && paths.includes(sel.path)) setSel({ path: sel.path, staged: group !== 'staged' })
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const suggest = async () => {
    setBusy('suggest')
    setError('')
    try {
      const d = groups.staged.length ? await api.git.diff(pid, undefined, true) : await api.git.diff(pid)
      if (!d.trim()) throw new Error(t('No diff to describe yet. Stage or change some files first.'))
      const out = await api.ai.ask(pid, 'Write a one-line conventional commit message for this diff:\n' + d.slice(0, 60_000))
      const line = out.split('\n').map((l) => l.trim().replace(/^[`"']+|[`"']+$/g, '')).find(Boolean)
      if (line) setMsg(line)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const commit = async () => {
    if (!msg.trim() || !groups.staged.length || busy) return
    setBusy('commit')
    setError('')
    try {
      await api.git.commit(pid, msg)
      setMsg('')
      setSel(null)
      await Promise.all([refresh(), refreshLog()])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const changes = (
    <div className="git-changes">
      <div className="git-list">
        {!total ? (
          <div className="empty git-clean">
            <Check size={20} aria-hidden />
            {t('No changes: working tree clean')}
          </div>
        ) : null}
        {GROUPS.map(({ key, label, action }) =>
          groups[key].length ? (
            <section key={key} className="git-group" aria-label={t(label)}>
              <div className="git-group-head">
                <span className="micro">
                  {t(label)} · {groups[key].length}
                </span>
                <div className="grow" />
                <button className="btn ghost small" disabled={!!busy} onClick={() => act(key, groups[key].map((c) => c.path))}>
                  {t(action)}
                </button>
              </div>
              {groups[key].map((c) => {
                const active = sel?.path === c.path && sel.staged === (key === 'staged')
                const slash = c.path.lastIndexOf('/')
                const verb = key === 'staged' ? t('Unstage {path}', { path: c.path }) : t('Stage {path}', { path: c.path })
                return (
                  <div key={c.path} className={`git-file${active ? ' active' : ''}`}>
                    <button className="git-file-main" onClick={() => setSel({ path: c.path, staged: key === 'staged' })} aria-current={active || undefined} title={c.path}>
                      <span className="git-name">{c.path.slice(slash + 1)}</span>
                      <span className="git-dir">{slash > 0 ? c.path.slice(0, slash) : ''}</span>
                    </button>
                    <button className="iconbtn git-file-act" disabled={!!busy} onClick={() => act(key, [c.path])} title={verb} aria-label={verb}>
                      {key === 'staged' ? <Minus size={14} /> : <Plus size={14} />}
                    </button>
                    <span className={`git-code c-${c.code === '?' ? 'q' : c.code}`} title={t('Status {code}', { code: c.code })}>
                      {c.code}
                    </span>
                  </div>
                )
              })}
            </section>
          ) : null
        )}
      </div>
      {error ? (
        <div className="git-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="git-commit">
        <div className="git-msg">
          <textarea
            className="textarea"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void commit()}
            placeholder={t('Summary (required)')}
            aria-label={t('Commit message')}
            rows={3}
          />
          <button className="iconbtn git-suggest" onClick={suggest} disabled={!!busy || !total} title={t('Suggest message')} aria-label={t('Suggest message')}>
            {busy === 'suggest' ? <LoaderCircle size={14} className="git-spin" /> : <Sparkles size={14} />}
          </button>
        </div>
        <div className="row">
          <span className="faint git-hint">{groups.staged.length ? t('{n} staged', { n: groups.staged.length }) : t('Nothing staged')}</span>
          <div className="grow" />
          <button className="btn primary" onClick={commit} disabled={!msg.trim() || !groups.staged.length || !!busy} title={t('Commit staged changes (Ctrl+Enter)')}>
            {busy === 'commit' ? <LoaderCircle size={14} className="git-spin" /> : null}
            {t('Commit')}
          </button>
        </div>
      </div>
    </div>
  )

  const lines = diff?.split('\n') ?? []
  const diffPane = sel ? (
    <section className="git-diff-pane" aria-label={t('Diff of {path}', { path: sel.path })}>
      <div className="git-diff-head">
        {docked ? (
          <button className="iconbtn" onClick={() => setSel(null)} title={t('Back to changes')} aria-label={t('Back to changes')}>
            <ArrowLeft size={14} />
          </button>
        ) : null}
        <span className="git-diff-path" title={sel.path}>
          {sel.path}
        </span>
        <span className={`badge${sel.staged ? ' ok' : ''}`}>{sel.staged ? t('Staged') : t('Unstaged')}</span>
      </div>
      {diff === null ? (
        <div className="empty">{t('Loading…')}</div>
      ) : !diff.trim() ? (
        <div className="empty">{t('No differences.')}</div>
      ) : (
        <pre className="git-diff" tabIndex={0}>
          {lines.slice(0, MAX_DIFF_LINES).map((l, i) => (
            <div key={i} className={diffLineClass(l)}>
              {l || ' '}
            </div>
          ))}
          {lines.length > MAX_DIFF_LINES ? <div className="meta">{t('… {n} more lines not shown', { n: lines.length - MAX_DIFF_LINES })}</div> : null}
        </pre>
      )}
    </section>
  ) : (
    <div className="empty">{t('Select a file to see its diff.')}</div>
  )

  const history = (
    <div className="git-history">
      {log.length ? (
        log.map((c) => (
          <div key={c.hash} className="git-commit-row">
            <div className="git-subject">{c.subject}</div>
            <div className="git-meta">
              <span className="git-hash">{c.hash}</span> · {c.author} · {relativeTime(Date.parse(c.date))}
            </div>
          </div>
        ))
      ) : (
        <div className="empty">{t('No commits yet.')}</div>
      )}
    </div>
  )

  return (
    <div className={`git${docked ? ' docked' : ''}`}>
      <div className="git-bar">
        <GitBranch size={14} aria-hidden />
        <span className="git-branch">{status.branch ?? t('(no branch)')}</span>
        {status.ahead ? <span className="git-ab" title={t('Commits to push')}>↑{status.ahead}</span> : null}
        {status.behind ? <span className="git-ab" title={t('Commits to pull')}>↓{status.behind}</span> : null}
        <div className="grow" />
        <button className="iconbtn" onClick={() => void Promise.all([refresh(), refreshLog()])} title={t('Refresh')} aria-label={t('Refresh')}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="git-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          {t('Changes')}
          {total ? <span className="git-count">{total}</span> : null}
        </button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => (setTab('history'), void refreshLog())}>
          {t('History')}
        </button>
      </div>
      {tab === 'history' ? (
        history
      ) : docked ? (
        sel ? diffPane : changes
      ) : (
        <div className="git-split">
          {changes}
          {diffPane}
        </div>
      )}
    </div>
  )
}

// Git panel: status, diff, stage, commit, log — by shelling out to the user's git.
import { execFile } from 'node:child_process'
import type { GitCommit, GitStatus } from '../shared/types'
import { getProject } from './store'
import { insideProject } from './files'
import { record } from './activity'

// GIT_OPTIONAL_LOCKS=0: the panel polls status, which must not take index.lock from under an agent's own git commands.
// diff --no-index exits 1 when the files differ, so callers can list extra exit codes that count as success.
function git(projectId: string, args: string[], input?: string, okCodes: number[] = []): Promise<string> {
  const cwd = getProject(projectId).path
  return new Promise((resolve, reject) => {
    const opts = { cwd, timeout: 20_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }
    const child = execFile('git', args, opts, (err, out, errOut) =>
      err && !(typeof err.code === 'number' && okCodes.includes(err.code)) ? reject(new Error(String(errOut || err.message).trim())) : resolve(out)
    )
    if (input !== undefined) child.stdin?.end(input)
  })
}

/** Paths go to git after `--`, and only if they resolve inside the project. */
function paths(projectId: string, list: string[]): string[] {
  if (!Array.isArray(list) || !list.length) throw new Error('No files selected')
  for (const p of list) insideProject(projectId, p)
  return list.map(String)
}

export function parseStatus(out: string): GitStatus {
  const st: GitStatus = { isRepo: true, files: [] }
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) st.branch = line.slice(14)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) [st.ahead, st.behind] = [Number(m[1]), Number(m[2])]
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      // Type 2 (rename) ends with "<path>\t<orig>"; type 1 has 8 fields before the path.
      const path = line.startsWith('2 ') ? parts.slice(9).join(' ').split('\t')[0] : parts.slice(8).join(' ')
      st.files.push({ path, index: xy[0], worktree: xy[1] })
    } else if (line.startsWith('? ')) st.files.push({ path: line.slice(2), index: '?', worktree: '?' })
    else if (line.startsWith('u ')) st.files.push({ path: line.split(' ').slice(10).join(' '), index: 'U', worktree: 'U' })
  }
  return st
}

export const gitApi = {
  async status(projectId: string): Promise<GitStatus> {
    try {
      return parseStatus(await git(projectId, ['status', '--porcelain=v2', '--branch', '-uall']))
    } catch {
      return { isRepo: false, files: [] }
    }
  },
  async diff(projectId: string, path?: string, staged?: boolean): Promise<string> {
    const args = ['diff', '--no-color', '--no-ext-diff']
    if (staged) args.push('--cached')
    if (path) args.push('--', ...paths(projectId, [path]))
    const out = await git(projectId, args)
    // Untracked files have no diff; show their content as an addition instead.
    if (!out && path && !staged) {
      try {
        return await git(projectId, ['diff', '--no-color', '--no-index', '--', '/dev/null', path], undefined, [1])
      } catch (e) {
        return String((e as Error).message)
      }
    }
    return out
  },
  async stage(projectId: string, files: string[]): Promise<void> {
    await git(projectId, ['add', '--', ...paths(projectId, files)])
  },
  async unstage(projectId: string, files: string[]): Promise<void> {
    const list = paths(projectId, files)
    // Before the first commit there is no HEAD to restore from; dropping the paths from the index is the same thing.
    const hasHead = await git(projectId, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false)
    await git(projectId, hasHead ? ['restore', '--staged', '--', ...list] : ['rm', '--cached', '-r', '-q', '--', ...list])
  },
  async commit(projectId: string, message: string): Promise<void> {
    const msg = String(message ?? '').trim()
    if (!msg) throw new Error('Write a commit message first.')
    await git(projectId, ['commit', '-F', '-'], msg + '\n')
    record({ source: 'system', kind: 'git-commit', outcome: 'ok', projectId })
  },
  async log(projectId: string, limit = 30): Promise<GitCommit[]> {
    try {
      const out = await git(projectId, ['log', `-n${Math.min(200, Math.max(1, Math.round(limit)))}`, '--pretty=format:%h%x1f%s%x1f%an%x1f%cI'])
      return out
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [hash, subject, author, date] = l.split('\x1f')
          return { hash, subject, author, date }
        })
    } catch {
      return []
    }
  }
}

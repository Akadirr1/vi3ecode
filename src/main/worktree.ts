// Thread worktrees (Agent Mode "isolated worktree"), laid out as vi3ecode does: a work/<name> branch checked out
// beside the repository in <repo>-vi3ecode-worktrees/<name>, created from the current commit. Every agent turn of
// the thread runs there; Merge brings it back into the project checkout, Remove deletes tree and branch.
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { basename, dirname, join, relative } from 'node:path'
import { gitIn } from './git'
import { userDir } from './store'

export interface Worktree {
  /** The checkout itself. */
  root: string
  /** Where the project folder sits inside it (differs from root when the project is a subfolder of the repo). */
  path: string
  branch: string
}

const ADJ = ['bright', 'calm', 'swift', 'quiet', 'bold', 'keen', 'warm', 'wild']
const ANIMAL = ['fox', 'owl', 'lynx', 'wren', 'otter', 'ibis', 'hare', 'koi']
const rand3 = () => Array.from({ length: 3 }, () => randomInt(36).toString(36)).join('')

/** The thread title as a branch-safe slug plus 3 random characters; an adjective-animal pair when the title has none. */
export function workName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return slug ? `${slug}-${rand3()}` : `${ADJ[randomInt(ADJ.length)]}-${ANIMAL[randomInt(ANIMAL.length)]}-${rand3()}`
}

/** Commits and merges the app makes run with an empty hooks folder: code a worktree planted in hooks never runs. */
function noHooks(): string[] {
  const dir = userDir('git-no-hooks')
  mkdirSync(dir, { recursive: true })
  return ['-c', `core.hooksPath=${dir}`]
}

const top = async (cwd: string) => (await gitIn(cwd, ['rev-parse', '--show-toplevel'])).trim()

export async function createWorktree(projectPath: string, title: string): Promise<Worktree> {
  const repo = await top(projectPath)
  const name = workName(title)
  const root = join(dirname(repo), `${basename(repo)}-vi3ecode-worktrees`, name)
  const branch = `work/${name}`
  mkdirSync(dirname(root), { recursive: true })
  await gitIn(repo, ['worktree', 'add', '-b', branch, root, 'HEAD'])
  // Ignored files listed in .worktreeinclude (.env and the like) come along; a fresh checkout would lack them.
  if (existsSync(join(repo, '.worktreeinclude'))) {
    const out = await gitIn(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-from=.worktreeinclude']).catch(() => '')
    for (const rel of out.split('\0').filter(Boolean)) {
      const from = join(repo, rel)
      if (!lstatSync(from).isFile()) continue // never follow a symlink out of the repository
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      copyFileSync(from, join(root, rel))
    }
  }
  return { root, path: join(root, relative(realpathSync(repo), realpathSync(projectPath))), branch }
}

/** What the thread changed since it branched off: committed and uncommitted edits, then untracked files by name. */
export async function worktreeDiff(projectPath: string, wt: Worktree): Promise<string> {
  const head = (await gitIn(projectPath, ['rev-parse', 'HEAD'])).trim()
  const base = (await gitIn(wt.root, ['merge-base', 'HEAD', head])).trim()
  const diff = await gitIn(wt.root, ['diff', '--no-color', '--no-ext-diff', base])
  // shortcut: untracked files are listed by name only; `git add -N` first would show their content.
  const untracked = (await gitIn(wt.root, ['ls-files', '--others', '--exclude-standard'])).trim()
  return untracked ? `${diff}${diff ? '\n' : ''}Untracked:\n${untracked}\n` : diff
}

/** Commits what the team left uncommitted, then merges the branch; a failed merge is aborted, never left conflicted. */
export async function mergeWorktree(projectPath: string, wt: Worktree, message: string): Promise<void> {
  const hooks = noHooks()
  if (existsSync(wt.root) && (await gitIn(wt.root, ['status', '--porcelain'])).trim()) {
    await gitIn(wt.root, ['add', '-A'])
    await gitIn(wt.root, [...hooks, 'commit', '-m', message])
  }
  const repo = await top(projectPath)
  try {
    await gitIn(repo, [...hooks, 'merge', '--no-ff', '--no-edit', wt.branch])
  } catch (e) {
    await gitIn(repo, ['merge', '--abort']).catch(() => {})
    throw new Error(`Merge failed and was aborted. ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Removes tree and branch. Refuses with WORK_WORKTREE_DIRTY when that would lose uncommitted or unmerged work, unless forced. */
export async function removeWorktree(projectPath: string, wt: Worktree, force = false): Promise<void> {
  const repo = await top(projectPath)
  if (!force) {
    const dirty = existsSync(wt.root) && !!(await gitIn(wt.root, ['status', '--porcelain'])).trim()
    const unmerged = !!(await gitIn(repo, ['branch', '--list', '--no-merged=HEAD', wt.branch]).catch(() => '')).trim()
    if (dirty || unmerged) throw new Error('WORK_WORKTREE_DIRTY')
  }
  if (existsSync(wt.root)) await gitIn(repo, ['worktree', 'remove', '--force', wt.root])
  else await gitIn(repo, ['worktree', 'prune'])
  await gitIn(repo, ['branch', '-D', wt.branch]).catch(() => {}) // already gone is fine
}

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'vi3e-wt-'))
vi.mock('../src/main/store', () => ({ userDir: (...p: string[]) => join(tmp, 'user', ...p), getProject: () => ({}), getSettings: () => ({ hiddenEngines: [] }) }))
vi.mock('../src/main/activity', () => ({ record: () => {} }))
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const { createWorktree, isOurWorktree, mergeWorktree, removeWorktree, workName, worktreeDiff } = await import('../src/main/worktree')

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
function repo(name: string): string {
  const dir = join(tmp, name)
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  writeFileSync(join(dir, '.gitignore'), '.env\n')
  writeFileSync(join(dir, '.env'), 'SECRET=1\n')
  writeFileSync(join(dir, '.worktreeinclude'), '.env\nnotes.txt\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'notes.txt'), 'not ignored\n') // listed in .worktreeinclude but not gitignored: never copied
  return dir
}

describe('thread worktrees', () => {
  it('names the branch after the thread title, like vi3ecode', () => {
    expect(workName('Fix the login form!')).toMatch(/^fix-the-login-form-[a-z0-9]{3}$/)
    expect(workName('x'.repeat(80)).length).toBe(36)
    expect(workName('¿¡')).toMatch(/^(bright|calm|swift|quiet|bold|keen|warm|wild)-(fox|owl|lynx|wren|otter|ibis|hare|koi)-[a-z0-9]{3}$/)
  })

  it('creates the tree beside the repo, merges it back and removes it', async () => {
    const dir = repo('app')
    const wt = await createWorktree(dir, 'Add b')
    expect(wt.root).toBe(join(tmp, 'app-vi3ecode-worktrees', basename(wt.root)))
    expect(wt.branch).toBe(`work/${basename(wt.root)}`)
    expect(readFileSync(join(wt.root, '.env'), 'utf8')).toBe('SECRET=1\n') // from .worktreeinclude
    expect(existsSync(join(wt.root, 'notes.txt'))).toBe(false)
    writeFileSync(join(wt.path, 'b.txt'), 'two\n')
    expect(await worktreeDiff(dir, wt)).toContain('Untracked:\nb.txt')
    await expect(removeWorktree(dir, wt)).rejects.toThrow('WORK_WORKTREE_DIRTY')
    await mergeWorktree(dir, wt, 'Add b')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('two\n')
    await removeWorktree(dir, wt)
    expect(existsSync(wt.root)).toBe(false)
    expect(sh(dir, 'branch', '--list', wt.branch).trim()).toBe('')
  })

  it('refuses to drop unmerged commits, and aborts a conflicting merge', async () => {
    const dir = repo('conflict')
    const wt = await createWorktree(dir, 'Edit a')
    writeFileSync(join(wt.root, 'a.txt'), 'theirs\n')
    sh(wt.root, 'commit', '-qam', 'theirs')
    await expect(removeWorktree(dir, wt)).rejects.toThrow('WORK_WORKTREE_DIRTY')
    writeFileSync(join(dir, 'a.txt'), 'ours\n')
    sh(dir, 'commit', '-qam', 'ours')
    await expect(mergeWorktree(dir, wt, 'Edit a')).rejects.toThrow(/Merge failed and was aborted/)
    expect(sh(dir, 'status', '--porcelain', '--untracked-files=no')).toBe('')
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false)
    await removeWorktree(dir, wt, true)
    expect(existsSync(wt.root)).toBe(false)
  })

  it("never touches the user's own merge in progress or local edits", async () => {
    const dir = repo('busy')
    const wt = await createWorktree(dir, 'Edit b')
    writeFileSync(join(wt.root, 'b.txt'), 'b\n')
    // A merge the user is resolving in the project checkout
    sh(dir, 'checkout', '-qb', 'side')
    writeFileSync(join(dir, 'a.txt'), 'side\n')
    sh(dir, 'commit', '-qam', 'side')
    sh(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, 'a.txt'), 'main\n')
    sh(dir, 'commit', '-qam', 'main')
    try {
      sh(dir, 'merge', 'side')
    } catch {
      // conflict expected
    }
    writeFileSync(join(dir, 'a.txt'), 'resolved\n')
    sh(dir, 'add', 'a.txt')
    await expect(mergeWorktree(dir, wt, 'Edit b')).rejects.toThrow(/middle of a merge/)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('resolved\n')
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true)
    sh(dir, 'commit', '-qm', 'merged side')
    // An unrelated local edit (the app's own .vi3ecode files, say) neither blocks the merge nor gets lost.
    writeFileSync(join(dir, 'a.txt'), 'local edit\n')
    await mergeWorktree(dir, wt, 'Edit b')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('local edit\n')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('b\n')
  })

  it('only trusts worktree records in its own layout', () => {
    expect(isOurWorktree({ root: '/r/app-vi3ecode-worktrees/fix-abc', path: '/r/app-vi3ecode-worktrees/fix-abc', branch: 'work/fix-abc' })).toBe(true)
    expect(isOurWorktree({ root: '/r/app-vi3ecode-worktrees/fix-abc', path: '/x', branch: 'main' })).toBe(false)
    expect(isOurWorktree({ root: '/home/me', path: '/home/me', branch: 'work/me' })).toBe(false)
    expect(isOurWorktree({ root: '/r/app-vi3ecode-worktrees/x', path: '/x', branch: 'work/-x' })).toBe(false)
  })
})

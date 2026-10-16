import { describe, expect, it } from 'vitest'
import type { FileEntry, GitFile } from '../src/shared/types'

// The tool modules import the preload api at load time; a bare stub is enough for their pure helpers.
;(globalThis as { window?: unknown }).window = { api: {} }
const { treeRows } = await import('../src/renderer/src/tools/ExplorerTool')
const { groupChanges, diffLineClass } = await import('../src/renderer/src/tools/GitTool')
const { normalizeUrl } = await import('../src/renderer/src/tools/BrowserTool')

const f = (path: string, dir = false): FileEntry => ({ name: path.split('/').pop()!, path, dir })

describe('explorer treeRows', () => {
  const children = {
    '': [f('src', true), f('README.md')],
    src: [f('src/ui', true), f('src/main.ts')],
    'src/ui': [f('src/ui/Card.tsx')]
  }

  it('shows only expanded folders, with depth', () => {
    const rows = treeRows(children, new Set(['src']), '')
    expect(rows.map((r) => [r.entry.path, r.depth, r.open])).toEqual([
      ['src', 0, true],
      ['src/ui', 1, false],
      ['src/main.ts', 1, false],
      ['README.md', 0, false]
    ])
  })

  it('filters into loaded folders and keeps the path to each match open', () => {
    const rows = treeRows(children, new Set(), 'card')
    expect(rows.map((r) => [r.entry.path, r.open])).toEqual([
      ['src', true],
      ['src/ui', true],
      ['src/ui/Card.tsx', false]
    ])
    expect(treeRows(children, new Set(), 'nothing')).toEqual([])
  })
})

describe('git helpers', () => {
  it('groups porcelain entries; a file changed after staging is in both groups', () => {
    const files: GitFile[] = [
      { path: 'a.ts', index: 'M', worktree: 'M' },
      { path: 'b.ts', index: 'A', worktree: '.' },
      { path: 'c.ts', index: '.', worktree: 'D' },
      { path: 'n.ts', index: '?', worktree: '?' },
      { path: 'x.ts', index: 'U', worktree: 'U' }
    ]
    const g = groupChanges(files)
    expect(g.staged).toEqual([{ path: 'a.ts', code: 'M' }, { path: 'b.ts', code: 'A' }])
    expect(g.changes).toEqual([{ path: 'a.ts', code: 'M' }, { path: 'c.ts', code: 'D' }, { path: 'x.ts', code: 'U' }])
    expect(g.untracked).toEqual([{ path: 'n.ts', code: '?' }])
  })

  it('classifies diff lines, headers before +/-', () => {
    expect(['+++ b/a', '--- a/a', '@@ -1 +1 @@', '+x', '-y', ' z', 'diff --git a b'].map(diffLineClass)).toEqual([
      'meta',
      'meta',
      'hunk',
      'add',
      'del',
      '',
      'meta'
    ])
  })
})

describe('browser normalizeUrl', () => {
  it('accepts http(s), prefixes bare hosts, rejects other schemes', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeUrl(' https://a.dev ')).toBe('https://a.dev/')
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
  })
})

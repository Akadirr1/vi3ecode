import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquarePlus,
  RefreshCw,
  Search,
  X,
  type LucideIcon
} from 'lucide-react'
import type { FileContent, FileEntry } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import './explorer.css'

const ICONS: [RegExp, LucideIcon][] = [
  [/\.(tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte|css|scss|html?|sql)$/i, FileCode],
  [/\.(json|jsonc|ya?ml|toml)$/i, FileJson],
  [/\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/i, FileImage],
  [/\.(zip|gz|tgz|tar|7z|rar)$/i, FileArchive],
  [/\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i, FileTerminal],
  [/^\.|\.(lock|ini|env|conf|config)$/i, FileCog],
  [/\.(md|mdx|txt|rst|log|csv)$/i, FileText]
]

export const fileIcon = (name: string): LucideIcon => ICONS.find(([re]) => re.test(name))?.[1] ?? File

export interface TreeRow {
  entry: FileEntry
  depth: number
  open: boolean
}

/** Visible rows of the lazily loaded tree. A filter keeps matching names and the folders that lead to them. */
export function treeRows(children: Record<string, FileEntry[]>, expanded: Set<string>, filter: string): TreeRow[] {
  const q = filter.trim().toLowerCase()
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number): boolean => {
    let any = false
    for (const entry of children[dir] ?? []) {
      const at = rows.length
      const row: TreeRow = { entry, depth, open: !q && expanded.has(entry.path) }
      rows.push(row)
      const inner = entry.dir && (q || row.open) ? walk(entry.path, depth + 1) : false
      if (q) row.open = inner
      if (!q || inner || entry.name.toLowerCase().includes(q)) any = true
      else rows.length = at
    }
    return any
  }
  walk('', 0)
  return rows
}

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

// shortcut: the filter crawls at most this many folders through files.list; move search to main if repos outgrow it.
const CRAWL_LIMIT = 400

// Keyed by project so a project switch starts from a fresh tree.
export function ExplorerTool({ docked }: { docked: boolean }) {
  return <Explorer key={useApp().project.id} docked={docked} />
}

function Explorer({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const pid = ctx.project.id
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [content, setContent] = useState<FileContent | null>(null)
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [branch, setBranch] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [rev, setRev] = useState(0)
  const childrenRef = useRef(children)
  childrenRef.current = children

  const load = async (dir: string) => {
    try {
      const list = await api.files.list(pid, dir)
      setChildren((c) => ({ ...c, [dir]: list }))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Mount and refresh button: reload the root and every open folder.
  useEffect(() => {
    setChildren({})
    void Promise.all(['', ...expanded].map(load))
    void api.git.status(pid).then((s) => setBranch(s.isRepo ? (s.branch ?? null) : null), () => setBranch(null))
  }, [rev])

  const filtering = filter.trim() !== ''
  useEffect(() => {
    if (!filtering) return
    let stop = false
    void (async () => {
      const seen = { ...childrenRef.current }
      const queue = Object.values(seen).flat().filter((e) => e.dir && !seen[e.path]).map((e) => e.path)
      let batch: Record<string, FileEntry[]> = {}
      for (let n = 0; queue.length && n < CRAWL_LIMIT && !stop; n++) {
        const dir = queue.shift()!
        const list = await api.files.list(pid, dir).catch(() => [] as FileEntry[])
        seen[dir] = batch[dir] = list
        queue.push(...list.filter((e) => e.dir).map((e) => e.path))
        if (n % 25 === 24 || !queue.length) {
          const flush = batch
          batch = {}
          if (!stop) setChildren((c) => ({ ...c, ...flush }))
        }
      }
    })()
    return () => {
      stop = true
    }
  }, [filtering, rev])

  useEffect(() => {
    if (!sel) return
    let live = true
    setContent(null)
    setReadError('')
    api.files.read(pid, sel).then(
      (c) => live && setContent(c),
      (e: Error) => live && setReadError(e.message)
    )
    return () => {
      live = false
    }
  }, [sel, rev])

  const toggle = (e: FileEntry) => {
    if (!e.dir) return setSel(e.path)
    const next = new Set(expanded)
    if (next.has(e.path)) next.delete(e.path)
    else {
      next.add(e.path)
      if (!children[e.path]) void load(e.path)
    }
    setExpanded(next)
  }

  const copyPath = async () => {
    if (!sel) return
    await navigator.clipboard.writeText(sel)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const rows = treeRows(children, expanded, filter)
  const selName = sel?.split('/').pop() ?? ''
  const SelIcon = fileIcon(selName)
  const text = content && !content.binary ? content.text.replace(/\n$/, '') : ''
  const lineCount = text ? text.split('\n').length : 0

  return (
    <div className={`ex${docked ? ' docked' : ''}${sel ? ' has-preview' : ''}`}>
      <div className="ex-tree-pane">
        <div className="ex-head">
          <span className="ex-project" title={ctx.project.path}>
            {ctx.project.name}
          </span>
          <div className="grow" />
          <button className="iconbtn" onClick={() => setRev((r) => r + 1)} title={t('Refresh')} aria-label={t('Refresh')}>
            <RefreshCw size={14} />
          </button>
        </div>
        <label className="ex-search">
          <Search size={14} aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder={t('Search files...')}
            aria-label={t('Search files')}
            spellCheck={false}
          />
        </label>
        <div className="ex-tree" aria-label={t('Files')}>
          {error ? <div className="ex-note danger">{error}</div> : null}
          {rows.map(({ entry, depth, open }) => {
            const Icon = entry.dir ? (open ? FolderOpen : Folder) : fileIcon(entry.name)
            return (
              <button
                key={entry.path}
                className={`ex-row${sel === entry.path ? ' active' : ''}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                aria-expanded={entry.dir ? open : undefined}
                aria-current={sel === entry.path || undefined}
                onClick={() => toggle(entry)}
                title={entry.path}
                draggable={!entry.dir}
                onDragStart={(ev) => ev.dataTransfer.setData('text/plain', '@' + entry.path)}
              >
                <span className="ex-chev" aria-hidden>
                  {entry.dir ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
                </span>
                <Icon size={15} className={entry.dir ? 'ex-ico dir' : 'ex-ico'} aria-hidden />
                <span className="ex-name">{entry.name}</span>
              </button>
            )
          })}
          {!rows.length && !error ? <div className="ex-note">{filtering ? t('No matching files') : t('This folder is empty')}</div> : null}
        </div>
        {branch ? (
          <div className="ex-foot" title={t('Current branch')}>
            <GitBranch size={12} aria-hidden />
            {branch}
          </div>
        ) : null}
      </div>

      {sel ? (
        <section className="ex-preview" aria-label={t('Preview')}>
          <div className="ex-preview-head">
            <SelIcon size={14} className="ex-ico" aria-hidden />
            <span className="ex-path" title={sel}>
              {sel}
            </span>
            {content ? <span className="ex-size">{formatSize(content.size)}</span> : null}
            <div className="grow" />
            <button className="iconbtn" onClick={() => ctx.attachToChat('@' + sel)} title={t('Send to chat')} aria-label={t('Send to chat')}>
              <MessageSquarePlus size={14} />
            </button>
            <button className="iconbtn" onClick={copyPath} title={t('Copy path')} aria-label={t('Copy path')}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button className="iconbtn" onClick={() => setSel(null)} title={t('Close preview')} aria-label={t('Close preview')}>
              <X size={14} />
            </button>
          </div>
          {content?.truncated ? <div className="ex-banner">{t('Large file: showing the first 512 KB.')}</div> : null}
          {readError ? (
            <div className="empty">{readError}</div>
          ) : !content ? (
            <div className="ex-note">{t('Loading…')}</div>
          ) : content.binary ? (
            <div className="empty">{t('Binary file: no preview.')}</div>
          ) : (
            <div className="ex-code" tabIndex={0} aria-label={t('Contents of {path}', { path: sel })}>
              <pre className="ex-gutter" aria-hidden>
                {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
              </pre>
              <pre className="ex-text">{text}</pre>
            </div>
          )}
        </section>
      ) : docked ? null : (
        <div className="ex-preview empty">{t('Select a file to preview it.')}</div>
      )}
    </div>
  )
}

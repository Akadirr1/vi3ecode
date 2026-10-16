import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, List, Plus, Waypoints } from 'lucide-react'
import { MEMORY_TYPES, type MemoryNote, type MemoryType } from '../../../shared/types'
import { buildBrief, extractLinks, slugify } from '../../../shared/memory'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { forceLayout } from './forceLayout'
import './project-tools.css'

interface Draft {
  /** Set once the note exists on disk; a slug never changes after that. */
  slug?: string
  title: string
  type: MemoryType
  tags: string
  body: string
  created?: string
}

const TYPE_HELP: Record<MemoryType, string> = {
  fact: 'something true about the project',
  decision: 'a choice that was made, and why',
  pattern: 'how things are done here',
  context: 'background that explains the code',
  lesson: 'something learned the hard way',
  warning: 'a trap agents must not fall into',
  todo: 'follow-up work to remember',
  reference: 'a pointer to docs or outside material'
}

const TYPE_COLOR: Record<MemoryType, string> = {
  fact: '#94a3b8',
  decision: '#8b9cf9',
  pattern: '#38bdf8',
  context: '#2dd4bf',
  lesson: '#34d399',
  warning: '#f87171',
  todo: '#fbbf24',
  reference: '#c084fc'
}

function uniqueSlug(title: string, taken: Set<string>): string {
  const base = slugify(title)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const slug = base.slice(0, 64 - suffix.length).replace(/-+$/, '') + suffix
    if (!taken.has(slug)) return slug
  }
}

const toDraft = (n: MemoryNote): Draft => ({
  slug: n.slug,
  title: n.title,
  type: n.type,
  tags: n.tags.join(', '),
  body: n.body,
  created: n.created
})

const blank = (): Draft => ({ title: '', type: 'fact', tags: '', body: '' })

const TypeDot = ({ type }: { type: MemoryType }) => <span className="dot" style={{ background: TYPE_COLOR[type] }} aria-hidden />

export function MemoryTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<MemoryType | ''>('')
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void api.memory.list(projectId).then(setNotes, (e: Error) => setStatus(e.message))
  }, [projectId])

  if (!notes) return status ? <div className="empty">{status}</div> : null

  const open = (d: Draft | null) => {
    if (dirty && !confirm(t('Discard unsaved changes to this note?'))) return
    setDraft(d)
    setDirty(false)
    setStatus('')
  }
  const edit = (p: Partial<Draft>) => {
    setDraft((d) => d && { ...d, ...p })
    setDirty(true)
  }

  const bySlug = new Map(notes.map((n) => [n.slug, n]))
  const slug = draft ? (draft.slug ?? uniqueSlug(draft.title, new Set(bySlug.keys()))) : ''

  const save = async () => {
    if (!draft) return
    try {
      const saved = await api.memory.save(projectId, {
        slug,
        title: draft.title.trim() || slug,
        type: draft.type,
        tags: draft.tags.split(',').map((x) => x.trim()).filter(Boolean),
        body: draft.body,
        created: draft.created
      })
      setNotes([...notes.filter((n) => n.slug !== saved.slug), saved])
      setDraft(toDraft(saved))
      setDirty(false)
      setStatus(t('Saved'))
    } catch (e) {
      setStatus(t('Not saved: {error}', { error: (e as Error).message }))
    }
  }

  const remove = async () => {
    if (!draft?.slug || !confirm(t('Delete "{title}" (.vi3ecode/memory/{slug}.md)?', { title: draft.title, slug: draft.slug }))) return
    try {
      await api.memory.remove(projectId, draft.slug)
      setNotes(notes.filter((n) => n.slug !== draft.slug))
      setDraft(null)
      setDirty(false)
      setStatus('')
    } catch (e) {
      setStatus(t('Not deleted: {error}', { error: (e as Error).message }))
    }
  }

  const q = query.trim().toLowerCase()
  const list = notes
    .filter((n) => !typeFilter || n.type === typeFilter)
    .filter((n) => !q || [n.title, n.slug, n.body, ...n.tags].join('\n').toLowerCase().includes(q))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title))
  const tokens = Math.ceil(buildBrief(notes).length / 4)
  const outgoing = draft ? extractLinks(draft.body).filter((s) => s !== slug) : []
  const backlinks = draft ? notes.filter((n) => n.slug !== slug && n.links.includes(slug)) : []
  const showMaster = !docked || !draft
  const showDetail = !docked || !!draft

  const chip = (s: string) => {
    const target = bySlug.get(s)
    return target ? (
      <button key={s} className="mem-link" onClick={() => open(toDraft(target))} title={target.title}>
        [[{s}]]
      </button>
    ) : (
      <span key={s} className="mem-link missing" title={t('No note with this slug yet')}>
        [[{s}]]
      </span>
    )
  }

  return (
    <div className="pt">
      <div className="pt-bar">
        <input
          className="input mem-search"
          type="search"
          placeholder={t('Search memories...')}
          aria-label={t('Search memories')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grow" />
        <div className="row mem-views" role="group" aria-label={t('View')}>
          <button className="iconbtn" aria-pressed={view === 'list'} aria-label={t('List view')} title={t('List view')} onClick={() => setView('list')}>
            <List size={15} />
          </button>
          <button className="iconbtn" aria-pressed={view === 'graph'} aria-label={t('Graph view')} title={t('Graph view')} onClick={() => setView('graph')}>
            <Waypoints size={15} />
          </button>
        </div>
        <button className="btn primary small" onClick={() => open(blank())}>
          <Plus size={13} />
          {t('New memory')}
        </button>
      </div>
      <div className="mem-chips" role="group" aria-label={t('Filter by type')}>
        <button className="chip" aria-pressed={!typeFilter} onClick={() => setTypeFilter('')}>
          {t('All')}
        </button>
        {MEMORY_TYPES.map((ty) => (
          <button key={ty} className="chip" aria-pressed={typeFilter === ty} onClick={() => setTypeFilter(typeFilter === ty ? '' : ty)}>
            <TypeDot type={ty} />
            {t(ty)}
          </button>
        ))}
      </div>
      <div className={docked ? 'pt-single' : `pt-split${view === 'graph' ? ' wide' : ''}`}>
        {showMaster ? (
          view === 'graph' ? (
            <Graph notes={list} selected={draft?.slug} onSelect={(n) => open(toDraft(n))} />
          ) : (
            <div className="pt-list">
              <div className="pt-items">
                {list.map((n) => (
                  <button
                    key={n.slug}
                    className={`list-item pt-item${n.slug === draft?.slug ? ' active' : ''}`}
                    aria-current={n.slug === draft?.slug || undefined}
                    onClick={() => open(toDraft(n))}
                  >
                    <TypeDot type={n.type} />
                    <span className="pt-item-title">{n.title}</span>
                    <span className="pt-meta">{t(n.type)}</span>
                  </button>
                ))}
                {!list.length ? <div className="faint small pt-none">{notes.length ? t('No results found') : t('No memories yet')}</div> : null}
              </div>
            </div>
          )
        ) : null}
        {showDetail ? (
          draft ? (
            <div className="mem-editor">
              <div className="nt-head">
                {docked ? (
                  <button className="iconbtn" onClick={() => open(null)} aria-label={t('Back')} title={t('Back')}>
                    <ChevronLeft size={15} />
                  </button>
                ) : null}
                <input
                  className="nt-title"
                  placeholder={t('Title')}
                  aria-label={t('Note title')}
                  autoFocus={!draft.slug}
                  value={draft.title}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </div>
              <div className="row mem-fields">
                <label className="field">
                  <span className="micro">{t('Type')}</span>
                  <select className="select" value={draft.type} onChange={(e) => edit({ type: e.target.value as MemoryType })}>
                    {MEMORY_TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(ty)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span className="micro">{t('Tags (comma-separated)')}</span>
                  <input className="input" value={draft.tags} onChange={(e) => edit({ tags: e.target.value })} />
                </label>
              </div>
              <div className="pt-path">
                .vi3ecode/memory/{slug}.md{draft.slug ? '' : ` — ${t('the file name is fixed once saved')}`}
              </div>
              <textarea
                className="textarea mem-body"
                aria-label={t('Note text')}
                placeholder={t('What should every agent know? Link other notes as [[slug]].')}
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
              />
              <div className="mem-links">
                <span className="micro">{t('Links to')}</span>
                {outgoing.length ? outgoing.map(chip) : <span className="faint">—</span>}
              </div>
              <div className="mem-links">
                <span className="micro">{t('Linked from')}</span>
                {backlinks.length ? backlinks.map((n) => chip(n.slug)) : <span className="faint">—</span>}
              </div>
              <div className="row">
                <button className="btn primary small" disabled={!dirty} onClick={() => void save()}>
                  {t('Save')}
                </button>
                {draft.slug ? (
                  <button className="btn danger small" onClick={() => void remove()}>
                    {t('Delete')}
                  </button>
                ) : null}
                <span className="small muted" role="status">
                  {dirty ? t('Unsaved changes') : status}
                </span>
              </div>
            </div>
          ) : (
            <div className="mem-intro">
              <h3>{notes.length ? t('Select a note') : t('No memories yet')}</h3>
              <p className="muted">
                {t('Durable knowledge every agent should start from. Each note is a Markdown file in .vi3ecode/memory/, committed with the repo, so teammates and their agents share it. Link notes with [[slug]].')}
              </p>
              <dl className="mem-types">
                {MEMORY_TYPES.map((ty) => (
                  <div key={ty} className="row">
                    <dt className="row">
                      <TypeDot type={ty} />
                      <span className="mono">{t(ty)}</span>
                    </dt>
                    <dd className="muted">{t(TYPE_HELP[ty])}</dd>
                  </div>
                ))}
              </dl>
              <button className="btn primary small" onClick={() => open(blank())}>
                <Plus size={13} />
                {t('Create your first memory')}
              </button>
              {status ? <p className="small muted">{status}</p> : null}
            </div>
          )
        ) : null}
      </div>
      <div className="pt-foot">
        <button
          className="switch"
          aria-pressed={ctx.settings.memoryInject}
          title={t('Add the memory brief ahead of each chat or agent prompt')}
          onClick={() => void ctx.setSettings({ memoryInject: !ctx.settings.memoryInject })}
        >
          {t('Inject')}
        </button>
        <button
          className="switch"
          aria-pressed={ctx.settings.memoryWriteBack}
          title={t('Let agents write notes back to .vi3ecode/memory/')}
          onClick={() => void ctx.setSettings({ memoryWriteBack: !ctx.settings.memoryWriteBack })}
        >
          {t('Write-back')}
        </button>
        <div className="grow" />
        <span className="pt-meta" title={t('Size of the memory brief added ahead of each chat or agent prompt while injection is on')}>
          {ctx.settings.memoryInject ? t('≈{n} tokens / turn', { n: tokens }) : t('Passive')}
        </span>
        <span className="pt-meta">{t('{n} notes', { n: notes.length })}</span>
      </div>
    </div>
  )
}

const GW = 520
const GH = 520

/** Notes as nodes coloured by type, [[links]] as edges; click or Enter selects. */
function Graph({ notes, selected, onSelect }: { notes: MemoryNote[]; selected?: string; onSelect(n: MemoryNote): void }) {
  const ids = notes.map((n) => n.slug)
  const known = new Set(ids)
  const edges = notes.flatMap((n) => n.links.filter((l) => known.has(l) && l !== n.slug).map((l): [string, string] => [n.slug, l]))
  const key = JSON.stringify([ids, edges])
  // Keyed on content, not array identity, so re-renders of the same vault keep the same picture.
  const pos = useMemo(() => forceLayout(ids, edges, GW, GH, 60), [key])
  if (!notes.length) return <div className="empty">{t('No notes to draw')}</div>
  return (
    <div className="mem-graph">
      <svg viewBox={`0 0 ${GW} ${GH}`} role="group" aria-label={t('Memory Graph')}>
        {edges.map(([a, b]) => {
          const p = pos.get(a)!
          const q = pos.get(b)!
          return <line key={`${a}>${b}`} className={`mem-edge${a === selected || b === selected ? ' active' : ''}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
        })}
        {notes.map((n) => {
          const p = pos.get(n.slug)!
          return (
            <g
              key={n.slug}
              className={`mem-node${n.slug === selected ? ' active' : ''}`}
              transform={`translate(${p.x} ${p.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${n.title} (${t(n.type)})`}
              onClick={() => onSelect(n)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                onSelect(n)
              }}
            >
              <circle r={7} fill={TYPE_COLOR[n.type]} />
              <text y={-12} textAnchor="middle">
                {n.title.length > 18 ? `${n.title.slice(0, 17)}…` : n.title}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

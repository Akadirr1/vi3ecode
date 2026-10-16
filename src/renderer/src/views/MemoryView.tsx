import { useEffect, useState } from 'react'
import { MEMORY_TYPES, type MemoryNote, type MemoryType } from '../../../shared/types'
import { buildBrief, extractLinks, slugify } from '../../../shared/memory'
import { api } from '../api'
import { useApp } from '../context'
import './memory.css'

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

const TYPE_BADGE: Partial<Record<MemoryType, string>> = { warning: 'danger', decision: 'accent', lesson: 'ok', todo: 'warn' }

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

export function MemoryView() {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<MemoryType | ''>('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void api.memory.list(projectId).then(setNotes, (e: Error) => setStatus(e.message))
  }, [projectId])

  if (!notes) return <div className="view">{status ? <div className="empty">{status}</div> : null}</div>

  const open = (d: Draft) => {
    if (dirty && !confirm('Discard unsaved changes to this note?')) return
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
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        body: draft.body,
        created: draft.created
      })
      setNotes([...notes.filter((n) => n.slug !== saved.slug), saved])
      setDraft(toDraft(saved))
      setDirty(false)
      setStatus('Saved')
    } catch (e) {
      setStatus(`Not saved: ${(e as Error).message}`)
    }
  }

  const remove = async () => {
    if (!draft?.slug || !confirm(`Delete "${draft.title}" (.vi3ecode/memory/${draft.slug}.md)?`)) return
    try {
      await api.memory.remove(projectId, draft.slug)
      setNotes(notes.filter((n) => n.slug !== draft.slug))
      setDraft(null)
      setDirty(false)
      setStatus('')
    } catch (e) {
      setStatus(`Not deleted: ${(e as Error).message}`)
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

  const chip = (s: string) => {
    const target = bySlug.get(s)
    return target ? (
      <button key={s} className="mem-chip" onClick={() => open(toDraft(target))} title={target.title}>
        [[{s}]]
      </button>
    ) : (
      <span key={s} className="mem-chip missing" title="No note with this slug yet">
        [[{s}]]
      </span>
    )
  }

  return (
    <div className="view">
      <div className="view-header mem-header">
        <h2>Memory</h2>
        <input
          className="input mem-search"
          type="search"
          placeholder="Search notes"
          aria-label="Search memory notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select mem-type-filter"
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as MemoryType | '')}
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <label className="check small">
          <input
            type="checkbox"
            checked={ctx.settings.memoryInject}
            onChange={(e) => void ctx.setSettings({ memoryInject: e.target.checked })}
          />
          Inject into chats
        </label>
        <label className="check small">
          <input
            type="checkbox"
            checked={ctx.settings.memoryWriteBack}
            onChange={(e) => void ctx.setSettings({ memoryWriteBack: e.target.checked })}
          />
          Agents write back
        </label>
        <span
          className={`badge${ctx.settings.memoryInject ? ' accent' : ''}`}
          title="Size of the memory brief added ahead of each chat or agent prompt while injection is on"
        >
          ≈ {tokens} tokens per turn
        </span>
      </div>
      <div className="split">
        <div className="list-pane col">
          <button className="btn small" onClick={() => open({ title: '', type: 'fact', tags: '', body: '' })}>
            + New note
          </button>
          <div className="mem-list">
            {list.map((n) => (
              <button
                key={n.slug}
                className={`list-item${n.slug === draft?.slug ? ' active' : ''}`}
                aria-current={n.slug === draft?.slug || undefined}
                onClick={() => open(toDraft(n))}
              >
                <span className="grow mem-item-title">{n.title}</span>
                <span className={`badge ${TYPE_BADGE[n.type] ?? ''}`}>{n.type}</span>
              </button>
            ))}
            {!list.length && notes.length ? <div className="faint small mem-none">No matches</div> : null}
          </div>
        </div>
        <div className="detail-pane">
          {draft ? (
            <div className="mem-editor">
              <input
                className="input mem-title"
                placeholder="Title"
                aria-label="Note title"
                autoFocus={!draft.slug}
                value={draft.title}
                onChange={(e) => edit({ title: e.target.value })}
              />
              <div className="row">
                <label className="field">
                  Type
                  <select className="select" value={draft.type} onChange={(e) => edit({ type: e.target.value as MemoryType })}>
                    {MEMORY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  Tags (comma-separated)
                  <input className="input" value={draft.tags} onChange={(e) => edit({ tags: e.target.value })} />
                </label>
              </div>
              <div className="faint small">
                <span className="mono">.vi3ecode/memory/{slug}.md</span>
                {draft.slug ? null : ' — the file name is fixed once saved'}
              </div>
              <textarea
                className="textarea mem-body"
                aria-label="Note text"
                placeholder="What should every agent know? Link other notes as [[slug]]."
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
              />
              <div className="mem-links small">
                <span className="faint">Links to</span>
                {outgoing.length ? outgoing.map(chip) : <span className="faint">—</span>}
                <span className="faint mem-links-gap">Linked from</span>
                {backlinks.length ? backlinks.map((n) => chip(n.slug)) : <span className="faint">—</span>}
              </div>
              <div className="row">
                <button className="btn primary small" disabled={!dirty} onClick={() => void save()}>
                  Save
                </button>
                {draft.slug ? (
                  <button className="btn danger small" onClick={() => void remove()}>
                    Delete
                  </button>
                ) : null}
                <span className="small muted" role="status">
                  {dirty ? 'Unsaved changes' : status}
                </span>
              </div>
            </div>
          ) : (
            <div className="mem-intro">
              <h3>{notes.length ? 'Select a note' : 'Your project memory is empty'}</h3>
              <p className="muted">
                Durable knowledge every agent should start from. Each note is a Markdown file in{' '}
                <code>.vi3ecode/memory/</code>, committed with the repo, so teammates and their agents share it. Link
                notes with <code>[[slug]]</code>.
              </p>
              <dl className="mem-types">
                {MEMORY_TYPES.map((t) => (
                  <div key={t} className="row">
                    <dt>
                      <span className={`badge ${TYPE_BADGE[t] ?? ''}`}>{t}</span>
                    </dt>
                    <dd className="muted">{TYPE_HELP[t]}</dd>
                  </div>
                ))}
              </dl>
              <button className="btn primary small" onClick={() => open({ title: '', type: 'fact', tags: '', body: '' })}>
                + New note
              </button>
              {status ? <p className="small muted">{status}</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

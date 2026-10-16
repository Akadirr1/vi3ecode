import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ChevronLeft, Eraser, MessageSquarePlus, PenLine, Plus, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import type { Note, Notes, SketchStroke } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { relativeTime } from '../components/format'
import './project-tools.css'

const noteName = (n: Note) => n.title.trim() || n.body.split('\n').find((l) => l.trim())?.trim() || t('Untitled note')
const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export function NotesTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [data, setData] = useState<Notes | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<'text' | 'sketch'>('text')
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  // Latest notes, read by patches that land after an await (Ask AI) so they never overwrite newer edits.
  const latest = useRef<Notes | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Notes | null>(null)
  const rev = useRef(0)

  useEffect(() => {
    void api.notes.get(projectId).then(
      (n) => {
        latest.current = n
        setData(n)
        // Docked starts on the list; full size opens the most recent note.
        if (!docked) setSelectedId([...n.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
      },
      (e: Error) => setError(e.message)
    )
    // Leaving the view must not drop an edit still waiting for its debounce.
    return () => {
      clearTimeout(timer.current)
      if (pending.current) void api.notes.save(projectId, pending.current)
    }
  }, [projectId])

  if (!data) return error ? <div className="empty">{error}</div> : null

  const update = (next: Notes) => {
    latest.current = next
    setData(next)
    pending.current = next
    const r = ++rev.current
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      pending.current = null
      try {
        const saved = await api.notes.save(projectId, next)
        if (r === rev.current) {
          latest.current = saved
          setData(saved)
        }
        setError('')
      } catch (e) {
        setError(t('Not saved: {error}', { error: (e as Error).message }))
      }
    }, 300)
  }

  const patch = (id: string, p: Partial<Note>) => {
    const d = latest.current!
    update({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...p, updatedAt: Date.now() } : n)) })
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    setAsking(null)
  }

  const create = () => {
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', strokes: [], updatedAt: Date.now() }
    update({ ...data, notes: [note, ...data.notes] })
    setQuery('')
    select(note.id)
    setView('text')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const askAi = async (noteId: string, instruction: string) => {
    const n = latest.current?.notes.find((x) => x.id === noteId)
    if (!n || !instruction.trim()) return
    setBusy(true)
    setError('')
    try {
      const answer = (await api.ai.ask(projectId, `${instruction.trim()}\n\nNote:\n${n.body}`)).trim()
      const cur = latest.current?.notes.find((x) => x.id === noteId)
      if (cur && answer) patch(noteId, { body: cur.body.trimEnd() + (cur.body.trim() ? '\n\n' : '') + answer })
      setAsking(null)
    } catch (e) {
      setError(t('Ask AI failed: {error}', { error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const q = query.trim().toLowerCase()
  const list = data.notes
    .filter((n) => !q || `${n.title}\n${n.body}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const note = data.notes.find((n) => n.id === selectedId) ?? null
  const text = note ? [note.title.trim(), note.body].filter(Boolean).join('\n\n') : ''
  const showList = !docked || !note
  const showEditor = !docked || !!note

  return (
    <div className="pt">
      <div className="pt-bar">
        <span className="pt-path">.vi3ecode/notes.json</span>
        <div className="grow" />
        <span className="pt-status" role="status">
          {error}
        </span>
        <button className="btn primary small" onClick={create}>
          <Plus size={13} />
          {t('New note')}
        </button>
      </div>
      <div className={docked ? 'pt-single' : 'pt-split'}>
        {showList ? (
          <div className="pt-list">
            <input
              className="input"
              type="search"
              placeholder={t('Search notes')}
              aria-label={t('Search notes')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="pt-items">
              {list.map((n) => (
                <button
                  key={n.id}
                  className={`list-item pt-item${n.id === selectedId ? ' active' : ''}`}
                  aria-current={n.id === selectedId || undefined}
                  onClick={() => select(n.id)}
                >
                  <span className="pt-item-title">{noteName(n)}</span>
                  {n.strokes.length ? <PenLine size={12} className="faint" aria-label={t('Has a sketch')} /> : null}
                  <span className="pt-meta">{relativeTime(n.updatedAt)}</span>
                </button>
              ))}
              {!list.length ? <div className="faint small pt-none">{q ? t('No matches') : t('No notes yet')}</div> : null}
            </div>
          </div>
        ) : null}
        {showEditor ? (
          note ? (
            <div className="nt-editor">
              <div className="nt-head">
                {docked ? (
                  <button className="iconbtn" onClick={() => select(null)} aria-label={t('All notes')} title={t('All notes')}>
                    <ChevronLeft size={15} />
                  </button>
                ) : null}
                <input
                  ref={titleRef}
                  className="nt-title"
                  placeholder={t('Untitled note')}
                  aria-label={t('Note title')}
                  value={note.title}
                  onChange={(e) => patch(note.id, { title: e.target.value })}
                />
                <div className="seg nt-seg" role="group" aria-label={t('Page view')}>
                  <button aria-pressed={view === 'text'} onClick={() => setView('text')}>
                    {t('Text')}
                  </button>
                  <button aria-pressed={view === 'sketch'} onClick={() => setView('sketch')}>
                    {t('Sketch')}
                    {note.strokes.length ? ` · ${note.strokes.length}` : ''}
                  </button>
                </div>
              </div>
              {view === 'text' ? (
                <textarea
                  className="nt-body"
                  placeholder={t('Write anything: plans, snippets, prompts to reuse…')}
                  aria-label={t('Note text')}
                  value={note.body}
                  onChange={(e) => patch(note.id, { body: e.target.value })}
                />
              ) : (
                <Sketch key={note.id} strokes={note.strokes} onChange={(strokes) => patch(note.id, { strokes })} />
              )}
              {asking !== null ? (
                <form
                  className="nt-ask"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void askAi(note.id, asking)
                  }}
                >
                  <Sparkles size={14} className="faint" aria-hidden />
                  <input
                    className="input grow"
                    autoFocus
                    disabled={busy}
                    aria-label={t('Instruction for the AI')}
                    placeholder={t('Summarise, turn into a checklist, continue…')}
                    value={asking}
                    onChange={(e) => setAsking(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && !busy && setAsking(null)}
                  />
                  <button className="btn primary small" disabled={busy || !asking.trim()}>
                    {busy ? t('Asking…') : t('Ask')}
                  </button>
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => setAsking(null)}>
                    {t('Cancel')}
                  </button>
                </form>
              ) : null}
              <div className="nt-actions">
                <button className="btn small" disabled={busy} onClick={() => setAsking('')}>
                  <Sparkles size={13} />
                  {t('Ask AI')}
                </button>
                <button className="btn small" disabled={!text} onClick={() => ctx.openChat(text)}>
                  <MessageSquarePlus size={13} />
                  {t('Send to chat')}
                </button>
                <button className="btn small" disabled={!note.body} onClick={() => ctx.sendToTerminal(note.body)}>
                  <SquareTerminal size={13} />
                  {t('Add to terminal')}
                </button>
                <div className="grow" />
                {docked ? null : <span className="pt-meta">{t('{n} words', { n: wordCount(note.body) })}</span>}
                <button
                  className="iconbtn"
                  aria-label={t('Delete note')}
                  title={t('Delete note')}
                  onClick={() => {
                    if (!confirm(t('Delete "{title}"? This cannot be undone.', { title: noteName(note) }))) return
                    update({ ...data, notes: data.notes.filter((n) => n.id !== note.id) })
                    select(null)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div>{data.notes.length ? t('Select a note') : t('No notes yet')}</div>
              <div className="small">{t('Notes are saved to .vi3ecode/notes.json and travel with your commits.')}</div>
              <button className="btn small" onClick={create}>
                <Plus size={13} />
                {t('New note')}
              </button>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

// '#e6e8ec' is the stored "ink" colour; it is drawn in the theme's text colour so it shows on light and dark.
const INK = '#e6e8ec'
const COLORS: [string, string][] = [
  [INK, 'Ink'],
  ['#f87171', 'Red'],
  ['#60a5fa', 'Blue'],
  ['#34d399', 'Green']
]
const WIDTHS: [number, string][] = [
  [4, 'Thin'],
  [10, 'Thick']
]

/** Freehand pen over a 1000×600 canvas space; the SVG viewBox scales it to the element. */
function Sketch({ strokes, onChange }: { strokes: SketchStroke[]; onChange(strokes: SketchStroke[]): void }) {
  const [color, setColor] = useState(INK)
  const [width, setWidth] = useState(WIDTHS[0][0])
  const [live, setLive] = useState<number[] | null>(null)

  const at = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * 10000) / 10, Math.round(((e.clientY - r.top) / r.height) * 6000) / 10]
  }
  const line = (s: SketchStroke | { color: string; width: number; points: number[] }, key: number | string) => (
    <polyline
      key={key}
      points={s.points.join(' ')}
      fill="none"
      stroke={s.color === INK ? 'var(--text)' : s.color}
      strokeWidth={s.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )

  return (
    <div className="sk">
      <div className="sk-tools" role="toolbar" aria-label={t('Sketch tools')}>
        {COLORS.map(([c, name]) => (
          <button
            key={c}
            className="sk-swatch"
            aria-pressed={color === c}
            aria-label={t(name)}
            title={t(name)}
            style={{ color: c === INK ? 'var(--text)' : c }}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="sk-sep" />
        {WIDTHS.map(([w, name]) => (
          <button key={w} className="iconbtn" aria-pressed={width === w} aria-label={t(name)} title={t(name)} onClick={() => setWidth(w)}>
            <span className="sk-width" style={{ height: w / 2 + 1 }} />
          </button>
        ))}
        <span className="sk-sep" />
        <button className="iconbtn" disabled={!strokes.length} aria-label={t('Erase last stroke')} title={t('Erase last stroke')} onClick={() => onChange(strokes.slice(0, -1))}>
          <Eraser size={14} />
        </button>
        <button
          className="iconbtn"
          disabled={!strokes.length}
          aria-label={t('Clear sketch')}
          title={t('Clear sketch')}
          onClick={() => confirm(t('Clear the whole sketch?')) && onChange([])}
        >
          <Trash2 size={14} />
        </button>
        <div className="grow" />
        <span className="pt-meta">{t('{n} strokes', { n: strokes.length })}</span>
      </div>
      <svg
        className="sk-canvas"
        viewBox="0 0 1000 600"
        role="img"
        aria-label={t('Sketch canvas')}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          const [x, y] = at(e)
          setLive([x, y, x, y]) // a click alone still leaves a dot
        }}
        onPointerMove={(e) => {
          if (!live) return
          const [x, y] = at(e)
          if (Math.hypot(x - live[live.length - 2], y - live[live.length - 1]) >= 2) setLive([...live, x, y])
        }}
        onPointerUp={() => {
          if (live) onChange([...strokes, { color, width, points: live }])
          setLive(null)
        }}
        onPointerCancel={() => setLive(null)}
      >
        {strokes.map(line)}
        {live ? line({ color, width, points: live }, 'live') : null}
      </svg>
    </div>
  )
}

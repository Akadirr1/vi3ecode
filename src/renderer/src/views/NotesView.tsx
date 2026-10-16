import { useEffect, useRef, useState } from 'react'
import type { Note, Notes } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import './notes.css'

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

const noteName = (n: Note) => n.title.trim() || n.body.split('\n').find((l) => l.trim())?.trim() || 'Untitled'

export function NotesView() {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [data, setData] = useState<Notes | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Notes | null>(null)
  const rev = useRef(0)

  useEffect(() => {
    void api.notes.get(projectId).then((n) => {
      setData(n)
      setSelectedId([...n.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
    }, (e: Error) => setError(e.message))
    // Leaving the view must not drop an edit still waiting for its debounce.
    return () => {
      clearTimeout(timer.current)
      if (pending.current) void api.notes.save(projectId, pending.current)
    }
  }, [projectId])

  if (!data) return <div className="view">{error ? <div className="empty">{error}</div> : null}</div>

  const update = (next: Notes) => {
    setData(next)
    pending.current = next
    const r = ++rev.current
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      pending.current = null
      try {
        const saved = await api.notes.save(projectId, next)
        if (r === rev.current) setData(saved)
        setError('')
      } catch (e) {
        setError(`Not saved: ${(e as Error).message}`)
      }
    }, 300)
  }

  const patch = (id: string, p: Partial<Note>) =>
    update({ ...data, notes: data.notes.map((n) => (n.id === id ? { ...n, ...p, updatedAt: Date.now() } : n)) })

  const create = () => {
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', strokes: [], updatedAt: Date.now() }
    update({ ...data, notes: [note, ...data.notes] })
    setQuery('')
    setSelectedId(note.id)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const q = query.trim().toLowerCase()
  const list = data.notes
    .filter((n) => !q || `${n.title}\n${n.body}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const note = data.notes.find((n) => n.id === selectedId) ?? null
  const text = note ? [note.title.trim(), note.body].filter(Boolean).join('\n\n') : ''

  return (
    <div className="view">
      <div className="view-header">
        <h2>Notepad</h2>
        <span className="faint small mono">.vi3ecode/notes.json</span>
        <div className="spacer" />
        <span className="small notes-error" role="status">
          {error}
        </span>
        <button className="btn primary small" onClick={create}>
          New note
        </button>
      </div>
      <div className="split">
        <div className="list-pane col">
          <input
            className="input"
            type="search"
            placeholder="Search notes"
            aria-label="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="notes-list">
            {list.map((n) => (
              <button
                key={n.id}
                className={`list-item notes-item${n.id === selectedId ? ' active' : ''}`}
                aria-current={n.id === selectedId || undefined}
                onClick={() => setSelectedId(n.id)}
              >
                <span className="grow notes-item-title">{noteName(n)}</span>
                <span className="faint small">{relTime(n.updatedAt)}</span>
              </button>
            ))}
            {!list.length ? <div className="faint small notes-none">{q ? 'No matches' : 'No notes yet'}</div> : null}
          </div>
        </div>
        <div className="detail-pane">
          {note ? (
            <div className="notes-editor">
              <input
                ref={titleRef}
                className="input notes-title"
                placeholder="Title"
                aria-label="Note title"
                value={note.title}
                onChange={(e) => patch(note.id, { title: e.target.value })}
              />
              <textarea
                className="textarea notes-body"
                placeholder="Write anything: plans, snippets, prompts to reuse…"
                aria-label="Note text"
                value={note.body}
                onChange={(e) => patch(note.id, { body: e.target.value })}
              />
              <div className="row">
                <button className="btn small" disabled={!text} onClick={() => ctx.openChat(text)}>
                  Send to chat
                </button>
                <button className="btn small" disabled={!note.body} onClick={() => ctx.sendToTerminal(note.body)}>
                  Add to terminal
                </button>
                <div className="grow" />
                <span className="faint small">Saved automatically</span>
                <button
                  className="btn danger small"
                  onClick={() => {
                    if (!confirm(`Delete "${noteName(note)}"?`)) return
                    update({ ...data, notes: data.notes.filter((n) => n.id !== note.id) })
                    setSelectedId(null)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div>{data.notes.length ? 'Select a note' : 'No notes yet'}</div>
              <div className="small">Notes are saved to .vi3ecode/notes.json and travel with your commits.</div>
              <button className="btn small" onClick={create}>
                New note
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

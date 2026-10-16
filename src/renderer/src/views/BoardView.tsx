import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Kanban, KanbanCard } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import './board.css'

/** Moves a card to `toCol` at `toIndex` (index counted with the card still in place). */
function moveCard(board: Kanban, cardId: string, toCol: string, toIndex: number): Kanban {
  const columns = board.columns.map((c) => ({ ...c, cards: [...c.cards] }))
  let card: KanbanCard | undefined
  for (const c of columns) {
    const i = c.cards.findIndex((k) => k.id === cardId)
    if (i < 0) continue
    card = c.cards.splice(i, 1)[0]
    if (c.id === toCol && i < toIndex) toIndex--
  }
  const target = columns.find((c) => c.id === toCol)
  if (!card || !target) return board
  target.cards.splice(Math.max(0, Math.min(toIndex, target.cards.length)), 0, card)
  return { ...board, columns }
}

const cardText = (c: KanbanCard, sep: string) => [c.title, c.body].filter(Boolean).join(sep)

export function BoardView() {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [board, setBoard] = useState<Kanban | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ col: string; index: number } | null>(null)
  const dragId = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Kanban | null>(null)
  const rev = useRef(0)

  useEffect(() => {
    void api.board.get(projectId).then(setBoard, (e: Error) => setError(e.message))
    // Leaving the view must not drop an edit still waiting for its debounce.
    return () => {
      clearTimeout(timer.current)
      if (pending.current) void api.board.save(projectId, pending.current)
    }
  }, [projectId])

  const update = (next: Kanban) => {
    setBoard(next)
    pending.current = next
    const r = ++rev.current
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      pending.current = null
      try {
        const saved = await api.board.save(projectId, next)
        if (r === rev.current) setBoard(saved)
        setError('')
      } catch (e) {
        setError(`Not saved: ${(e as Error).message}`)
      }
    }, 300)
  }

  if (!board) return <div className="view">{error ? <div className="empty">{error}</div> : null}</div>

  const patchColumn = (colId: string, patch: Partial<Kanban['columns'][number]>) =>
    update({ ...board, columns: board.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) })

  const patchCard = (cardId: string, patch: Partial<KanbanCard>) =>
    update({
      ...board,
      columns: board.columns.map((c) => ({ ...c, cards: c.cards.map((k) => (k.id === cardId ? { ...k, ...patch } : k)) }))
    })

  const addCard = (colId: string, title: string) => {
    const card: KanbanCard = { id: crypto.randomUUID(), title, body: '', labels: [], createdAt: Date.now() }
    patchColumn(colId, { cards: [...board.columns.find((c) => c.id === colId)!.cards, card] })
  }

  const deleteCard = (cardId: string) => {
    update({ ...board, columns: board.columns.map((c) => ({ ...c, cards: c.cards.filter((k) => k.id !== cardId) })) })
    setOpenId(null)
  }

  const deleteColumn = (colId: string) => {
    const col = board.columns.find((c) => c.id === colId)!
    if (col.cards.length && !confirm(`Delete "${col.title}" and its ${col.cards.length} card(s)?`)) return
    update({ ...board, columns: board.columns.filter((c) => c.id !== colId) })
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>, colId: string) => {
    if (!dragId.current) return
    e.preventDefault()
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')]
    const i = cards.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    const index = i < 0 ? cards.length : i
    if (drop?.col !== colId || drop.index !== index) setDrop({ col: colId, index })
  }

  const onDrop = (e: DragEvent, colId: string) => {
    e.preventDefault()
    if (dragId.current && drop) update(moveCard(board, dragId.current, colId, drop.index))
    dragId.current = null
    setDrop(null)
  }

  // Keyboard alternative to dragging: Alt+↑/↓ reorders, Alt+←/→ moves between columns.
  const onCardKey = (e: KeyboardEvent, ci: number, ki: number, cardId: string) => {
    if (!e.altKey) return
    const moves: Record<string, [number, number]> = {
      ArrowUp: [ci, ki - 1],
      ArrowDown: [ci, ki + 2],
      ArrowLeft: [ci - 1, Infinity],
      ArrowRight: [ci + 1, Infinity]
    }
    const m = moves[e.key]
    const col = m && board.columns[m[0]]
    if (!col || m[1] < 0) return
    e.preventDefault()
    update(moveCard(board, cardId, col.id, m[1]))
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card="${cardId}"]`)?.focus())
  }

  const open = board.columns.flatMap((c) => c.cards).find((k) => k.id === openId) ?? null

  return (
    <div className="view">
      <div className="view-header">
        <h2>Task board</h2>
        <span className="faint small mono">.vi3ecode/kanban.json</span>
        <div className="spacer" />
        <span className="small board-status" role="status">
          {error}
        </span>
        <button
          className="btn small"
          onClick={() => update({ ...board, columns: [...board.columns, { id: crypto.randomUUID(), title: 'New column', cards: [] }] })}
        >
          + Add column
        </button>
      </div>
      <div className="board">
        {board.columns.map((col, ci) => (
          <section key={col.id} className="board-col" aria-label={col.title}>
            <div className="board-col-head">
              {/* Committed on blur: saving an empty title mid-edit would come back as "Untitled". */}
              <input
                key={col.title}
                className="input board-col-title"
                aria-label="Column name"
                defaultValue={col.title}
                onBlur={(e) => e.target.value !== col.title && patchColumn(col.id, { title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span className="badge">{col.cards.length}</span>
              <button className="btn ghost small" aria-label={`Delete column ${col.title}`} onClick={() => deleteColumn(col.id)}>
                ×
              </button>
            </div>
            <div
              className={`board-cards${drop?.col === col.id && drop.index === col.cards.length ? ' drop-end' : ''}`}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
              }}
              onDrop={(e) => onDrop(e, col.id)}
            >
              {col.cards.map((card, ki) => (
                <button
                  key={card.id}
                  data-card={card.id}
                  className={`board-card${drop?.col === col.id && drop.index === ki ? ' drop-before' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    dragId.current = card.id
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', card.title)
                  }}
                  onDragEnd={() => {
                    dragId.current = null
                    setDrop(null)
                  }}
                  onClick={() => setOpenId(card.id)}
                  onKeyDown={(e) => onCardKey(e, ci, ki, card.id)}
                  title="Drag, or Alt+arrow keys, to move"
                >
                  <span className="board-card-title">{card.title || 'Untitled'}</span>
                  {card.labels.length ? (
                    <span className="row board-labels">
                      {card.labels.map((l) => (
                        <span key={l} className="badge accent">
                          {l}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))}
              {adding === col.id ? (
                <input
                  className="input"
                  autoFocus
                  aria-label={`New card title in ${col.title}`}
                  placeholder="Card title, Enter to add"
                  onKeyDown={(e) => {
                    const title = e.currentTarget.value.trim()
                    if (e.key === 'Enter' && title) {
                      addCard(col.id, title)
                      e.currentTarget.value = ''
                    } else if (e.key === 'Escape') setAdding(null)
                  }}
                  onBlur={() => setAdding(null)}
                />
              ) : (
                <button className="btn ghost small board-add" onClick={() => setAdding(col.id)}>
                  + Add card
                </button>
              )}
            </div>
          </section>
        ))}
        {!board.columns.length ? <div className="empty grow">No columns. Add one to start.</div> : null}
      </div>
      {open ? (
        <CardDialog
          card={open}
          onChange={(patch) => patchCard(open.id, patch)}
          onClose={() => setOpenId(null)}
          onChat={() => ctx.openChat(cardText(open, '\n\n'))}
          onTerminal={() => ctx.sendToTerminal(cardText(open, '\n'))}
          onDelete={() => confirm(`Delete "${open.title || 'Untitled'}"?`) && deleteCard(open.id)}
        />
      ) : null}
    </div>
  )
}

function CardDialog(props: {
  card: KanbanCard
  onChange(patch: Partial<KanbanCard>): void
  onClose(): void
  onChat(): void
  onTerminal(): void
  onDelete(): void
}) {
  const { card } = props
  const ref = useRef<HTMLDialogElement>(null)
  // Raw text so a trailing comma survives while typing.
  const [labels, setLabels] = useState(card.labels.join(', '))

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="board-dialog" aria-label="Edit card" onClose={props.onClose}>
      <div className="col">
        <label className="field">
          Title
          <input className="input" value={card.title} onChange={(e) => props.onChange({ title: e.target.value })} />
        </label>
        <label className="field">
          Details
          <textarea
            className="textarea board-body"
            value={card.body}
            onChange={(e) => props.onChange({ body: e.target.value })}
          />
        </label>
        <label className="field">
          Labels (comma-separated)
          <input
            className="input"
            value={labels}
            onChange={(e) => {
              setLabels(e.target.value)
              props.onChange({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })
            }}
          />
        </label>
        <div className="row">
          <button className="btn primary small" onClick={props.onChat}>
            Open in chat
          </button>
          <button className="btn small" onClick={props.onTerminal}>
            Send to terminal
          </button>
          <div className="grow" />
          <button className="btn danger small" onClick={props.onDelete}>
            Delete
          </button>
          <button className="btn small" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  )
}

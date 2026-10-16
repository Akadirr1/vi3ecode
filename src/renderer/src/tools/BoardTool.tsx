import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { MessageSquarePlus, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import type { Agent, Kanban, KanbanCard } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { Avatar } from '../components/Avatar'
import './project-tools.css'

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

// Default columns keep their meaning colour; custom ones cycle through the palette.
const COL_COLOR: Record<string, string> = { backlog: '#94a3b8', todo: '#38bdf8', 'in-progress': '#fbbf24', doing: '#fbbf24', review: '#a78bfa', done: '#34d399' }
// vi3ecode stores colour names in kanban.json.
const NAMED: Record<string, string> = { slate: '#94a3b8', sky: '#38bdf8', amber: '#fbbf24', violet: '#a78bfa', rose: '#fb7185', emerald: '#34d399' }
const PALETTE = ['#94a3b8', '#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#fb7185']
const colColor = (id: string, i: number) => COL_COLOR[id] ?? PALETTE[i % PALETTE.length]

function Assignee({ id, agents }: { id?: string; agents: Agent[] }) {
  if (!id) return null
  const a = agents.find((x) => x.id === id)
  return (
    <span className="kb-assignee">
      {a ? <Avatar avatar={a.avatar} color={a.color} size={16} /> : null}
      <span>{a?.name ?? id}</span>
    </span>
  )
}

export function BoardTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [board, setBoard] = useState<Kanban | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
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
    void api.team.get(projectId).then((tm) => setAgents(tm.agents), () => setAgents([]))
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
        setError(t('Not saved: {error}', { error: (e as Error).message }))
      }
    }, 300)
  }

  if (!board) return error ? <div className="empty">{error}</div> : null

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
    if (col.cards.length && !confirm(t('Delete "{title}" and its {n} card(s)?', { title: col.title, n: col.cards.length }))) return
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

  const all = board.columns.flatMap((c) => c.cards)
  const open = all.find((k) => k.id === openId) ?? null
  const doneCol = board.columns.at(-1)
  const pct = all.length && doneCol ? Math.round((doneCol.cards.length / all.length) * 100) : 0

  return (
    <div className="pt">
      <div className="pt-bar">
        <span className="pt-path">.vi3ecode/kanban.json</span>
        <span className="micro">{t('{n}% done', { n: pct })}</span>
        <div className="grow" />
        <span className="pt-status" role="status">
          {error}
        </span>
        <button
          className="btn small"
          onClick={() => update({ ...board, columns: [...board.columns, { id: crypto.randomUUID(), title: t('New column'), cards: [] }] })}
        >
          <Plus size={13} />
          {t('Add column')}
        </button>
      </div>
      <div className={`kb-board${docked ? ' docked' : ''}`}>
        {board.columns.map((col, ci) => (
          <section key={col.id} className="kb-col" aria-label={col.title}>
            <div className="kb-col-head">
              <span className="dot" style={{ background: (col.color && (NAMED[col.color] ?? col.color)) || colColor(col.id, ci) }} aria-hidden />
              {/* Committed on blur: saving an empty title mid-edit would come back as "Untitled". */}
              <input
                key={col.title}
                className="kb-col-title"
                aria-label={t('Column name')}
                defaultValue={col.title}
                onBlur={(e) => e.target.value !== col.title && patchColumn(col.id, { title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span className="kb-count">{col.cards.length}</span>
              <button className="iconbtn kb-col-del" aria-label={t('Delete column {title}', { title: col.title })} title={t('Delete column')} onClick={() => deleteColumn(col.id)}>
                <X size={13} />
              </button>
            </div>
            <div
              className={`kb-cards${drop?.col === col.id && drop.index === col.cards.length ? ' drop-end' : ''}`}
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
                  className={`kb-card${drop?.col === col.id && drop.index === ki ? ' drop-before' : ''}`}
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
                  title={t('Drag, or Alt+arrow keys, to move')}
                >
                  <span className="kb-card-title">{card.title || t('Untitled')}</span>
                  {card.body ? <span className="kb-card-body">{card.body}</span> : null}
                  {card.labels.length || card.assignee ? (
                    <span className="kb-card-meta">
                      {card.labels.map((l) => (
                        <span key={l} className="badge">
                          {l}
                        </span>
                      ))}
                      <span className="grow" />
                      <Assignee id={card.assignee} agents={agents} />
                    </span>
                  ) : null}
                </button>
              ))}
              {adding === col.id ? (
                <input
                  className="input"
                  autoFocus
                  aria-label={t('New card title in {title}', { title: col.title })}
                  placeholder={t('Card title, Enter to add')}
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
                <button className="btn ghost small kb-add" onClick={() => setAdding(col.id)}>
                  <Plus size={13} />
                  {t('Add card')}
                </button>
              )}
            </div>
          </section>
        ))}
        {!board.columns.length ? <div className="empty grow">{t('No columns. Add one to start.')}</div> : null}
      </div>
      {open ? (
        <CardDialog
          card={open}
          column={board.columns.find((c) => c.cards.some((k) => k.id === open.id))?.title ?? ''}
          agents={agents}
          onChange={(patch) => patchCard(open.id, patch)}
          onClose={() => setOpenId(null)}
          onChat={() => ctx.openChat(cardText(open, '\n\n'))}
          onTerminal={() => ctx.sendToTerminal(cardText(open, '\n'))}
          onDelete={() => confirm(t('Delete "{title}"?', { title: open.title || t('Untitled') })) && deleteCard(open.id)}
        />
      ) : null}
    </div>
  )
}

function CardDialog(props: {
  card: KanbanCard
  column: string
  agents: Agent[]
  onChange(patch: Partial<KanbanCard>): void
  onClose(): void
  onChat(): void
  onTerminal(): void
  onDelete(): void
}) {
  const { card, agents } = props
  const ref = useRef<HTMLDialogElement>(null)
  // Raw text so a trailing comma survives while typing.
  const [labels, setLabels] = useState(card.labels.join(', '))
  const assignee = agents.find((a) => a.id === card.assignee)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="kb-dialog" aria-label={t('Edit card')} onClose={props.onClose}>
      <div className="kb-dialog-head">
        <span className="micro">{t('Card')}</span>
        <span className="pt-path">{props.column}</span>
        <div className="grow" />
        <button className="iconbtn" aria-label={t('Close')} onClick={() => ref.current?.close()}>
          <X size={15} />
        </button>
      </div>
      <div className="col kb-dialog-body">
        <label className="field">
          <span className="micro">{t('Title')}</span>
          <input className="input" value={card.title} onChange={(e) => props.onChange({ title: e.target.value })} />
        </label>
        <label className="field">
          <span className="micro">{t('Details')}</span>
          <textarea className="textarea kb-dialog-text" value={card.body} onChange={(e) => props.onChange({ body: e.target.value })} />
        </label>
        <div className="row kb-dialog-row">
          <label className="field grow">
            <span className="micro">{t('Assignee')}</span>
            <span className="row">
              {assignee ? <Avatar avatar={assignee.avatar} color={assignee.color} size={24} /> : null}
              <select
                className="select"
                value={card.assignee ?? ''}
                onChange={(e) => props.onChange({ assignee: e.target.value || undefined })}
              >
                <option value="">{t('Unassigned')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
                {card.assignee && !assignee ? <option value={card.assignee}>{card.assignee}</option> : null}
              </select>
            </span>
          </label>
          <label className="field grow">
            <span className="micro">{t('Labels (comma-separated)')}</span>
            <input
              className="input"
              value={labels}
              onChange={(e) => {
                setLabels(e.target.value)
                props.onChange({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })
              }}
            />
          </label>
        </div>
      </div>
      <div className="kb-dialog-foot">
        <button className="btn primary small" onClick={props.onChat}>
          <MessageSquarePlus size={13} />
          {t('Open in chat')}
        </button>
        <button className="btn small" onClick={props.onTerminal}>
          <SquareTerminal size={13} />
          {t('Send to terminal')}
        </button>
        <div className="grow" />
        <button className="btn danger small" onClick={props.onDelete}>
          <Trash2 size={13} />
          {t('Delete')}
        </button>
      </div>
    </dialog>
  )
}

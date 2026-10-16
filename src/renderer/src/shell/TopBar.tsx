import { FolderGit2, PanelRight, Plus, X } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { t } from '../i18n'

export function TopBar(props: {
  tabs: Project[]
  activeId: string | null
  dockOpen: boolean
  onSelect(id: string): void
  onClose(id: string): void
  onAdd(): void
  onToggleDock(): void
}) {
  return (
    <header className="tabbar">
      <button className="logo-btn" title="vi3ecode" aria-label="vi3ecode">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6l5 12 5-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 6h5l-3 4a3.5 3.5 0 1 1-3 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="row" role="tablist" aria-label={t('Projects')} style={{ gap: 2, alignItems: 'stretch' }}>
        {props.tabs.map((p) => (
          <div
            key={p.id}
            role="tab"
            tabIndex={0}
            aria-selected={p.id === props.activeId}
            className={`ptab${p.id === props.activeId ? ' active' : ''}`}
            onClick={() => props.onSelect(p.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onSelect(p.id)}
            title={p.path}
          >
            <FolderGit2 size={14} aria-hidden />
            <span className="ptab-name">{p.name}</span>
            <button
              className="ptab-x"
              aria-label={t('Close {name}', { name: p.name })}
              onClick={(e) => {
                e.stopPropagation()
                props.onClose(p.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="ptab-add" onClick={props.onAdd} title={t('Open folder')} aria-label={t('Open folder')}>
        <Plus size={16} />
      </button>
      <div className="spacer" />
      <button className={`iconbtn${props.dockOpen ? ' active' : ''}`} style={{ alignSelf: 'center' }} onClick={props.onToggleDock} title={t('Side panel')} aria-label={t('Side panel')}>
        <PanelRight size={16} />
      </button>
    </header>
  )
}

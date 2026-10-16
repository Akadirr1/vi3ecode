import { LayoutGrid, X } from 'lucide-react'
import { useEffect } from 'react'
import { useApp, type Tool } from '../context'
import { TOOL_META } from './Rail'
import { t } from '../i18n'

const GROUPS: { title: string; tools: Tool[] }[] = [
  { title: 'Create and run', tools: ['flow', 'skills', 'plugins'] },
  { title: 'Project context', tools: ['board', 'notes', 'memory', 'explorer', 'git'] },
  { title: 'Look around', tools: ['browser', 'activity'] }
]

export function ToolsModal({ onClose }: { onClose(): void }) {
  const { openTool } = useApp()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t('Tools')}>
        <div className="modal-head">
          <span className="engine-ico">
            <LayoutGrid size={15} />
          </span>
          <div className="grow">
            <h3>{t('Tools')}</h3>
            <div className="muted small">{t('Reach build flows, project context and extensions from one place.')}</div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body col" style={{ gap: 16 }}>
          {GROUPS.map((g) => (
            <div key={g.title} className="col">
              <div className="micro">{t(g.title)}</div>
              <div className="tools-grid">
                {g.tools.map((tool) => {
                  const { icon: Icon, label, hint } = TOOL_META[tool]
                  return (
                    <button
                      key={tool}
                      className="tool-card"
                      onClick={() => {
                        openTool(tool)
                        onClose()
                      }}
                    >
                      <span className="engine-ico">
                        <Icon size={15} />
                      </span>
                      <span className="col" style={{ gap: 2 }}>
                        <strong>{t(label)}</strong>
                        <span className="muted small">{t(hint)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

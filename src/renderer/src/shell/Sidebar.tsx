import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, MoreVertical, Settings as Gear, SquareTerminal, Users } from 'lucide-react'
import { useApp, type Mode } from '../context'
import { EngineIcon } from '../components/EngineIcon'
import { t } from '../i18n'

const MODES: { mode: Mode; label: string; icon: typeof MessageSquare }[] = [
  { mode: 'chat', label: 'Chat Mode', icon: MessageSquare },
  { mode: 'terminal', label: 'Terminal Mode', icon: SquareTerminal },
  { mode: 'agent', label: 'Agent Mode', icon: Users }
]

/** Left column: mode switcher, the mode's own section, engines and the local account row. */
export function Sidebar({ children }: { children: ReactNode }) {
  const { mode, setMode, engines, openSettings } = useApp()
  const [enginesOpen, setEnginesOpen] = useState(false)
  const visible = engines.filter((e) => e.enabled)
  const installed = visible.filter((e) => e.installed)
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="modes" role="tablist" aria-label={t('Mode')}>
          {MODES.map(({ mode: m, label, icon: Icon }) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`mode-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
              <Icon size={14} aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
        {children}
      </div>
      <div className="sidebar-foot">
        <button className="engines-toggle micro" onClick={() => setEnginesOpen(!enginesOpen)} aria-expanded={enginesOpen}>
          {enginesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('Engines')}
          <span style={{ marginLeft: 'auto' }}>{installed.length}</span>
        </button>
        {enginesOpen ? (
          <div className="engines-list">
            {visible.map((e) => (
              <div key={e.id} className="engine-row" title={e.installed ? `${e.bin} ${e.version ?? ''}` : e.installHint}>
                <EngineIcon engine={e.id} size={13} />
                <span className="engine-name">{e.label}</span>
                {e.usage?.status ? <span className={`badge ${e.usage.status === 'allowed' ? 'ok' : 'warn'}`}>{e.usage.window?.replace('_', ' ') ?? e.usage.status}</span> : null}
                {!e.installed ? <span className="faint small">{t('not found')}</span> : !e.headless ? <span className="badge">{t('terminal')}</span> : null}
                <span className={`dot ${e.installed ? 'on' : 'off'}`} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="account">
          <span className="account-avatar">L</span>
          <span className="grow small">{t('Local workspace')}</span>
          <button className="iconbtn" onClick={openSettings} title={t('Settings')} aria-label={t('Settings')}>
            <Gear size={15} />
          </button>
          <button className="iconbtn" onClick={openSettings} title={t('More')} aria-label={t('More')}>
            <MoreVertical size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

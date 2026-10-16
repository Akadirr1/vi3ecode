import { useEffect } from 'react'
import { X } from 'lucide-react'
import { SettingsView } from '../views/SettingsView'
import { t } from '../i18n'

export function SettingsModal({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('Settings')} style={{ height: '100%' }}>
        <div className="modal-head">
          <h3 className="grow">{t('Settings')}</h3>
          <button className="iconbtn" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
          <SettingsView />
        </div>
      </div>
    </div>
  )
}

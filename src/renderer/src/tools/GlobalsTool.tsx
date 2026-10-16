import { useEffect, useState } from 'react'
import { Download, Save, Trash2 } from 'lucide-react'
import type { GlobalTeam } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { Avatar } from '../components/Avatar'
import { relativeTime } from '../components/format'
import { t } from '../i18n'
import { setTeam } from '../modes/agent/store'

/** Global agents: save this project's team to the app library, or put a saved team on this project. */
export function GlobalsTool(_: { docked: boolean }) {
  const { project, setMode } = useApp()
  const [list, setList] = useState<GlobalTeam[]>([])
  const [name, setName] = useState(project.name)
  const [note, setNote] = useState('')

  useEffect(() => void api.team.globals().then(setList), [])

  const save = async () => {
    setList(await api.team.saveGlobal(project.id, name))
    setNote(t('Saved to the library.'))
  }
  const use = async (g: GlobalTeam) => {
    if (!confirm(t('Replace the team of {project} with "{name}"? Who-hands-off-to-whom is reset.', { project: project.name, name: g.name }))) return
    setTeam(project.id, await api.team.useGlobal(project.id, g.id)) // the agent store caches the team; a stale copy would be saved over this one
    setNote(t('"{name}" is now this project\'s team.', { name: g.name }))
    setMode('agent')
  }
  const remove = async (g: GlobalTeam) => {
    if (confirm(t('Remove "{name}" from the library?', { name: g.name }))) setList(await api.team.removeGlobal(g.id))
  }

  return (
    <div className="view-body col" style={{ gap: 16 }}>
      <div className="card col">
        <div className="micro">{t('Save this project team')}</div>
        <div className="row">
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Library name')} />
          <button className="btn" onClick={save}>
            <Save size={14} /> {t('Save')}
          </button>
        </div>
        <div className="faint small">{t('Kept in the app, not in the repository. Handoff rules stay with each project team.')}</div>
      </div>
      {note ? (
        <div className="small muted" aria-live="polite">
          {note}
        </div>
      ) : null}
      <div className="micro">{t('Library')}</div>
      {list.length === 0 ? <div className="empty">{t('No saved teams yet.')}</div> : null}
      {list.map((g) => (
        <div key={g.id} className="card col" style={{ gap: 10 }}>
          <div className="row">
            <strong className="grow">{g.name}</strong>
            <span className="faint small mono">{relativeTime(g.savedAt)}</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {g.team.agents.map((a) => (
              <span key={a.id} className="chip" title={a.role}>
                <Avatar avatar={a.avatar} color={a.color} size={16} />
                {a.name}
              </span>
            ))}
          </div>
          <div className="row">
            <button className="btn small" onClick={() => use(g)}>
              <Download size={13} /> {t('Use for this project')}
            </button>
            <div className="grow" />
            <button className="iconbtn" onClick={() => remove(g)} aria-label={t('Remove {name}', { name: g.name })}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

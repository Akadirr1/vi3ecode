import { useState } from 'react'
import { Brain, ChevronDown, FolderOpen, GitBranch, Play, SquareKanban, SquareTerminal, StickyNote, type LucideIcon } from 'lucide-react'
import { useApp, type Tool } from '../../context'
import { EngineIcon } from '../../components/EngineIcon'
import { t } from '../../i18n'
import { focusPane, usePanes } from './store'
import './terminal-mode.css'

/** Terminal Mode's "Workspace" group: project tools, the open panes (Processes) and the pane grid itself. */
export function TerminalSidebar() {
  const { project, tool, openTool } = useApp()
  const { panes, focused } = usePanes(project.id)
  const [open, setOpen] = useState(true)
  const [procsOpen, setProcsOpen] = useState(false)

  const showPane = (id: string | null) => {
    openTool(null)
    if (id) focusPane(project.id, id)
  }
  const item = (id: Tool, label: string, Icon: LucideIcon) => (
    <button className={`side-action ts-item${tool === id ? ' active' : ''}`} aria-current={tool === id ? 'page' : undefined} onClick={() => openTool(id)}>
      <Icon size={15} aria-hidden />
      {t(label)}
    </button>
  )

  return (
    <div className="ts">
      <button className="ts-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('Workspace')}
        <ChevronDown size={15} className={open ? '' : 'ts-closed'} aria-hidden />
      </button>
      {open ? (
        <>
          {item('explorer', 'Explorer', FolderOpen)}
          <button className="side-action ts-item" aria-expanded={procsOpen} onClick={() => setProcsOpen(!procsOpen)}>
            <Play size={15} aria-hidden />
            {t('Processes')}
            <span className="meta mono">{panes.length}</span>
          </button>
          {procsOpen ? (
            <div className="ts-procs">
              {panes.map((p) => {
                const status = p.exitCode !== undefined ? 'exited' : p.busy ? 'busy' : 'ready'
                return (
                  <button
                    key={p.info.id}
                    className={`side-action ts-proc${!tool && p.info.id === focused ? ' active' : ''}`}
                    aria-label={`${p.info.title}, ${t(status)}`}
                    onClick={() => showPane(p.info.id)}
                  >
                    <EngineIcon engine={p.info.engine} size={13} />
                    <span className="grow ts-proc-name">{p.info.title}</span>
                    {p.info.model ? <span className="faint mono ts-proc-model">{p.info.model.replace(/^claude-/, '')}</span> : null}
                    <span className={`dot ${status === 'exited' ? 'off' : status === 'busy' ? 'busy' : 'on'}`} aria-hidden />
                  </button>
                )
              })}
              {!panes.length ? <div className="faint small ts-none">{t('No panes running')}</div> : null}
            </div>
          ) : null}
          <button className={`side-action ts-item${!tool ? ' active' : ''}`} aria-current={!tool ? 'page' : undefined} onClick={() => showPane(focused)}>
            <SquareTerminal size={15} aria-hidden />
            {t('Terminal')}
          </button>
          {item('git', 'Git', GitBranch)}
          {item('board', 'Kanban', SquareKanban)}
          {item('notes', 'Notepad', StickyNote)}
          {item('memory', 'Memory', Brain)}
        </>
      ) : null}
    </div>
  )
}

import { Maximize2, PanelRightClose, X } from 'lucide-react'
import { useApp, type Tool } from '../context'
import { TOOL_META } from './Rail'
import { t } from '../i18n'
import { ExplorerTool } from '../tools/ExplorerTool'
import { BrowserTool } from '../tools/BrowserTool'
import { GitTool } from '../tools/GitTool'
import { BoardTool } from '../tools/BoardTool'
import { NotesTool } from '../tools/NotesTool'
import { MemoryTool } from '../tools/MemoryTool'
import { FlowTool } from '../tools/FlowTool'
import { SkillsTool } from '../tools/SkillsTool'
import { PluginsTool } from '../tools/PluginsTool'
import { ActivityTool } from '../tools/ActivityTool'
import { GlobalsTool } from '../tools/GlobalsTool'

const COMPONENTS: Record<Tool, (p: { docked: boolean }) => React.ReactNode> = {
  explorer: ExplorerTool,
  browser: BrowserTool,
  git: GitTool,
  board: BoardTool,
  notes: NotesTool,
  memory: MemoryTool,
  flow: FlowTool,
  skills: SkillsTool,
  plugins: PluginsTool,
  activity: ActivityTool,
  globals: GlobalsTool
}

/** A tool with its header, either full-size in the main area or docked on the right. */
export function ToolView({ tool, docked }: { tool: Tool; docked: boolean }) {
  const { openTool, setDock } = useApp()
  const { label, icon: Icon } = TOOL_META[tool]
  const Body = COMPONENTS[tool]
  return (
    <section className="view tool-view" aria-label={t(label)}>
      <div className="view-header tool-header">
        <Icon size={15} aria-hidden />
        <h2>{t(label)}</h2>
        <div className="spacer" />
        {docked ? (
          <>
            <button className="iconbtn" onClick={() => (setDock(null), openTool(tool))} title={t('Open in main area')} aria-label={t('Open in main area')}>
              <Maximize2 size={14} />
            </button>
            <button className="iconbtn" onClick={() => setDock(null)} title={t('Close panel')} aria-label={t('Close panel')}>
              <PanelRightClose size={15} />
            </button>
          </>
        ) : (
          <button className="iconbtn" onClick={() => openTool(null)} title={t('Close')} aria-label={t('Close')}>
            <X size={15} />
          </button>
        )}
      </div>
      <div className="tool-body">
        <Body docked={docked} />
      </div>
    </section>
  )
}

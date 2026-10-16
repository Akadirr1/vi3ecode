import { Activity, Blocks, BookOpenText, FolderOpen, Globe, GitBranch, KanbanSquare, Library, NotebookPen, Waypoints, type LucideIcon } from 'lucide-react'
import { useApp, type Tool } from '../context'
import { t } from '../i18n'

export const TOOL_META: Record<Tool, { label: string; icon: LucideIcon; hint: string }> = {
  explorer: { label: 'Explorer', icon: FolderOpen, hint: 'Browse and preview project files' },
  browser: { label: 'Browser', icon: Globe, hint: 'A browser beside the conversation; capture the page into a message' },
  git: { label: 'Git', icon: GitBranch, hint: 'Status, diffs, staging and commits' },
  board: { label: 'Kanban', icon: KanbanSquare, hint: 'Task board in .vi3ecode/kanban.json' },
  notes: { label: 'Notepad', icon: NotebookPen, hint: 'Notes and sketches beside the code' },
  memory: { label: 'Memory', icon: Library, hint: 'Project memory vault in .vi3ecode/memory' },
  flow: { label: 'Flow', icon: Waypoints, hint: 'Goals, tasks, reviews and human gates in one run' },
  skills: { label: 'Skills', icon: BookOpenText, hint: 'Portable instruction packs for every engine' },
  plugins: { label: 'Plugins', icon: Blocks, hint: 'Extensions with declared permissions' },
  activity: { label: 'Activity', icon: Activity, hint: 'What ran and how it turned out' }
}

const RAIL: Tool[] = ['explorer', 'browser', 'git', 'board', 'notes', 'memory', 'flow', 'plugins', 'activity']

/** Right-hand tool rail: toggles a tool in the dock beside the conversation. */
export function Rail() {
  const { dock, setDock } = useApp()
  return (
    <nav className="rail" aria-label={t('Tools')}>
      {RAIL.map((tool) => {
        const { icon: Icon, label } = TOOL_META[tool]
        return (
          <button
            key={tool}
            className={`iconbtn${dock === tool ? ' active' : ''}`}
            onClick={() => setDock(dock === tool ? null : tool)}
            title={t(label)}
            aria-label={t(label)}
            aria-pressed={dock === tool}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </nav>
  )
}

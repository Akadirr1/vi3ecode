import { Bot, Code2, Command, Ghost, Hexagon, Moon, MousePointer2, Orbit, Sparkle, Sparkles, SquareTerminal, Zap, type LucideIcon } from 'lucide-react'
import type { EngineId } from '../../../shared/types'

const ICONS: Record<EngineId, [LucideIcon, string]> = {
  claude: [Sparkle, '#e8875b'],
  codex: [Hexagon, '#d4d4d4'],
  gemini: [Sparkles, '#7aa2f7'],
  opencode: [Code2, '#a3e635'],
  cursor: [MousePointer2, '#d4d4d4'],
  kimi: [Moon, '#93c5fd'],
  grok: [Zap, '#e5e5e5'],
  kiro: [Ghost, '#c4b5fd'],
  cline: [Bot, '#5eead4'],
  command: [Command, '#fca5a5'],
  antigravity: [Orbit, '#60a5fa']
}

/** Small engine mark; `engine` undefined draws a plain shell icon. */
export function EngineIcon({ engine, size = 14 }: { engine?: EngineId; size?: number }) {
  if (!engine) return <SquareTerminal size={size} aria-hidden />
  const [Icon, color] = ICONS[engine]
  return <Icon size={size} color={color} aria-hidden />
}

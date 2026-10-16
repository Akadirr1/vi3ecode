// MCP servers handed to engines for a turn: active plugins plus the app's own browser server.
import { mcpConfigFor } from './plugins'
import { BROWSER_SERVER, browserMcpServer } from './browserBridge'

/** JSON for `claude --mcp-config`, or undefined when there is nothing to add. */
export function mcpConfigJson(projectId: string): string | undefined {
  const plugins = mcpConfigFor(projectId)
  const servers: Record<string, unknown> = plugins ? ((JSON.parse(plugins) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {}) : {}
  const browser = browserMcpServer()
  if (browser) servers[BROWSER_SERVER] = browser
  return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : undefined
}

import type { PluginInfo } from '../shared/types'

// STUB — replaced by the plugin catalog.
export const pluginsApi = {
  async list(_projectId: string): Promise<PluginInfo[]> {
    return []
  },
  async setActive(_projectId: string, _id: string, _active: boolean): Promise<PluginInfo[]> {
    return []
  }
}

/** JSON for `claude --mcp-config` with the project's active plugin servers, or undefined. */
export function mcpConfigFor(_projectId: string): string | undefined {
  return undefined
}

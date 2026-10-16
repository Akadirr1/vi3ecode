// Built-in plugin catalog (no network). A plugin = a stdio MCP server handed to engines while active.
// Activation lives in <project>/.vi3ecode/plugins.json so it travels with the repo, but a plugin only
// runs once someone confirmed it on this machine: a cloned repo cannot start servers on its own.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PluginInfo } from '../shared/types'
import { getProject, userDir } from './store'
import { readJson, writeJson } from './fsutil'
import { findOnPath } from './engines'
import { dataDir } from './project'

type CatalogEntry = Omit<PluginInfo, 'active'>

/** `{project}` in args is replaced with the project folder. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'rea',
    name: 'REA — Reverse Engineer Anything',
    description:
      'Reverse engineer binaries, packaged apps, firmware and web bundles: inspect, decompile and explain shipped artifacts through 200+ analysis tools.',
    homepage: 'https://github.com/morluto/rea',
    permissions: ['run-commands', 'read-project', 'network'],
    mcp: { command: 'npx', args: ['-y', 'rea-agents@6.5.0', '--mcp'] }
  },
  {
    id: 'playwright',
    name: 'Playwright browser',
    description: 'A real browser the engines can drive: open pages, click, fill forms, read the page and take screenshots of the app you are building.',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    permissions: ['run-commands', 'network'],
    mcp: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] }
  },
  {
    id: 'context7',
    name: 'Context7 docs',
    description: 'Up-to-date library documentation and code examples, fetched on demand so answers match the versions you use.',
    homepage: 'https://github.com/upstash/context7',
    permissions: ['network'],
    mcp: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, search and write files inside this project folder through a dedicated file server.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    permissions: ['read-project', 'write-project'],
    mcp: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{project}'] }
  }
]

const KNOWN = new Set(CATALOG.map((p) => p.id))

/** Validated ids from plugins.json: known, unique, in catalog order. */
export function parseActive(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { active?: unknown }).active) ? (raw as { active: unknown[] }).active : []
  return CATALOG.map((p) => p.id).filter((id) => list.includes(id))
}

export type McpServers = Record<string, { command: string; args: string[] }>

/**
 * Engines start MCP servers without a shell, and on Windows `npx` is usually npx.cmd. Going through cmd.exe would
 * look for npx in the project folder first and re-parse the arguments, so run npm's npx-cli.js with node instead.
 */
function windowsNpx(args: string[]): { command: string; args: string[] } {
  const npx = findOnPath('npx')
  if (npx && /\.exe$/i.test(npx)) return { command: npx, args } // Volta and similar ship a real executable
  const node = findOnPath('node')
  const cli = node ? join(dirname(node), 'node_modules', 'npm', 'bin', 'npx-cli.js') : ''
  if (node && existsSync(cli)) return { command: node, args: [cli, ...args] }
  return { command: join(dirname(process.execPath), 'not-on-path', 'npx'), args } // fails visibly as a missing server
}

const resolveMcp = (p: CatalogEntry, projectPath: string) => {
  if (!p.mcp) return undefined
  const args = p.mcp.args.map((a) => (a === '{project}' ? projectPath : a))
  return process.platform === 'win32' && p.mcp.command === 'npx' ? windowsNpx(args) : { command: p.mcp.command, args }
}

/** Server entries for the given plugin ids; named vi3ecode-<id> so they never clash with the user's own servers. */
export function serversFor(ids: string[], projectPath: string): McpServers {
  const out: McpServers = {}
  for (const p of CATALOG) {
    const mcp = ids.includes(p.id) && resolveMcp(p, projectPath)
    if (mcp) out[`vi3ecode-${p.id}`] = mcp
  }
  return out
}

/** Codex `-c key=value` overrides; JSON strings and string arrays are valid TOML values. */
export function codexOverrides(servers: McpServers): string[] {
  return Object.entries(servers).flatMap(([name, s]) => [
    '-c',
    `mcp_servers.${name}.command=${JSON.stringify(s.command)}`,
    '-c',
    `mcp_servers.${name}.args=${JSON.stringify(s.args)}`
  ])
}

const stateFile = (path: string) => join(path, '.vi3ecode', 'plugins.json')
const consentFile = () => userDir('plugin-consent.json')
const consentKey = (path: string, id: string) => `${path}\n${id}`

function consented(): Set<string> {
  const raw = readJson<unknown>(consentFile(), [])
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
}

/** Active = listed in the project file and confirmed on this machine. */
function activeIds(projectPath: string): string[] {
  const ok = consented()
  return parseActive(readJson(stateFile(projectPath), null)).filter((id) => ok.has(consentKey(projectPath, id)))
}

function list(projectPath: string): PluginInfo[] {
  const active = activeIds(projectPath)
  return CATALOG.map((p) => ({ ...p, mcp: resolveMcp(p, projectPath), active: active.includes(p.id) }))
}

export const pluginsApi = {
  async list(projectId: string): Promise<PluginInfo[]> {
    return list(getProject(projectId).path)
  },
  async setActive(projectId: string, id: string, active: boolean): Promise<PluginInfo[]> {
    if (!KNOWN.has(id)) throw new Error(`Unknown plugin: ${id}`)
    const path = getProject(projectId).path
    const ids = new Set(parseActive(readJson(stateFile(path), null)))
    const ok = consented()
    if (active) {
      ids.add(id)
      ok.add(consentKey(path, id))
    } else {
      ids.delete(id)
      ok.delete(consentKey(path, id))
    }
    writeJson(dataDir(projectId, 'plugins.json'), { version: 1, active: CATALOG.map((p) => p.id).filter((x) => ids.has(x)) })
    writeJson(consentFile(), [...ok])
    return list(path)
  }
}

function activeServers(projectId: string): McpServers {
  try {
    const path = getProject(projectId).path
    return serversFor(activeIds(path), path)
  } catch {
    return {} // an unknown project must never break a chat turn
  }
}

/** JSON for `claude --mcp-config` with the project's active plugin servers, or undefined. */
export function mcpConfigFor(projectId: string): string | undefined {
  const servers = activeServers(projectId)
  return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : undefined
}

/** `codex exec` arguments for the active plugin servers (turns get them through mcpConfig → codexMcpOverrides). */
export function codexMcpArgs(projectId: string): string[] {
  return codexOverrides(activeServers(projectId))
}

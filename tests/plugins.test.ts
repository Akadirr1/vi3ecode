import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'vi3e-plugins-'))
const project = join(root, 'proj')
mkdirSync(project)
vi.mock('../src/main/store', () => ({
  getProject: (id: string) => {
    if (id !== 'p1') throw new Error('Unknown project')
    return { id, name: 'p', path: project, addedAt: 0 }
  },
  userDir: (...p: string[]) => join(root, 'user', ...p)
}))
const { parseActive, serversFor, codexOverrides, pluginsApi, mcpConfigFor, codexMcpArgs } = await import('../src/main/plugins')

describe('plugin state and server config', () => {
  it('keeps only known, unique ids in catalog order', () => {
    expect(parseActive({ version: 1, active: ['filesystem', 'bogus', 'rea', 'rea', 3] })).toEqual(['rea', 'filesystem'])
    expect(parseActive(null)).toEqual([])
    expect(parseActive({ active: 'rea' })).toEqual([])
  })
  it('names servers vi3ecode-<id> and fills in the project path', () => {
    const s = serversFor(['filesystem', 'rea'], '/p/x')
    expect(Object.keys(s)).toEqual(['vi3ecode-rea', 'vi3ecode-filesystem'])
    expect(s['vi3ecode-filesystem'].args.at(-1)).toBe('/p/x')
    expect(s['vi3ecode-rea']).toEqual({ command: 'npx', args: ['-y', 'rea-agents@6.5.0', '--mcp'] })
  })
  it('writes codex -c overrides as TOML values', () => {
    expect(codexOverrides(serversFor(['filesystem'], 'C:\\a "b"'))).toEqual([
      '-c',
      'mcp_servers.vi3ecode-filesystem.command="npx"',
      '-c',
      'mcp_servers.vi3ecode-filesystem.args=["-y","@modelcontextprotocol/server-filesystem","C:\\\\a \\"b\\""]'
    ])
  })
})

describe('activation', () => {
  it('a repo file alone does not activate anything; confirming on this machine does', async () => {
    mkdirSync(join(project, '.vi3ecode'), { recursive: true })
    writeFileSync(join(project, '.vi3ecode', 'plugins.json'), JSON.stringify({ version: 1, active: ['rea'] }))
    expect((await pluginsApi.list('p1')).filter((p) => p.active)).toEqual([])
    expect(mcpConfigFor('p1')).toBeUndefined()

    const list = await pluginsApi.setActive('p1', 'context7', true)
    expect(list.filter((p) => p.active).map((p) => p.id)).toEqual(['context7'])
    expect(JSON.parse(readFileSync(join(project, '.vi3ecode', 'plugins.json'), 'utf8'))).toEqual({ version: 1, active: ['rea', 'context7'] })
    expect(JSON.parse(mcpConfigFor('p1')!)).toEqual({ mcpServers: { 'vi3ecode-context7': { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } })
    expect(codexMcpArgs('p1')).toHaveLength(4)

    await pluginsApi.setActive('p1', 'context7', false)
    expect(mcpConfigFor('p1')).toBeUndefined()
  })
  it('rejects unknown plugins and never throws for unknown projects', async () => {
    await expect(pluginsApi.setActive('p1', '../x', true)).rejects.toThrow()
    expect(mcpConfigFor('nope')).toBeUndefined()
  })
})

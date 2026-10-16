// Browser panel captures: the renderer sends a PNG data URL, we store it in the project so any engine can read it by path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dataDir } from './project'

export const browserApi = {
  async saveCapture(projectId: string, dataUrl: string): Promise<string> {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''))
    if (!m) throw new Error('Not a PNG capture')
    const buf = Buffer.from(m[1], 'base64')
    if (buf.length > 15 * 1024 * 1024) throw new Error('Capture too large')
    const name = `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    mkdirSync(dataDir(projectId, 'captures'), { recursive: true })
    writeFileSync(dataDir(projectId, 'captures', name), buf)
    return `.vi3ecode/captures/${name}`
  }
}

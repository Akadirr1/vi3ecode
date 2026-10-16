// One-shot read-only engine call: Ask AI in notes, commit message suggestions.
import type { EngineId } from '../shared/types'
import { getProject, getSettings } from './store'
import { getAdapter } from './engines'
import { runTurn } from './runner'

export const aiApi = {
  async ask(projectId: string, prompt: string, engine?: EngineId): Promise<string> {
    const text = String(prompt ?? '').trim()
    if (!text) throw new Error('Nothing to ask.')
    const adapter = getAdapter(engine ?? getSettings().defaultEngine)
    if (!adapter.build) throw new Error(`${adapter.label} runs in the terminal only.`)
    const r = await runTurn(adapter, getProject(projectId).path, { prompt: text.slice(0, 100_000), approval: 'read-only' }).done
    if (r.error) throw new Error(r.error)
    return r.text
  }
}

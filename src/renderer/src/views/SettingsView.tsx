import { useState } from 'react'
import type { ApprovalMode, EngineId, Settings } from '../../../shared/types'
import { useApp } from '../context'
import './settings.css'

const APPROVAL: { mode: ApprovalMode; label: string; help: string }[] = [
  { mode: 'read-only', label: 'Read-only', help: 'Reads and answers. Never writes.' },
  { mode: 'ask', label: 'Ask', help: 'Every action that needs permission waits for your approval in the app.' },
  { mode: 'edits', label: 'Edits', help: 'File edits are approved automatically; other actions ask.' },
  { mode: 'full', label: 'Full', help: "The engine's own bypass mode: no prompts, no sandbox. Use on a throwaway branch." }
]

// How read-only / edits / full reach each engine; mirrors src/main/engines/*.
const MAPPING: [string, string, string, string][] = [
  ['Claude Code', '--permission-mode dontAsk, edit tools removed', '--permission-mode acceptEdits', '--permission-mode bypassPermissions'],
  ['Codex', '-s read-only', '-s workspace-write', '--dangerously-bypass-approvals-and-sandbox'],
  ['Gemini CLI', '--approval-mode plan', '--approval-mode auto_edit', '--approval-mode yolo'],
  ['opencode', 'plan agent', 'default agent', '--auto'],
  ['Cursor', 'instruction only', 'default', '--force']
]

export function SettingsView() {
  const ctx = useApp()
  const { settings: s, setSettings, engines, project } = ctx
  const [detecting, setDetecting] = useState(false)

  const redetect = async () => {
    setDetecting(true)
    try {
      await ctx.refreshEngines()
    } finally {
      setDetecting(false)
    }
  }

  const toggleHidden = async (id: EngineId) => {
    const hidden = s.hiddenEngines.includes(id) ? s.hiddenEngines.filter((x) => x !== id) : [...s.hiddenEngines, id]
    await setSettings({ hiddenEngines: hidden })
    await redetect() // a newly shown engine has never been polled
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>Settings</h2>
        <span className="faint small">Changes save immediately.</span>
      </div>
      <div className="view-body">
        <div className="set-grid">
          <section className="card set-card" aria-labelledby="set-appearance">
            <h3 id="set-appearance">Appearance</h3>
            <label className="field set-narrow">
              Theme
              <select
                className="select"
                value={s.theme}
                onChange={(e) => void setSettings({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </section>

          <section className="card set-card" aria-labelledby="set-memory">
            <h3 id="set-memory">Memory</h3>
            <label className="check">
              <input type="checkbox" checked={s.memoryInject} onChange={(e) => void setSettings({ memoryInject: e.target.checked })} />
              Inject the project memory into chats and agent turns
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={s.memoryWriteBack}
                onChange={(e) => void setSettings({ memoryWriteBack: e.target.checked })}
              />
              Let agents write notes back to <code>.vi3ecode/memory/</code>
            </label>
          </section>

          <section className="card set-card set-wide" aria-labelledby="set-defaults">
            <h3 id="set-defaults">Defaults for new chats</h3>
            <label className="field set-narrow">
              Default engine
              <select
                className="select"
                value={s.defaultEngine}
                onChange={(e) => void setSettings({ defaultEngine: e.target.value as EngineId })}
              >
                {engines
                  .filter((e) => e.headless)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                      {e.installed ? '' : ' (not installed)'}
                    </option>
                  ))}
              </select>
            </label>
            <fieldset className="set-approval">
              <legend>Default approval mode</legend>
              {APPROVAL.map((a) => (
                <label key={a.mode} className={`set-mode${s.approval === a.mode ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="approval"
                    value={a.mode}
                    checked={s.approval === a.mode}
                    onChange={() => void setSettings({ approval: a.mode })}
                  />
                  <span className="col">
                    <strong>{a.label}</strong>
                    <span className="muted small">{a.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="set-table-wrap">
              <table className="set-table">
                <caption className="faint small">How each mode is passed to the engine (Ask works where the engine can ask)</caption>
                <thead>
                  <tr>
                    <th scope="col">Engine</th>
                    <th scope="col">Read-only</th>
                    <th scope="col">Edits</th>
                    <th scope="col">Full</th>
                  </tr>
                </thead>
                <tbody>
                  {MAPPING.map(([name, ...flags]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      {flags.map((f, i) => (
                        <td key={i} className={f.startsWith('-') ? 'mono' : 'muted'}>
                          {f}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card set-card set-wide" aria-labelledby="set-agents">
            <h3 id="set-agents">Agent mode</h3>
            <p className="muted small set-p">
              Hand-off, hop limit and budget belong to each project's team and travel with it in{' '}
              <code>.vi3ecode/team.json</code>.
            </p>
            <div>
              <button className="btn small" onClick={() => ctx.setMode('agent')}>
                Open Agent team
              </button>
            </div>
          </section>

          <section className="card set-card set-wide" aria-labelledby="set-engines">
            <div className="row">
              <h3 id="set-engines" className="grow">
                Engines
              </h3>
              <span className="small muted" role="status">
                {detecting ? 'Detecting…' : ''}
              </span>
              <button className="btn small" onClick={() => void redetect()} disabled={detecting}>
                Re-detect
              </button>
            </div>
            <div className="set-table-wrap">
              <table className="set-table">
                <thead>
                  <tr>
                    <th scope="col">Engine</th>
                    <th scope="col">Binary</th>
                    <th scope="col">Status</th>
                    <th scope="col">Mode</th>
                    <th scope="col">
                      <span className="set-sr-only">Visibility</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {engines.map((e) => (
                    <tr key={e.id} className={e.enabled ? '' : 'set-hidden'}>
                      <th scope="row">{e.label}</th>
                      <td className="mono">{e.bin}</td>
                      <td>
                        {!e.enabled ? (
                          <span className="faint">hidden — not checked</span>
                        ) : e.installed ? (
                          <span className="row set-status">
                            <span className="dot on" aria-hidden />
                            installed{e.version ? <span className="mono faint">{e.version}</span> : null}
                          </span>
                        ) : (
                          <span className="col set-missing">
                            <span className="row set-status">
                              <span className="dot off" aria-hidden />
                              not found
                            </span>
                            <code className="faint">{e.installHint}</code>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge${e.headless ? ' accent' : ''}`}>{e.headless ? 'headless' : 'terminal only'}</span>
                      </td>
                      <td className="set-actions">
                        <button
                          className="btn ghost small"
                          aria-label={`${e.enabled ? 'Hide' : 'Show'} ${e.label}`}
                          disabled={detecting}
                          onClick={() => void toggleHidden(e.id)}
                        >
                          {e.enabled ? 'Hide' : 'Show'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint small set-p">
              Headless engines run chats and agent turns; terminal-only engines open in a terminal pane. Hidden engines
              are not polled. Each engine signs in with its own account — vi3ecode never sees a password or token.
            </p>
          </section>

          <section className="card set-card" aria-labelledby="set-project">
            <h3 id="set-project">Project</h3>
            <div className="col set-kv">
              <div>
                <div className="faint small">Name</div>
                <div>{project.name}</div>
              </div>
              <div>
                <div className="faint small">Path</div>
                <div className="mono set-path">{project.path}</div>
              </div>
            </div>
            <div>
              <button
                className="btn danger small"
                onClick={() => {
                  if (confirm(`Remove "${project.name}" from the list? Files on disk are not touched.`)) void ctx.removeProject(project.id)
                }}
              >
                Remove from list
              </button>
            </div>
          </section>

          <section className="card set-card" aria-labelledby="set-data">
            <h3 id="set-data">Where your data lives</h3>
            <div>
              <div className="small">
                In the repo: <code>.vi3ecode/</code>
              </div>
              <p className="muted small set-p">
                Task board (<code>kanban.json</code>), notepad (<code>notes.json</code>), agent team (<code>team.json</code>)
                and the memory vault (<code>memory/*.md</code>). It travels with your commits.
              </p>
            </div>
            <div>
              <div className="small">On this machine: the app data folder</div>
              <p className="muted small set-p">
                Chat sessions, agent team runs, the activity record, your project list and these settings. Kept outside
                the repo, so they are never committed.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

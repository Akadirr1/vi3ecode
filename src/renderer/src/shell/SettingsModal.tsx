import { useEffect, useState, type ReactNode } from 'react'
import { Cpu, FolderOpen, Info, LayoutGrid, Library, RefreshCw, X, type LucideIcon } from 'lucide-react'
import type { ApprovalMode, EngineId, Settings } from '../../../shared/types'
import { useApp } from '../context'
import { t } from '../i18n'
import { EngineIcon } from '../components/EngineIcon'
import { APPROVAL_LABEL } from '../components/format'
import './settings.css'

const VERSION = '0.1.0'

type Section = 'general' | 'engines' | 'memory' | 'projects' | 'about'
const SECTIONS: { id: Section; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', hint: 'Appearance, language, defaults', icon: LayoutGrid },
  { id: 'engines', label: 'Engines', hint: 'Installed CLIs, modes, usage', icon: Cpu },
  { id: 'memory', label: 'Memory', hint: 'Injection and agent write-back', icon: Library },
  { id: 'projects', label: 'Projects', hint: 'This project and where data lives', icon: FolderOpen },
  { id: 'about', label: 'About', hint: 'Version and privacy', icon: Info }
]

// How read-only / edits / full reach each engine; mirrors src/main/engines/*.
const MAPPING: [string, string, string, string][] = [
  ['Claude Code', '--permission-mode dontAsk, edit tools removed', '--permission-mode acceptEdits', '--permission-mode bypassPermissions'],
  ['Codex', '-s read-only', '-s workspace-write', '--dangerously-bypass-approvals-and-sandbox'],
  ['Gemini CLI', '--approval-mode plan', '--approval-mode auto_edit', '--approval-mode yolo'],
  ['opencode', 'plan agent', 'default agent', '--auto'],
  ['Cursor', 'instruction only', 'default', '--force']
]

function Group({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group">
      <div className="row">
        <div className="grow">
          <h4>{title}</h4>
          {hint ? <p>{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="set-card">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-field">
      <div className="set-field-head">
        <span className="set-field-label">{label}</span>
        <span className="set-saves">{t('Saves instantly')}</span>
      </div>
      {hint ? <div className="set-field-hint">{hint}</div> : null}
      {children}
    </div>
  )
}

export function SettingsModal({ onClose }: { onClose(): void }) {
  const [section, setSection] = useState<Section>('general')
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal set-modal" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <div className="modal-head">
          <div className="grow">
            <h3 id="set-title">{t('Settings')}</h3>
            <div className="muted small">{t('Workspace & agent configuration')}</div>
          </div>
          <span className="faint small">{t('All changes saved')}</span>
          <button className="iconbtn" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </div>
        <div className="set-layout">
          <nav className="set-nav" aria-label={t('Settings categories')}>
            <div className="micro set-nav-label">{t('Categories')}</div>
            {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                className="set-cat"
                aria-current={section === id ? 'page' : undefined}
                autoFocus={section === id}
                onClick={() => setSection(id)}
              >
                <Icon size={16} aria-hidden />
                <span className="set-cat-text">
                  <span className="set-cat-title">{t(label)}</span>
                  <span className="set-cat-hint">{t(hint)}</span>
                </span>
              </button>
            ))}
            <div className="grow" />
            <div className="set-ver">
              <span className="dot on" aria-hidden />
              vi3ecode · {VERSION}
            </div>
          </nav>
          <div className="set-content">
            {section === 'general' && <General />}
            {section === 'engines' && <Engines />}
            {section === 'memory' && <Memory />}
            {section === 'projects' && <Projects />}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  )
}

function General() {
  const { settings: s, setSettings, engines } = useApp()
  const themes: [Settings['theme'], string][] = [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System']
  ]
  return (
    <>
      <Group title={t('Appearance')} hint={t('Workspace shell presentation.')}>
        <div className="set-cols">
          <Field label={t('Theme')} hint={t('Light, dark, or follow the system.')}>
            <div className="seg" role="group" aria-label={t('Theme')}>
              {themes.map(([v, label]) => (
                <button key={v} aria-pressed={s.theme === v} onClick={() => void setSettings({ theme: v })}>
                  {t(label)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('Language')} hint={t('Interface language.')}>
            <select
              className="select"
              aria-label={t('Language')}
              value={s.language}
              onChange={(e) => void setSettings({ language: e.target.value as Settings['language'] })}
            >
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </Field>
        </div>
      </Group>
      <Group title={t('Defaults for new chats')} hint={t('Each chat can still change these from its composer.')}>
        <div className="set-cols">
          <Field label={t('Default engine')}>
            <select
              className="select"
              aria-label={t('Default engine')}
              value={s.defaultEngine}
              onChange={(e) => void setSettings({ defaultEngine: e.target.value as EngineId })}
            >
              {engines
                .filter((e) => e.headless)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                    {e.installed ? '' : ` (${t('not installed')})`}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t('Default approval')}>
            <select
              className="select"
              aria-label={t('Default approval')}
              value={s.approval}
              onChange={(e) => void setSettings({ approval: e.target.value as ApprovalMode })}
            >
              {Object.entries(APPROVAL_LABEL).map(([mode, a]) => (
                <option key={mode} value={mode}>
                  {t(a.label)}
                </option>
              ))}
            </select>
            <div className="set-field-hint">{t(APPROVAL_LABEL[s.approval].hint)}</div>
          </Field>
        </div>
      </Group>
    </>
  )
}

function Engines() {
  const ctx = useApp()
  const { settings: s, setSettings, engines } = ctx
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
    <>
      <Group
        title={t('Engines')}
        hint={t('Headless engines run chats and agent turns; terminal-only engines open in a terminal pane. Hidden engines are not polled.')}
        action={
          <button className="btn small" onClick={() => void redetect()} disabled={detecting}>
            <RefreshCw size={13} className={detecting ? 'set-spin' : undefined} />
            {detecting ? t('Detecting…') : t('Re-detect')}
          </button>
        }
      >
        <div className="set-engines">
          {engines.map((e) => (
            <div key={e.id} className={`set-engine${e.enabled ? '' : ' off'}`}>
              <span className="engine-ico">
                <EngineIcon engine={e.id} />
              </span>
              <div className="grow set-engine-text">
                <div className="row set-engine-name">
                  <span>{e.label}</span>
                  <span className={`badge${e.headless ? ' brand' : ''}`}>{e.headless ? t('headless') : t('terminal only')}</span>
                </div>
                <div className="set-mono">
                  {e.bin}
                  {e.version ? ` · ${e.version}` : ''}
                  {e.usage ? ` · ${[e.usage.status, e.usage.window, e.usage.resetsAt ? t('resets {time}', { time: new Date(e.usage.resetsAt).toLocaleString() }) : ''].filter(Boolean).join(' · ')}` : ''}
                </div>
                {e.enabled && !e.installed ? <code className="set-hint-code">{e.installHint}</code> : null}
              </div>
              <span className={`badge${e.enabled && e.installed ? ' ok' : ''}`}>
                {!e.enabled ? t('hidden') : e.installed ? t('installed') : t('not found')}
              </span>
              <button
                className="switch"
                aria-pressed={e.enabled}
                aria-label={t('Show {name}', { name: e.label })}
                disabled={detecting}
                onClick={() => void toggleHidden(e.id)}
              >
                {e.enabled ? t('Shown') : t('Hidden')}
              </button>
            </div>
          ))}
        </div>
      </Group>
      <Group title={t('Approval modes per engine')} hint={t('How each mode is passed to the engine. Ask works where the engine can ask.')}>
        <div className="set-table-wrap">
          <table className="set-table">
            <thead>
              <tr>
                <th scope="col">{t('Engine')}</th>
                <th scope="col">{t('Read-only')}</th>
                <th scope="col">{t('Approve edits')}</th>
                <th scope="col">{t('Full access')}</th>
              </tr>
            </thead>
            <tbody>
              {MAPPING.map(([name, ...flags]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  {flags.map((f, i) => (
                    <td key={i} className={f.startsWith('-') ? 'mono' : 'muted'}>
                      {f.startsWith('-') ? f : t(f)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>
      <p className="set-note">{t('Each engine signs in with its own account — vi3ecode never sees a password or token.')}</p>
    </>
  )
}

function Memory() {
  const { settings: s, setSettings } = useApp()
  return (
    <Group title={t('Memory')} hint={t('Durable notes in .vi3ecode/memory/, committed with the repo and shared with every agent.')}>
      <div className="set-switch-row">
        <div className="grow">
          <div className="set-field-label">{t('Inject memory into chats')}</div>
          <div className="set-field-hint">{t('Adds the memory brief ahead of each chat and agent turn. When off, agents start without memory.')}</div>
        </div>
        <button className="switch" aria-pressed={s.memoryInject} aria-label={t('Inject memory into chats')} onClick={() => void setSettings({ memoryInject: !s.memoryInject })}>
          {s.memoryInject ? t('On') : t('Off')}
        </button>
      </div>
      <div className="set-switch-row">
        <div className="grow">
          <div className="set-field-label">{t('Agents can save memories')}</div>
          <div className="set-field-hint">{t('Agents may write notes back to .vi3ecode/memory/. When off, the vault is curated by hand.')}</div>
        </div>
        <button className="switch" aria-pressed={s.memoryWriteBack} aria-label={t('Agents can save memories')} onClick={() => void setSettings({ memoryWriteBack: !s.memoryWriteBack })}>
          {s.memoryWriteBack ? t('On') : t('Off')}
        </button>
      </div>
    </Group>
  )
}

function Projects() {
  const { project, removeProject } = useApp()
  return (
    <>
      <Group title={t('Current project')} hint={t('Removing a project only drops it from this list; files on disk are not touched.')}>
        <div className="set-kv">
          <span className="micro">{t('Name')}</span>
          <span>{project.name}</span>
          <span className="micro">{t('Path')}</span>
          <span className="set-mono set-path">{project.path}</span>
        </div>
        <div>
          <button
            className="btn danger small"
            onClick={() => {
              if (confirm(t('Remove "{name}" from the list? Files on disk are not touched.', { name: project.name }))) void removeProject(project.id)
            }}
          >
            {t('Remove from list')}
          </button>
        </div>
      </Group>
      <Group title={t('Where your data lives')}>
        <div className="set-kv">
          <span className="micro">{t('In the repo')}</span>
          <span>
            <span className="set-mono set-path">{project.path}/.vi3ecode/</span>
            <span className="set-field-hint">
              {t('Task board (kanban.json), notepad (notes.json), agent team (team.json) and the memory vault (memory/*.md). It travels with your commits.')}
            </span>
          </span>
          <span className="micro">{t('This machine')}</span>
          <span>
            <span className="set-mono">{t('App data folder')}</span>
            <span className="set-field-hint">
              {t('Chat sessions, agent team runs, the activity record, your project list and these settings. Kept outside the repo, so they are never committed.')}
            </span>
          </span>
        </div>
      </Group>
    </>
  )
}

function About() {
  return (
    <Group title={t('About')} hint={t('Desktop workspace for the coding agents you already use.')}>
      <div className="set-version">
        <span className="engine-ico">
          <Info size={15} />
        </span>
        <div>
          <div className="micro">{t('Current version')}</div>
          <div className="set-version-n">vi3ecode {VERSION}</div>
        </div>
      </div>
      <p className="set-field-hint">
        {t('Each engine signs in with its own account — vi3ecode never handles a password or a token. The activity record stays on this machine and never holds conversation text, tool arguments, file contents or command output.')}
      </p>
    </Group>
  )
}

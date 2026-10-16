import { useEffect, useState } from 'react'
import { Blocks, BookMarked, ExternalLink, FolderOpen, Globe, ScanSearch, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import type { PluginInfo, PluginPermission } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import './ext-tools.css'

const PERMS: Record<PluginPermission, { short: string; long: string; icon: LucideIcon }> = {
  'run-commands': { short: 'commands', long: 'Run commands on your computer', icon: SquareTerminal },
  'read-project': { short: 'read project', long: 'Read files in the active project', icon: ScanSearch },
  'write-project': { short: 'write project', long: 'Create and change files in the active project', icon: FolderOpen },
  network: { short: 'network', long: 'Access the internet', icon: Globe }
}

const ICONS: Record<string, LucideIcon> = { rea: ScanSearch, playwright: Globe, context7: BookMarked, filesystem: FolderOpen }

const commandLine = (p: PluginInfo) => (p.mcp ? [p.mcp.command, ...p.mcp.args].join(' ') : '')

export function PluginsTool(_: { docked: boolean }) {
  const { project } = useApp()
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [confirming, setConfirming] = useState<PluginInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setPlugins(null)
    void api.plugins.list(project.id).then(setPlugins, (e: Error) => setError(e.message))
  }, [project.id])

  const setActive = async (p: PluginInfo, active: boolean) => {
    setConfirming(null)
    try {
      setPlugins(await api.plugins.setActive(project.id, p.id, active))
      setError('')
    } catch (e) {
      setError(t('Project activation failed: {error}', { error: (e as Error).message }))
    }
  }

  if (!plugins) return error ? <div className="empty">{error}</div> : null
  const activeCount = plugins.filter((p) => p.active).length

  return (
    <div className="xt">
      <div className="xt-bar">
        <span className="micro">{t('Store ({count})', { count: plugins.length })}</span>
        <div className="grow" />
        <span className={`badge${activeCount ? ' ok' : ''}`}>{t('{n} active', { n: activeCount })}</span>
      </div>
      <div className="xt-scroll xt-plugins">
        <p className="muted small xt-lede">{t('Extend your engines with external developer tools. Each plugin is an MCP server, activated per project and confirmed on each machine before it runs.')}</p>
        {error ? (
          <p className="xt-error" role="alert">
            {error}
          </p>
        ) : null}
        {plugins.map((p) => {
          const Icon = ICONS[p.id] ?? Blocks
          return (
            <article key={p.id} className={`card xt-plugin${p.active ? ' on' : ''}`} aria-label={p.name}>
              <div className="row xt-plugin-head">
                <span className="engine-ico">
                  <Icon size={15} />
                </span>
                <div className="grow">
                  <strong className="xt-name">{p.name}</strong>
                  <div className="xt-meta" title={commandLine(p)}>
                    {commandLine(p)}
                  </div>
                </div>
                <button
                  className="switch"
                  aria-pressed={p.active}
                  aria-label={p.active ? t('Deactivate {name}', { name: p.name }) : t('Activate {name}', { name: p.name })}
                  onClick={() => (p.active ? void setActive(p, false) : setConfirming(p))}
                >
                  {p.active ? t('Active') : t('Off')}
                </button>
              </div>
              <p className="muted small xt-desc">{p.description}</p>
              <div className="row xt-perms">
                {p.permissions.map((perm) => {
                  const { short, long, icon: PIcon } = PERMS[perm]
                  return (
                    <span key={perm} className="badge" title={t(long)}>
                      <PIcon size={10} aria-hidden />
                      {t(short)}
                    </span>
                  )
                })}
                <div className="grow" />
                {p.homepage ? (
                  <a className="xt-link" href={p.homepage} target="_blank" rel="noreferrer">
                    {t('Homepage')}
                    <ExternalLink size={11} aria-hidden />
                  </a>
                ) : null}
              </div>
              {p.active ? (
                <div className="xt-engines small">
                  <span className="dot on" aria-hidden />
                  {t('Active for this project · Claude Code chats and agent turns get its tools; other engines not yet.')}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
      <div className="xt-foot">
        <span className="xt-meta">.vi3ecode/plugins.json</span>
      </div>
      {confirming ? (
        <ConfirmActivate plugin={confirming} projectName={project.name} onCancel={() => setConfirming(null)} onConfirm={() => void setActive(confirming, true)} />
      ) : null}
    </div>
  )
}

function ConfirmActivate({ plugin, projectName, onCancel, onConfirm }: { plugin: PluginInfo; projectName: string; onCancel(): void; onConfirm(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="xt-consent-title">
        <div className="modal-head">
          <span className="engine-ico">
            <Blocks size={15} />
          </span>
          <div className="grow">
            <h3 id="xt-consent-title">{t('Activate {name}?', { name: plugin.name })}</h3>
            <div className="muted small">{t('For the project {name}', { name: projectName })}</div>
          </div>
          <button className="iconbtn" onClick={onCancel} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body col xt-consent">
          <div className="micro">{t('This plugin will be allowed to:')}</div>
          <ul className="xt-consent-list">
            {plugin.permissions.map((perm) => {
              const { long, icon: PIcon } = PERMS[perm]
              return (
                <li key={perm}>
                  <PIcon size={14} aria-hidden />
                  {t(long)}
                </li>
              )
            })}
          </ul>
          <div className="micro">{t('It starts as')}</div>
          <code className="xt-cmd">{commandLine(plugin)}</code>
          <p className="muted small">
            {t('npx downloads the package from npm the first time an engine starts it. It runs with your user account’s rights: the list above is what the plugin declares, not a sandbox.')}
          </p>
          <p className="muted small">{t('Claude Code chats and agent turns in this project get its tools from their next turn. Other engines do not receive plugins yet.')}</p>
        </div>
        <div className="modal-foot">
          <div className="grow" />
          <button className="btn ghost" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button className="btn primary" autoFocus onClick={onConfirm}>
            {t('Activate for project')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { BookOpenText, ChevronLeft, MessageSquarePlus, Plus, Trash2 } from 'lucide-react'
import type { Skill } from '../../../shared/types'
import { SKILL_NAME_RE } from '../../../shared/skills'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import './ext-tools.css'

type Draft = Omit<Skill, 'installed'> & { saved: boolean }

const blank = (): Draft => ({ name: '', description: '', body: '', saved: false })
/** Typed names become valid folder names as you go. */
const toName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 64)

export function SkillsTool({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const projectId = ctx.project.id
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setSkills(null)
    setDraft(null)
    void api.skills.list(projectId).then(setSkills, (e: Error) => setStatus(e.message))
  }, [projectId])

  if (!skills) return status ? <div className="empty">{status}</div> : null

  const open = (d: Draft | null) => {
    if (dirty && !confirm(t('Discard unsaved changes to this skill?'))) return
    setDraft(d)
    setDirty(false)
    setStatus('')
  }
  const edit = (p: Partial<Draft>) => {
    setDraft((d) => d && { ...d, ...p })
    setDirty(true)
  }
  const fail = (e: unknown) => setStatus((e as Error).message)

  const current = draft && skills.find((s) => s.name === draft.name)
  const installed = !!(draft?.saved && current?.installed)
  const nameTaken = !!draft && !draft.saved && skills.some((s) => s.name === draft.name)
  const nameOk = !!draft && SKILL_NAME_RE.test(draft.name) && !nameTaken

  const save = async () => {
    if (!draft || !nameOk) return
    try {
      const saved = await api.skills.save(projectId, { name: draft.name, description: draft.description, body: draft.body })
      setSkills([...skills.filter((s) => s.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)))
      setDraft({ ...saved, saved: true })
      setDirty(false)
      setStatus(t('Saved'))
    } catch (e) {
      fail(e)
    }
  }
  const setInstalled = async (on: boolean) => {
    if (!draft) return
    try {
      setSkills(await api.skills.setInstalled(projectId, draft.name, on))
      setStatus(on ? t('Installed for every engine') : t('Uninstalled'))
    } catch (e) {
      fail(e)
    }
  }
  const useInChat = async () => {
    if (!draft) return
    try {
      // Installing first is what lets the engine find the skill.
      if (!installed) setSkills(await api.skills.setInstalled(projectId, draft.name, true))
      ctx.openChat(`Use the ${draft.name} skill: `)
    } catch (e) {
      fail(e)
    }
  }
  const remove = async () => {
    if (!draft?.saved || !confirm(t('Delete the skill "{name}" and its installed copies?', { name: draft.name }))) return
    try {
      await api.skills.remove(projectId, draft.name)
      setSkills(skills.filter((s) => s.name !== draft.name))
      setDraft(null)
      setDirty(false)
      setStatus('')
    } catch (e) {
      fail(e)
    }
  }

  const showList = !docked || !draft
  const showDetail = !docked || !!draft

  return (
    <div className="xt">
      <div className="xt-bar">
        <span className="micro">{t('Skills ({count})', { count: skills.length })}</span>
        <div className="grow" />
        <button className="btn primary small" onClick={() => open(blank())}>
          <Plus size={13} />
          {t('New skill')}
        </button>
      </div>
      <div className={docked ? 'xt-single' : 'xt-split'}>
        {showList ? (
          <div className="xt-list" role="list">
            {skills.map((s) => (
              <button
                key={s.name}
                role="listitem"
                className={`list-item xt-item${draft?.saved && draft.name === s.name ? ' active' : ''}`}
                aria-current={(draft?.saved && draft.name === s.name) || undefined}
                onClick={() => open({ ...s, saved: true })}
              >
                <span className={`dot ${s.installed ? 'on' : 'off'}`} title={s.installed ? t('Installed') : t('Not installed')} aria-hidden />
                <span className="grow col xt-item-text">
                  <span className="mono xt-item-title">{s.name}</span>
                  <span className="faint small xt-item-sub">{s.description || t('No description')}</span>
                </span>
              </button>
            ))}
            {!skills.length ? <div className="faint small xt-none">{t('No skills yet')}</div> : null}
          </div>
        ) : null}
        {showDetail ? (
          draft ? (
            <div className="xt-editor">
              <div className="row">
                {docked ? (
                  <button className="iconbtn" onClick={() => open(null)} aria-label={t('Back')} title={t('Back')}>
                    <ChevronLeft size={15} />
                  </button>
                ) : null}
                <label className="field grow">
                  <span className="micro">{t('Name')}</span>
                  <input
                    className="input mono"
                    value={draft.name}
                    readOnly={draft.saved}
                    autoFocus={!draft.saved}
                    placeholder="deploy-checklist"
                    aria-invalid={!!draft.name && !nameOk}
                    onChange={(e) => edit({ name: toName(e.target.value) })}
                  />
                </label>
              </div>
              {nameTaken ? <div className="xt-error small">{t('A skill with this name already exists.')}</div> : null}
              <label className="field">
                <span className="micro">{t('Description')}</span>
                <input
                  className="input"
                  value={draft.description}
                  placeholder={t('One line: when should an engine use this skill?')}
                  onChange={(e) => edit({ description: e.target.value })}
                />
              </label>
              <label className="field xt-grow">
                <span className="row">
                  <span className="micro grow">{t('Instructions (Markdown)')}</span>
                  <span className="xt-meta">{t('{n} chars', { n: draft.body.length })}</span>
                </span>
                <textarea
                  className="textarea mono xt-body"
                  value={draft.body}
                  placeholder={t('Steps, rules and examples the engine follows when it uses this skill.')}
                  onChange={(e) => edit({ body: e.target.value })}
                />
              </label>
              <div className="xt-meta">.vi3ecode/skills/{draft.name || '<name>'}/SKILL.md</div>
              <div className="row xt-actions">
                <button className="btn primary small" disabled={!dirty || !nameOk} onClick={() => void save()}>
                  {t('Save')}
                </button>
                <button
                  className="switch"
                  aria-pressed={installed}
                  disabled={!draft.saved}
                  title={t('Copies the skill to .claude/skills and .opencode/skill and lists it in AGENTS.md')}
                  onClick={() => void setInstalled(!installed)}
                >
                  {t('Installed')}
                </button>
                <button className="btn small" disabled={!draft.saved} onClick={() => void useInChat()}>
                  <MessageSquarePlus size={13} />
                  {t('Use in chat')}
                </button>
                <div className="grow" />
                {draft.saved ? (
                  <button className="iconbtn" onClick={() => void remove()} aria-label={t('Delete skill')} title={t('Delete skill')}>
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
              <div className="small muted" role="status">
                {dirty ? t('Unsaved changes') : status}
              </div>
              {installed ? (
                <div className="xt-meta xt-wrap">{t('Installed in .claude/skills · .opencode/skill · AGENTS.md (Codex, Cursor, Kimi)')}</div>
              ) : null}
            </div>
          ) : (
            <div className="xt-intro">
              <span className="engine-ico">
                <BookOpenText size={15} />
              </span>
              <h3>{skills.length ? t('Select a skill') : t('No skills yet')}</h3>
              <p className="muted">
                {t('Reusable instructions you hand to agents. Each skill is a SKILL.md in .vi3ecode/skills/, committed with the repo. Installing copies it where Claude Code and opencode look for skills and lists it in AGENTS.md for Codex, Cursor and Kimi.')}
              </p>
              <button className="btn primary small" onClick={() => open(blank())}>
                <Plus size={13} />
                {t('Create a skill')}
              </button>
              {status ? <p className="small muted">{status}</p> : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

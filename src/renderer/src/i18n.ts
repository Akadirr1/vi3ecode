// UI strings are written in English and looked up here; Turkish is the second language the app ships.
// Missing keys fall back to English, so a new string never breaks the UI.
import tr from './i18n.tr.json'

let lang: 'en' | 'tr' = 'en'

export function setLanguage(next: 'en' | 'tr'): void {
  lang = next
}

/** Translate; `{name}` placeholders are filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = lang === 'tr' ? ((tr as Record<string, string>)[en] ?? en) : en
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

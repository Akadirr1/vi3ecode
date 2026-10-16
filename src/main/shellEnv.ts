import { execFileSync } from 'node:child_process'

/**
 * Apps started from the Dock/Start menu get a minimal PATH, so `claude`, `codex` etc. installed
 * via npm/brew/nvm are not found. Ask the user's login shell for its PATH once at startup.
 */
export function loadShellPath(): void {
  // launchd gives GUI apps no locale: terminals and CLIs would run in C/ASCII and mangle ş, ğ, ı.
  if (process.platform === 'darwin' && !process.env.LANG && !process.env.LC_ALL && !process.env.LC_CTYPE) process.env.LANG = 'en_US.UTF-8'
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/bash'
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__V3PATH__%s__V3PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = /__V3PATH__(.*?)__V3PATH__/s.exec(out)
    if (!m) return
    const merged = [...new Set([...m[1].split(':'), ...(process.env.PATH ?? '').split(':')])].filter(Boolean)
    process.env.PATH = merged.join(':')
  } catch {
    // Keep the inherited PATH.
  }
}

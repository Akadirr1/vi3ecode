#!/usr/bin/env node
// Collects the ORIGINAL vi3ecode app's local state after test scenarios, so its server decisions can be studied.
// Copies an allowlist of files from its app-data folder into a folder OUTSIDE this repository and masks secrets.
// Usage: node tools/pro-capture/collect.cjs [--app-data <dir>] [--project <test project folder>] [--out <dir>]
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

const ID = 'com.vi3ecode.desktop'
const defaultAppData = () =>
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', ID)
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), ID)
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), ID)

// What the server decided ends up in these (threads, jobs, plans, bots, settings, activity).
const ALLOW = [
  'agents/runtime-v1.json', 'agent-jobs.json', 'agents/global-agents.json', 'settings/settings.json', 'projects.json',
  'activity-log.jsonl', 'usage-events.jsonl', 'telemetry/turns.json', 'kept-worktrees.json', 'terminal-layout.json',
  'version-check.json', 'frontend-errors.log', 'bots/bots.sqlite3', 'swarms', 'agent-reports'
]
// Never copied, whatever the allowlist says: keys, pairings, grants, sign-in state, browser storage, engine accounts.
const DENY_NAME = /token|credential|secret|grant|key|auth|cookie|pairing|sign-in|browser-storage|account|\.sec1$/i
const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|grant|api_?key|refresh|access_?key|signature|credential|email|license/i
const SECRET_VALUE = /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*|\b(sk|pk|rk|ghp|gho|xox[abp])[-_][\w-]{16,}|\bBearer\s+[\w.~+/-]{16,}=*/g

/** Masks secret-looking keys and values in parsed JSON. */
function redact(value, key = '') {
  if (SECRET_KEY.test(key) && value !== null && typeof value !== 'object' && typeof value !== 'boolean') return '[redacted]'
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]')
  if (Array.isArray(value)) return value.map((v) => redact(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
  return value
}

/** JSON and JSONL are parsed and masked; other text has secret-looking values masked; binaries are copied as they are. */
function redactFile(name, buf) {
  if (/\.(json)$/i.test(name)) {
    try {
      return Buffer.from(JSON.stringify(redact(JSON.parse(buf.toString('utf8'))), null, 2))
    } catch {
      // not valid JSON: fall through to text masking
    }
  }
  if (/\.(jsonl|log|txt|md|json)$/i.test(name)) {
    const lines = buf.toString('utf8').split('\n').map((l) => {
      try {
        return l.trim() ? JSON.stringify(redact(JSON.parse(l))) : l
      } catch {
        return l.replace(SECRET_VALUE, '[redacted]')
      }
    })
    return Buffer.from(lines.join('\n'))
  }
  return buf
}

function copyTree(from, to, log) {
  const st = fs.lstatSync(from)
  if (st.isSymbolicLink()) return
  if (DENY_NAME.test(path.basename(from))) return log.push(`skipped (sensitive name): ${from}`)
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(from)) copyTree(path.join(from, n), path.join(to, n), log)
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, redactFile(from, fs.readFileSync(from)))
  log.push(`copied: ${from}`)
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const appData = arg('--app-data') || defaultAppData()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = arg('--out') || path.join(os.homedir(), 'vi3ecode-pro-capture', stamp)
  const repo = path.resolve(__dirname, '..', '..')
  if (path.resolve(out).startsWith(repo + path.sep)) throw new Error('The output folder must be outside this repository (it is public).')
  if (!fs.existsSync(appData)) throw new Error(`vi3ecode app data not found at ${appData} (pass --app-data)`)
  const log = []
  for (const rel of ALLOW) {
    const from = path.join(appData, rel)
    if (fs.existsSync(from)) copyTree(from, path.join(out, 'app-data', rel), log)
  }
  const project = arg('--project')
  if (project) {
    const dir = path.join(project, '.vi3ecode')
    if (fs.existsSync(dir)) copyTree(dir, path.join(out, 'project-vi3ecode'), log)
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'manifest.txt'), `app data: ${appData}\nplatform: ${process.platform}\n\n${log.join('\n')}\n`)
  console.log(`Saved to ${out} (${log.filter((l) => l.startsWith('copied')).length} files). Nothing was sent anywhere.`)
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
module.exports = { redact, redactFile, DENY_NAME }

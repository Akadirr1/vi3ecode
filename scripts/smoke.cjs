// Launches the packaged app (release/…) and checks it really works on this OS: the window renders,
// IPC answers, a real PTY runs a command. Saves a screenshot for the CI artifact. Exit code 1 on failure.
const { _electron: electron } = require('playwright-core')
const { existsSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const candidates = {
  darwin: ['release/mac-arm64/vi3ecode.app/Contents/MacOS/vi3ecode', 'release/mac/vi3ecode.app/Contents/MacOS/vi3ecode'],
  win32: ['release/win-unpacked/vi3ecode.exe'],
  linux: ['release/linux-unpacked/vi3ecode']
}[process.platform]

;(async () => {
  const exe = candidates.find((p) => existsSync(p))
  if (!exe) throw new Error(`No packaged app found in ${candidates.join(', ')}`)
  const tmp = mkdtempSync(join(os.tmpdir(), 'vi3e-smoke-'))
  const project = join(tmp, 'demo')
  mkdirSync(project)
  writeFileSync(join(project, 'README.md'), '# smoke\n')
  const ud = join(tmp, 'ud')
  mkdirSync(ud)
  writeFileSync(join(ud, 'state.json'), JSON.stringify({ projects: [{ id: 'p1', name: 'Smoke test', path: project, addedAt: 0 }], settings: { theme: 'dark', openProjects: ['p1'] } }))

  const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] })
  const page = await app.firstWindow()
  await page.waitForSelector('.tabbar', { timeout: 30000 })
  const report = await page.evaluate(async () => {
    const api = window.api
    const engines = await api.engines.list(true)
    const pty = await api.pty.create('p1', { cols: 80, rows: 24 })
    let out = ''
    api.pty.onData((id, d) => id === pty.id && (out += d))
    await new Promise((r) => setTimeout(r, 1500))
    api.pty.write(pty.id, 'echo SMOKE_$((6*7))\r')
    for (let i = 0; i < 40 && !/SMOKE_42|SMOKE_\$\(\(6\*7\)\)/.test(out); i++) await new Promise((r) => setTimeout(r, 250))
    const board = await api.board.get('p1')
    await api.pty.kill(pty.id)
    return {
      title: document.title,
      tabs: [...document.querySelectorAll('.ptab-name')].map((e) => e.textContent),
      engines: engines.length,
      ptyOutput: /SMOKE_42|SMOKE_\$\(\(6\*7\)\)/.test(out),
      boardColumns: board.columns.length
    }
  })
  await page.getByRole('tab', { name: 'Agent Mode' }).click()
  await page.waitForTimeout(800)
  mkdirSync('smoke', { recursive: true })
  await page.screenshot({ path: `smoke/${process.platform}-agent-mode.png` })
  await app.close()
  console.log(JSON.stringify(report))
  const ok = report.tabs.includes('Smoke test') && report.engines > 0 && report.ptyOutput && report.boardColumns === 5
  if (!ok) throw new Error('Smoke test failed: ' + JSON.stringify(report))
  console.log(`smoke ok on ${process.platform}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Loopback bridge behind the vi3ecode-browser MCP server: engines call tools, we drive the <webview> in the
// browser panel (the renderer registers its webContents id). Bound to 127.0.0.1 with a per-launch token.
import { app, webContents, type WebContents } from 'electron'
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { emit } from './events'
import { getSettings, userDir } from './store'

let guest: WebContents | null = null
let server: Server | null = null
let port = 0
const token = randomBytes(24).toString('hex')

export const BROWSER_SERVER = 'vi3ecode-browser'
/** Tools that only look: always allowed, read-only agents included. */
export const BROWSER_READ_TOOLS = ['browser_url', 'browser_screenshot', 'browser_get_text'].map((t) => `mcp__${BROWSER_SERVER}__${t}`)
/** Tools that act on the page: allowed without a card except for read-only agents ("you are watching the same panel"). */
export const BROWSER_ACT_TOOLS = ['browser_navigate', 'browser_click', 'browser_type', 'browser_scroll', 'browser_back', 'browser_forward', 'browser_reload'].map(
  (t) => `mcp__${BROWSER_SERVER}__${t}`
)

export function registerBrowser(id: number | null): void {
  guest = id === null ? null : (webContents.fromId(Number(id)) ?? null)
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

/** The panel may be closed: ask the renderer to open it and wait for the webview to register. */
async function ensureGuest(): Promise<WebContents> {
  if (guest && !guest.isDestroyed()) return guest
  emit('browser:open')
  for (let i = 0; i < 50 && !(guest && !guest.isDestroyed()); i++) await new Promise((r) => setTimeout(r, 100))
  if (!guest || guest.isDestroyed()) throw new Error('The browser panel is not open. Open it from the right rail (globe icon).')
  return guest
}

function settled(g: WebContents, ms = 30_000): Promise<void> {
  if (!g.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    g.once('did-stop-loading', () => (clearTimeout(t), resolve()))
  })
}

// Page-side helpers run with executeJavaScript in the page's main world.
const TEXT_JS = (selector: string | undefined, max: number) => `(() => {
  const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body'}
  if (!root) return { error: 'No element matches the selector.' }
  const out = []
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.textContent.replace(/\\s+/g, ' ').trim(); if (t) out.push(t); return }
    if (n.nodeType !== 1) return
    const el = n, cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(el.tagName)) return
    if (el.tagName === 'A') { out.push('[link "' + el.innerText.trim() + '" -> ' + el.getAttribute('href') + ']'); return }
    if (el.tagName === 'BUTTON') { out.push('[button "' + el.innerText.trim() + '"]'); return }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') { out.push('[input:' + (el.type || el.tagName.toLowerCase()) + ' name=' + (el.name || el.id || '') + ' value=' + JSON.stringify(el.value || '') + ']'); return }
    for (const c of el.childNodes) walk(c)
    if (/^(P|DIV|LI|H[1-6]|TR|SECTION|ARTICLE|HEADER|FOOTER)$/.test(el.tagName)) out.push('\\n')
  }
  walk(root)
  const all = out.join(' ').replace(/ *\\n */g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim()
  return { text: all.slice(0, ${max}), truncated: all.length > ${max}, title: document.title }
})()`

const CLICK_JS = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { error: 'No element matches the selector.' }
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
  el.click()
  return { clicked: el.tagName.toLowerCase(), text: (el.innerText || el.value || '').slice(0, 80) }
})()`

const TYPE_JS = (selector: string | undefined, value: string, submit: boolean) => `(() => {
  const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.activeElement'}
  if (!el || !('value' in el)) return { error: 'No input to type into.' }
  el.focus()
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (${submit}) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit()
  }
  return { typed: true }
})()`

const SCROLL_JS = (direction: string, amount?: number) => `(() => {
  const s = document.scrollingElement || document.documentElement
  const step = ${typeof amount === 'number' ? amount : 'innerHeight * 0.9'}
  const d = ${JSON.stringify(direction)}
  if (d === 'top') s.scrollTop = 0
  else if (d === 'bottom') s.scrollTop = s.scrollHeight
  else s.scrollTop += d === 'up' ? -step : step
  return { scrollY: Math.round(s.scrollTop), max: Math.round(s.scrollHeight - innerHeight) }
})()`

async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
  const g = await ensureGuest()
  switch (name) {
    case 'browser_navigate': {
      const url = String(args.url ?? '')
      if (!/^https?:\/\//i.test(url)) return text('Only absolute http(s) URLs can be opened.', true)
      await g.loadURL(url).catch(() => {}) // a failed sub-resource should not fail the tool; report where we ended up
      await settled(g)
      return text(JSON.stringify({ url: g.getURL(), title: g.getTitle() }))
    }
    case 'browser_url':
      return text(JSON.stringify({ url: g.getURL(), title: g.getTitle(), loading: g.isLoading() }))
    case 'browser_screenshot': {
      const img = await g.capturePage()
      const size = await g.executeJavaScript('({ width: innerWidth, height: innerHeight })')
      return { content: [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `viewport ${size.width}×${size.height} CSS px` }] }
    }
    case 'browser_get_text': {
      const max = Math.min(100_000, Math.max(500, Number(args.max_chars) || 20_000))
      const r = await g.executeJavaScript(TEXT_JS(typeof args.selector === 'string' ? args.selector : undefined, max))
      return r.error ? text(r.error, true) : text(`${r.title}\n\n${r.text}${r.truncated ? '\n\n(truncated)' : ''}`)
    }
    case 'browser_click': {
      if (typeof args.selector === 'string' && args.selector) {
        const r = await g.executeJavaScript(CLICK_JS(args.selector))
        return r.error ? text(r.error, true) : text(JSON.stringify(r))
      }
      const x = Math.round(Number(args.x)),
        y = Math.round(Number(args.y))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return text('Give a selector or x and y.', true)
      for (const type of ['mouseDown', 'mouseUp'] as const) g.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
      return text(`clicked at ${x},${y}`)
    }
    case 'browser_type': {
      const r = await g.executeJavaScript(TYPE_JS(typeof args.selector === 'string' ? args.selector : undefined, String(args.text ?? ''), args.submit === true))
      if (!r.error) await settled(g, 10_000)
      return r.error ? text(r.error, true) : text('typed')
    }
    case 'browser_scroll':
      return text(JSON.stringify(await g.executeJavaScript(SCROLL_JS(String(args.direction ?? 'down'), typeof args.amount === 'number' ? args.amount : undefined))))
    case 'browser_back':
      if (g.navigationHistory.canGoBack()) g.navigationHistory.goBack()
      await settled(g)
      return text(g.getURL())
    case 'browser_forward':
      if (g.navigationHistory.canGoForward()) g.navigationHistory.goForward()
      await settled(g)
      return text(g.getURL())
    case 'browser_reload':
      g.reload()
      await settled(g)
      return text(g.getURL())
    case 'browser_eval': {
      const v = await g.executeJavaScript(String(args.expression ?? 'undefined'))
      return text(JSON.stringify(v ?? null).slice(0, 50_000))
    }
    default:
      return text(`Unknown tool ${name}`, true)
  }
}

export function startBrowserBridge(): void {
  if (server) return
  // Engines put MCP env on their command line, which other local users can read; only the file's path goes there.
  try {
    mkdirSync(dirname(tokenFile()), { recursive: true })
    writeFileSync(tokenFile(), token, { mode: 0o600 })
    chmodSync(tokenFile(), 0o600)
  } catch {
    return // no bridge: engines simply get no browser tools
  }
  server = createServer((req, res) => {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== '/call' || req.headers.authorization !== `Bearer ${token}`) return reply(403, text('forbidden', true))
    let body = ''
    req.on('data', (c) => (body = body.length < 1_000_000 ? body + c : body))
    req.on('end', async () => {
      try {
        const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> }
        reply(200, await run(String(name), args && typeof args === 'object' ? args : {}))
      } catch (e) {
        reply(200, text(String(e instanceof Error ? e.message : e), true))
      }
    })
  })
  server.listen(0, '127.0.0.1', () => {
    const addr = server!.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  })
}

export function stopBrowserBridge(): void {
  server?.close()
  server = null
}

const tokenFile = () => userDir('bridge-token')
const shimPath = () => (app.isPackaged ? join(process.resourcesPath, 'mcp-shim.cjs') : join(app.getAppPath(), 'resources', 'mcp-shim.cjs'))

/** The MCP server entry handed to engines, or undefined when browser tools are off or the bridge is down. */
export function browserMcpServer(): Record<string, unknown> | undefined {
  if (!getSettings().browserTools || !port) return undefined
  return {
    command: process.execPath,
    args: [shimPath()],
    env: { ELECTRON_RUN_AS_NODE: '1', VI3E_BRIDGE_URL: `http://127.0.0.1:${port}`, VI3E_BRIDGE_TOKEN_FILE: tokenFile() }
  }
}

export const browserBridgeApi = {
  async register(id: number | null): Promise<void> {
    registerBrowser(id)
  }
}

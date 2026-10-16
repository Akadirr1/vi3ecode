import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import type { DidFailLoadEvent, WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, Camera, CornerDownLeft, ExternalLink, Globe, RotateCw, ScanText, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import './browser.css'

/** Address bar input → an http(s) URL, or null. Bare hosts get https://, local dev servers http://. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(s) ? 'http://' : 'https://') + s
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

const DEFAULT_URL = 'http://localhost:3000'
const MAX_TEXT = 20_000
const lastKey = (pid: string) => `vi3e.browser.last.${pid}`

function lastUrl(pid: string): string {
  try {
    return localStorage.getItem(lastKey(pid)) || DEFAULT_URL
  } catch {
    return DEFAULT_URL
  }
}

// Keyed by project: each project has its own page.
export function BrowserTool({ docked }: { docked: boolean }) {
  return <Browser key={useApp().project.id} docked={docked} />
}

function Browser({ docked }: { docked: boolean }) {
  const ctx = useApp()
  const pid = ctx.project.id
  const ref = useRef<WebviewTag>(null)
  const [input, setInput] = useState(() => lastUrl(pid))
  const [start, setStart] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [failure, setFailure] = useState('')
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const w = ref.current
    if (!w) return
    const sync = () => {
      const current = w.getURL()
      // An engine navigated the blank panel: show the page.
      if (!start && current && current !== 'about:blank') setStart(current)
      setUrl(current)
      setInput(current)
      setNav({ back: w.canGoBack(), forward: w.canGoForward() })
      try {
        localStorage.setItem(lastKey(pid), current)
      } catch {
        // per-viewer convenience only
      }
    }
    const onStart = () => (setLoading(true), setFailure(''))
    const onStop = () => (setLoading(false), sync())
    // -3 is an aborted load (a newer navigation replaced it), not a failure.
    const onFail = (e: DidFailLoadEvent) =>
      e.isMainFrame && e.errorCode !== -3 && setFailure(t('Could not open {url} ({error}).', { url: e.validatedURL, error: e.errorDescription }))
    w.addEventListener('did-start-loading', onStart)
    w.addEventListener('did-stop-loading', onStop)
    w.addEventListener('did-navigate', sync)
    w.addEventListener('did-navigate-in-page', sync)
    w.addEventListener('did-fail-load', onFail)
    return () => {
      w.removeEventListener('did-start-loading', onStart)
      w.removeEventListener('did-stop-loading', onStop)
      w.removeEventListener('did-navigate', sync)
      w.removeEventListener('did-navigate-in-page', sync)
      w.removeEventListener('did-fail-load', onFail)
    }
  }, [start, pid])

  // Register the webview with main so engines' browser_* tools act on what the user sees.
  useEffect(() => {
    const w = ref.current
    if (!w) return
    // dom-ready fires on every load; registering again is harmless and keeps main pointed at this webview.
    const register = () => void api.browser.register(w.getWebContentsId())
    w.addEventListener('dom-ready', register)
    return () => {
      w.removeEventListener('dom-ready', register)
      void api.browser.register(null)
    }
  }, [])

  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote(null), 3000)
    return () => clearTimeout(id)
  }, [note])

  const go = (e?: FormEvent) => {
    e?.preventDefault()
    const target = normalizeUrl(input)
    if (!target) return setNote({ text: t('Only http and https addresses can be opened here.'), error: true })
    setInput(target)
    setFailure('')
    if (!start) return setStart(target)
    ref.current?.loadURL(target).catch(() => {}) // failures arrive as did-fail-load
  }

  const run = async (job: (w: WebviewTag) => Promise<void>, errorText: string) => {
    const w = ref.current
    if (!w || busy) return
    setBusy(true)
    try {
      await job(w)
    } catch (err) {
      setNote({ text: `${errorText} ${(err as Error).message ?? ''}`.trim(), error: true })
    } finally {
      setBusy(false)
    }
  }

  const capture = () =>
    run(async (w) => {
      const image = await w.capturePage()
      const path = await api.browser.saveCapture(pid, image.toDataURL())
      ctx.attachToChat(t('Screenshot of {url}: @{path}', { url, path }))
      setNote({ text: t('Screenshot added to the message') })
    }, t('Could not capture the page.'))

  const readText = () =>
    run(async (w) => {
      // A hostile page can stall this promise; give up rather than leave the button busy.
      const text = String(
        (await Promise.race([
          w.executeJavaScript('document.body ? document.body.innerText : ""'),
          new Promise((_, reject) => setTimeout(() => reject(new Error(t('The page did not answer.'))), 10_000))
        ])) ?? ''
      )
      const cut = text.length > MAX_TEXT
      ctx.attachToChat(`${t('Text of {url}:', { url })}\n\n${text.slice(0, MAX_TEXT)}${cut ? '\n' + t('[truncated]') : ''}`)
      setNote({ text: t('Page text added to the message') })
    }, t('Could not read the page.'))

  const ready = !!start && !!url

  return (
    <div className={`br${docked ? ' docked' : ''}`}>
      <form className="br-bar" onSubmit={go}>
        <button type="button" className="iconbtn" disabled={!nav.back} onClick={() => ref.current?.goBack()} title={t('Back')} aria-label={t('Back')}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className="iconbtn" disabled={!nav.forward} onClick={() => ref.current?.goForward()} title={t('Forward')} aria-label={t('Forward')}>
          <ArrowRight size={14} />
        </button>
        {loading ? (
          <button type="button" className="iconbtn" onClick={() => ref.current?.stop()} title={t('Stop loading')} aria-label={t('Stop loading')}>
            <X size={14} />
          </button>
        ) : (
          <button type="button" className="iconbtn" disabled={!start} onClick={() => ref.current?.reload()} title={t('Reload')} aria-label={t('Reload')}>
            <RotateCw size={14} />
          </button>
        )}
        <label className="br-address">
          <Globe size={13} aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={t('Enter a URL')}
            aria-label={t('Address')}
            spellCheck={false}
          />
          <button type="submit" className="iconbtn br-go" title={t('Go')} aria-label={t('Go')}>
            <CornerDownLeft size={13} />
          </button>
        </label>
        <button type="button" className="iconbtn" disabled={!ready || busy} onClick={capture} title={t('Attach what the page shows')} aria-label={t('Attach what the page shows')}>
          <Camera size={15} />
        </button>
        <button type="button" className="iconbtn" disabled={!ready || busy} onClick={readText} title={t('Read page as text')} aria-label={t('Read page as text')}>
          <ScanText size={15} />
        </button>
        <button type="button" className="iconbtn" disabled={!ready} onClick={() => window.open(url, '_blank')} title={t('Open in your default browser')} aria-label={t('Open in your default browser')}>
          <ExternalLink size={14} />
        </button>
      </form>
      <div className={`br-progress${loading ? ' on' : ''}`} aria-hidden />
      <div className="br-stage">
        {/* Always mounted (blank until used) so an engine can drive the panel through the vi3ecode-browser MCP bridge. */}
        <webview
          ref={ref as unknown as Ref<HTMLWebViewElement>}
          src={start ?? 'about:blank'}
          partition="persist:vi3e-browser"
          className="br-view"
          style={start ? undefined : { visibility: 'hidden' }}
        />
        {!start || failure ? (
          <div className="br-empty">
            <span className="br-empty-ico">
              <Globe size={18} aria-hidden />
            </span>
            <div className="br-empty-title">{failure ? t('Page did not load') : t('Nothing loaded yet')}</div>
            <div className="br-empty-body">
              {failure || t('Type an address to open a page here: a dev server on localhost, docs, anything on the web.')}
            </div>
            <button className="btn small" onClick={() => go()}>
              {failure ? t('Try again') : t('Open {url}', { url: input || DEFAULT_URL })}
            </button>
          </div>
        ) : null}
        {note ? (
          <div className={`br-note${note.error ? ' error' : ''}`} role="status">
            {note.text}
          </div>
        ) : null}
      </div>
    </div>
  )
}

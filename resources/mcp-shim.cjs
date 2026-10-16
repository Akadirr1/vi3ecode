// vi3ecode browser MCP server (stdio, JSON-RPC 2.0). Started by an engine via --mcp-config with
// ELECTRON_RUN_AS_NODE=1; every tool call is forwarded to the app's loopback bridge, which drives the
// browser panel the user is looking at. Plain Node, no dependencies.
'use strict'

const BRIDGE = process.env.VI3E_BRIDGE_URL
const TOKEN = process.env.VI3E_BRIDGE_TOKEN

const str = (description) => ({ type: 'string', description })
const TOOLS = [
  { name: 'browser_navigate', description: 'Load a URL (absolute http/https) in the browser panel and wait for it to load. Returns the final URL and title.', inputSchema: { type: 'object', properties: { url: str('Absolute http(s) URL, localhost dev servers included') }, required: ['url'] } },
  { name: 'browser_url', description: 'Current URL, title and loading state of the browser panel.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_screenshot', description: 'Screenshot of what the browser panel shows, with the viewport size in CSS pixels (click coordinates use the same space).', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_get_text', description: 'Visible text of the page (or of one element), with links, buttons and inputs annotated.', inputSchema: { type: 'object', properties: { selector: str('Optional CSS selector to read only that element'), max_chars: { type: 'number', description: 'Default 20000' } } } },
  { name: 'browser_click', description: 'Click an element by CSS selector, or a point by CSS-pixel coordinates (selector wins).', inputSchema: { type: 'object', properties: { selector: str('CSS selector'), x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'browser_type', description: 'Replace the content of an input (the focused one, or `selector`) with `text`; press Enter when `submit` is true.', inputSchema: { type: 'object', properties: { text: str('Text to type'), selector: str('CSS selector of the input'), submit: { type: 'boolean' } }, required: ['text'] } },
  { name: 'browser_scroll', description: 'Scroll the page. Returns the scroll position and maximum.', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] }, amount: { type: 'number', description: 'Pixels for up/down; default one viewport' } }, required: ['direction'] } },
  { name: 'browser_back', description: 'Go back in the browser panel history.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_forward', description: 'Go forward in the browser panel history.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_reload', description: 'Reload the page in the browser panel.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_eval', description: 'Evaluate a JavaScript expression in the page and return its value as JSON.', inputSchema: { type: 'object', properties: { expression: str('JavaScript expression') }, required: ['expression'] } }
]

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

async function call(name, args) {
  if (!BRIDGE || !TOKEN) return { isError: true, content: [{ type: 'text', text: 'The vi3ecode bridge is not configured.' }] }
  try {
    const res = await fetch(`${BRIDGE}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name, args: args || {} })
    })
    return await res.json()
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `vi3ecode is not reachable: ${e.message}` }] }
  }
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // notification
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'vi3ecode-browser', version: '1.0.0' },
        instructions: 'Drives the browser panel inside vi3ecode, which the user watches live.'
      }
    })
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  if (method === 'tools/call') return send({ jsonrpc: '2.0', id, result: await call(params && params.name, params && params.arguments) })
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    handle(msg).catch((e) => msg.id !== undefined && send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e && e.message) } }))
  }
})
process.stdin.on('end', () => process.exit(0))

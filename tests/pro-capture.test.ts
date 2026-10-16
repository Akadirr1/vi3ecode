import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const { redact, redactFile, DENY_NAME } = createRequire(import.meta.url)('../tools/pro-capture/collect.cjs')

describe('pro capture masking', () => {
  it('masks secret keys and secret-looking values, keeps the rest', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'
    const out = redact({ accessToken: 'abc', user: { email: 'a@b.c' }, note: `Bearer ${'x'.repeat(20)}`, jwt, status: 'running', count: 3, paused: false })
    expect(out).toEqual({ accessToken: '[redacted]', user: { email: '[redacted]' }, note: '[redacted]', jwt: '[redacted]', status: 'running', count: 3, paused: false })
  })
  it('masks JSONL lines and never copies sensitive file names', () => {
    const buf = redactFile('activity-log.jsonl', Buffer.from('{"refreshToken":"r","kind":"turn"}\nplain ghp_' + 'a'.repeat(30) + '\n'))
    expect(buf.toString()).toBe('{"refreshToken":"[redacted]","kind":"turn"}\nplain [redacted]\n')
    for (const n of ['remote-device-key.sec1', 'offline-session-grant.json', 'browser-storage.json', 'pending-sign-in', 'credentials.json']) expect(DENY_NAME.test(n), n).toBe(true)
    expect(DENY_NAME.test('runtime-v1.json')).toBe(false)
  })
})

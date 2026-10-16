import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/store', () => ({ getSettings: () => ({ hiddenEngines: [] }) }))
const { shimScript, findOnPath } = await import('../src/main/engines')

// What `npm install -g` writes on Windows (cmd-shim), for a JS bin and for a native one.
const JS_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n`
const EXE_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`

describe('Windows npm shims', () => {
  it('finds the script or binary a cmd-shim runs', () => {
    expect(shimScript(JS_SHIM)).toBe('node_modules\\@anthropic-ai\\claude-code\\cli.js')
    expect(shimScript(EXE_SHIM)).toBe('node_modules\\opencode-ai\\bin\\opencode.exe')
    expect(shimScript('@echo off\r\nsomething.exe %*\r\n')).toBeNull()
  })
  it('never resolves a command through a relative PATH entry', () => {
    expect(findOnPath('node', { PATH: ['.', '', 'relative/bin'].join(process.platform === 'win32' ? ';' : ':') })).toBeNull()
  })
})

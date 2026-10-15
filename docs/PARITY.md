# Feature parity with vi3ecode.com

Source of truth for what is built. Features come from the public product pages
(vi3ecode.com, its changelog and interactive demo); the code here is an independent
implementation. `[x]` done and verified · `[~]` partial (see note) · `[ ]` not yet.

## Core

- [x] Desktop shell (Electron), projects = folders, data in `.vi3ecode/`
- [x] Engines: detection on PATH (login-shell PATH on macOS/Linux), show/hide, hidden engines not polled
- [x] Headless adapters: Claude Code, Codex, Gemini CLI, opencode, Cursor CLI; terminal-only: Kimi, Grok, Kiro, Cline, Command Code, Antigravity
- [ ] Chat: sessions, engine/approval/model per chat, streaming, tool chips, resume, history replay on engine switch
- [ ] Mid-run messages: queued (steering fallback)
- [ ] Mid-run steering for Claude Code (stream-json input)
- [ ] Terminal: real PTY panes, tabs, engine panes, scrollback restore
- [ ] Agent mode: named team (name, face, engine, permission), lead routes, handoff/DONE protocol, auto-handoff, hop cap, budget, files touched, one transcript
- [ ] Approval modes: read-only / supervised / auto mapped to each engine's flags
- [ ] Approval whitelist (stays auto while supervised)
- [ ] Task board: `kanban.json`, drag & drop, card → chat composer / terminal
- [ ] Notepad: `notes.json`, send to chat / terminal
- [ ] Notepad sketches + Ask AI
- [ ] Project memory: typed notes, `MEMORY.md` index, inject switch, write-back switch, search/filter, token estimate
- [ ] Memory graph view
- [ ] Activity record: live state + content-free event log, filters
- [ ] Skills: portable instruction packs installed into the project for every engine
- [ ] Plugins: marketplace with permission disclosure before install (REA built in)
- [ ] Browser panel: docked browser, capture page into a message
- [ ] Flow (beta): goals / tasks / reviews / human gates graph, per-step engine & model
- [ ] Engine usage meters where the provider reports it
- [ ] UI: Turkish + English
- [ ] UI fidelity pass against the vi3ecode demo

## Delivery

- [x] Packaging config (electron-builder): macOS dmg+zip (arm64, x64, ad-hoc signed), Windows nsis + portable, Linux AppImage
- [x] Unit tests (prompt protocol, memory, schema, engine parsers)
- [ ] CI: typecheck, tests, build; packages built on macOS + Windows runners
- [ ] Release with downloadable installers
- [ ] README (TR + EN)

## Out of scope (needs vi3ecode's servers)

Accounts and sign-in, subscriptions and payments, web dashboard, mobile app and
remote control (pairing, end-to-end encryption), auto-update.

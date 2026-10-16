# Feature parity with vi3ecode

Source of truth for what is built. Behaviour and formats come from the public product pages, the
interactive demo (the real renderer) and REA analysis of the shipped desktop builds (0.4.5); the code
here is an independent implementation. `[x]` done and verified · `[~]` partial (see note) · `[ ]` not yet.
Side-by-side details: [MAPPING.md](MAPPING.md).

## Shell

- [x] Project tabs, mode switcher (Chat / Terminal / Agent), right tool rail, dock panel, Tools dialog
- [x] Dark (default) and light themes, Inter + JetBrains Mono, lucide icons
- [x] English and Turkish UI
- [x] Engines list with install state, versions, show/hide (hidden engines are not polled), Claude usage window
- [x] OS notifications when an agent needs approval or a thread finishes (app in background)

## Chat Mode

- [x] Sessions per project (app data, not in the repo), engine · model · effort per chat
- [x] Approval menu: Ask every time / Approve edits / Full access / Read-only; AUTO-APPROVE switch
- [x] In-app approval cards (Allow / Always allow / Deny) — Claude Code stream-json control protocol
- [x] Mid-turn steering (Claude Code); queue for engines that cannot steer
- [x] Token streaming, "N steps" with tool arguments, time / cost / engine footer, markdown
- [x] History replay when switching engines; resume with the engine's own session id
- [~] Codex approvals and steering: Codex runs through `codex exec` (sandboxed); the original uses `codex app-server`
- [ ] Voice input, chat compare / archive / export, auto engine routing

## Agent Mode

- [x] Project team in `.vi3ecode/agents.json` (same fields as vi3ecode), Lead + Analyst + Developer + QA + Designer
- [x] Team dialog: pixel portraits / glyphs, colour, engine · model · effort, permission (Read-only / Ask / Edits / Full), instructions, "can hand off to", start-from presets
- [x] Protocol lines `@handoff id[, id]: brief`, `@done: summary`, `@ask-user: …`; parallel waves (run in order, results back to the issuer)
- [x] Auto-relay, Return to Lead, hop limit, budget (turns / USD), AUTO-APPROVE, per-agent resumed sessions
- [x] Messages into a running thread (steer the working agent or address @Agent), approval cards, question cards
- [x] Global agents library (app level)
- [ ] Supervision turns, plan mode, worktrees per agent, parallel copies (`dev~2`), pause agent

## Terminal Mode

- [x] Real PTY panes (xterm.js + node-pty), 1 / 2 / 2×2 layouts, tab strip for more
- [x] Engine panes with model / effort flags, status badges, restart, settings
- [x] Memory brief injected into Claude panes (`--append-system-prompt-file`)
- [ ] Larger layout presets, per-pane mic / bell, restoring panes after restart

## Around the agent

- [x] Project memory: typed notes in `.vi3ecode/memory/entries/`, `MEMORY.md` + `index.json`, `[[links]]`, graph, inject switch, write-back via `MEMORY_WRITE {json}` lines
- [x] Kanban (`kanban.json`, flat cards with `columnId`), drag & drop, assignee, card → chat / terminal
- [x] Notepad (`notes.json`) with sketches and Ask AI
- [x] Explorer (tree + preview), Git (status, diff, stage, commit, AI commit message, history)
- [x] Browser panel + `vi3ecode-browser` MCP server (navigate, read, screenshot, click, type, scroll …) for engines
- [x] Guardrails: four built-in rules (database, file deletion, git, system) always ask, even under Full access (Flow steps cannot ask: a match is denied)
- [x] Full access / auto-approve from a cloned repo's `agents.json` or flows count only after you save them on this machine
- [x] Skills (`.vi3ecode/skills`, installed into `.claude/skills`, `.opencode/skill`, `AGENTS.md` block)
- [x] Plugins with declared permissions before activation; REA built in (MCP handed to Claude Code)
- [x] Flow (beta): task / review / human-gate steps with per-step engine and model
- [x] Activity record: content-free, local, filters

## Delivery

- [x] macOS (dmg + zip, arm64 + x64, ad-hoc signed), Windows (installer + portable), Linux (AppImage) built by GitHub Actions
- [x] Unit tests, typecheck, build in CI
- [x] README (TR + EN)

## Out of scope (needs vi3ecode's servers)

Accounts and sign-in, subscriptions and payments, cloud sync, web dashboard, mobile app and remote
control (pairing, end-to-end encryption), Bot Mode, Canvas / Work / Deploy / Marketing / Graph
workspaces, auto-update.

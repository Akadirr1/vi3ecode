# vi3ecode

Kullandığın kodlama ajanları (Claude Code, Codex, Gemini CLI, opencode, Cursor…) için masaüstü
çalışma alanı: ajan takımı, sohbet, gerçek terminal, proje hafızası, görev panosu, not defteri,
git, tarayıcı paneli, skill'ler, eklentiler ve Flow — hepsi bir arada.

_English below._

## İndir

GitHub Actions her push'ta macOS (`.dmg`, Apple Silicon + Intel), Windows (`setup.exe` +
taşınabilir `.exe`) ve Linux (`.AppImage`) paketlerini üretir:
**Actions → build → son çalıştırma → Artifacts**. `v*` etiketi atılınca aynı dosyalar bir
GitHub Release'e de eklenir.

Uygulama henüz imzalı değil:
- **macOS:** ilk açılışta uygulamaya sağ tıklayıp **Aç** de (veya
  `xattr -cr /Applications/vi3ecode.app`).
- **Windows:** SmartScreen uyarısında **Ek bilgi → Yine de çalıştır**.

## Başlarken

1. Kullandığın CLI'ları kur ve bir kez giriş yap (ör. `npm i -g @anthropic-ai/claude-code`,
   sonra `claude`). vi3ecode hiçbir parola ya da token görmez; her motor kendi hesabıyla çalışır.
2. vi3ecode'u aç → **Klasör aç**. Klasör bir proje olur; pano, notlar, hafıza, takım ve skill'ler
   `.vi3ecode/` altında durur ve commit'lerinle birlikte gider.
3. **Chat Mode** ile sohbet et, **Terminal Mode** ile gerçek terminal ya da motor paneli aç,
   **Agent Mode** ile hedefi takıma ver.

## Özellikler

| Alan | Ne yapar |
|---|---|
| Agent Mode | Lead, Analyst, Developer, QA, Designer… tek konu, tek transkript. Her tur `HANDOFF: <ajan> — <not>` ya da `DONE: <özet>` ile biter; auto-relay, hop limiti, tur/USD bütçesi, izin verilen devir hedefleri, "Return to Lead", çalışırken ajana mesaj. Avatar seçici (12 portre + 12 piksel glif), renk, motor·model·efor, izin seviyesi (Read-only / Ask / Edits / Full). |
| Chat Mode | Motor·model·efor seçimi, onay modları (Ask every time / Approve edits / Full access / Read-only), AUTO-APPROVE, uygulama içi onay kartları, çalışan turu yönlendirme (Claude Code), diğer motorlarda kuyruk. |
| Terminal Mode | Gerçek PTY panelleri (xterm.js), 1/2/4 düzen, motor panelleri (model/efor bayraklarıyla), proje hafızasını Claude paneline enjekte etme. |
| Hafıza | `.vi3ecode/memory/*.md` tipli notlar (fact, decision, pattern, context, lesson, warning, todo, reference), `MEMORY.md` dizini, `[[bağlantılar]]`, grafik, sohbetlere enjekte ve ajanların geri yazması. |
| Pano / Not defteri | `kanban.json` (sürükle-bırak, atanan ajan, sohbete/terminale gönder), `notes.json` (eskiz + Ask AI). |
| Explorer / Git / Tarayıcı | Dosya ağacı ve önizleme; durum, diff, stage, commit (AI commit mesajı); yan panelde tarayıcı, ekran görüntüsünü mesaja ekleme. |
| Skill'ler / Eklentiler / Flow | Taşınabilir talimat paketleri (`.claude/skills`, `.opencode/skill`, `AGENTS.md`), izinleri baştan beyan eden eklentiler (REA dahil), adım/inceleme/insan onayı içeren Flow. |
| Aktivite | Ne çalıştı ve nasıl bitti — konuşma, araç argümanı, dosya içeriği tutmaz; makineden çıkmaz. |

Ayrıntılı eşleştirme: [docs/MAPPING.md](docs/MAPPING.md) · durum listesi: [docs/PARITY.md](docs/PARITY.md).

## Geliştirme

```bash
npm ci
npm run dev        # canlı yeniden yükleme ile uygulama
npm test           # birim testleri (vitest)
npm run typecheck
npm run dist       # bulunduğun işletim sistemi için paket (release/)
```

Yığın: Electron 44, electron-vite, React 19, TypeScript, xterm.js + node-pty, lucide ikonları,
Inter ve JetBrains Mono (OFL).

---

## English

A desktop workspace for the coding-agent CLIs you already use: an agent team that hands work
from agent to agent in one transcript, chat with approvals and mid-turn steering, real terminal
panes, project memory, task board, notepad with sketches, git, a browser panel, skills, plugins
(REA built in) and Flow.

Downloads come from **Actions → build → Artifacts** (macOS dmg, Windows installer/portable,
Linux AppImage). Builds are unsigned: right-click → Open on macOS, "Run anyway" on Windows.

Development: `npm ci && npm run dev`; tests `npm test`; packages `npm run dist`.

License: MIT.

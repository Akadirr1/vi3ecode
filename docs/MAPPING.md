# vi3ecode eşleştirme tablosu: "orijinalde böyleydi, bizde böyle"

Bu belge proje sonu envanteridir. Sol taraf orijinal vi3ecode masaüstü uygulamasının **analizden çıkan**
davranışı, sağ taraf bu repodaki **kodda gördüğüm** karşılığıdır. Kodda görmediğim hiçbir şeyi "var" diye
yazmadım; emin olmadığım yerde "doğrulanmadı" diyorum.

## 1. Ne incelendi, ne yaptık, hangi kurala uyduk

**İncelenen (orijinal).** İki katman, ikisi de REA ile (araştırma klasörü: `research/`):
1. Herkese açık demo renderer'ı (gerçek masaüstü arayüzü, sahte Tauri arka ucuyla): 335 `invoke` komutu,
   33 olay (`rea-and-stack §3.4`, `tauri-ipc-surface.json`).
2. Gerçek masaüstü binary'leri, sürüm 0.4.5: Linux AppImage içindeki ELF (80,7 MB,
   `ev_47c4100207…`) ve Windows NSIS kurulumundaki PE (98 MB, `ev_150063800d…`); salt okuma, hiçbiri
   çalıştırılmadı (`binary-report §0`). `rea-and-stack §0` ilk turu anlatır (binary o turda açılamamıştı);
   binary bulguları sonraki turdan, yani `binary-report`'tan gelir.
3. Site, changelog ve demo spesifikasyonu (`product-spec`), motor CLI sözleşmeleri (`engine-clis`).

**Yaptığımız.** Electron 44 + React 19 + TypeScript uygulaması, sürüm 0.1.0 (`package.json`). 11 motor
tanımı, 3 mod (Chat, Terminal, Agent), 11 proje aracı, tamamen yerel. `npm run typecheck` temiz,
`vitest` 12 dosya / 70 test yeşil (bu belgeyi yazarken çalıştırıldı).

**Uyduğumuz kural.** Davranış ve dosya biçimleri yeniden üretildi; vi3ecode kodu, görseli ya da uzun metni
kopyalanmadı. Avatarlar bizim piksel çizimimiz (`components/Avatar.tsx`, görsel dosya yok), istem
(prompt) metinleri bizim cümlelerimiz, guardrail regex'leri bizim. Birebir aynı olan yalnızca birlikte
çalışabilirlik için gereken kısa kimlikler: dosya yolları, marker satırları (`<!-- vi3ecode:skills:begin -->`),
`@handoff/@done/@ask-user` söz dizimi, `MEMORY_WRITE`, MCP sunucu adları.

**Kanıt kısaltmaları.** `bin §n` = `rea-bin/binary-report.md`, `rea §n` = `rea-and-stack.md`,
`spec §n` = `product-spec.md`, `cli §n` = `engine-clis.md`, `shots/x.png` = `research/shots/demo/x.png`.
Bizdeki kanıt = dosya yolu (testler `tests/*.test.ts`).

**Durum işaretleri.** ✅ aynı · ≈ benzer (farkı yazılı) · ➖ yok (nedeni yazılı).

---

## 2. Mimari

| Konu | vi3ecode'da | Bizde |
|---|---|---|
| Kabuk | Tauri 2.11.6 + wry + Rust; WebKitGTK/WebView2/WKWebView; 175 crate; `portable-pty`, `rusqlite`, `keyring`, `notify` (`bin §1`) | Electron 44, Node ana süreç (`src/main/*`), `node-pty`, Chromium. `contextIsolation`, `sandbox`, `nodeIntegration:false`; `<webview>` yetkileri `will-attach-webview` ile kırpılır (`src/main/index.ts`) |
| Renderer | React + Vite, Radix, zustand, zod, immer, sonner, xterm.js, mermaid, katex, cytoscape, 3B pet (`rea §2.3`) | React 19 + Vite (electron-vite), lucide, xterm.js + fit addon, react-markdown + remark-gfm. Durum için `useSyncExternalStore` ve context; kendi CSS token'larımız. mermaid/katex/pet yok |
| IPC | Tauri `invoke`: 335 komut, 33 olay | `window.api`: 17 isim alanı, yaklaşık 65 çağrı, kanal `${ns}:${yöntem}` (`ipc.ts`, `preload/index.ts`, sözleşme `shared/types.ts`). Olaylar: `chat:session`, `team:run`, `flows:run`, `pty:data`, `pty:exit`, `browser:open` |
| Depolama (proje) | `.vi3ecode/` (git'e girer): `agents.json`, `kanban.json`, `notes.json`, `memory/`, `skills/`… (`bin §7.1`) | Aynı klasör, bölüm 15'teki biçimlerle |
| Depolama (uygulama) | App-data: `projects.json`, `settings/`, oturum klasörleri, `agents/runtime-v1.json`, tek SQLite `bots.sqlite3`, yenileme token'ı OS keychain'de (`bin §7.2`) | `userData/`: `state.json` (projeler + ayarlar), `chats/<id>.json`, `team-runs/<id>.json`, `flow-runs/<id>.json`, `activity.jsonl`, `plugin-consent.json`, `trusted-settings.json`, `bridge-token`, `agents/global-agents.json`. SQLite yok, keychain yok (saklanan sır yok) |
| Motor yönetimi | Tek `DirectChatManager`; Codex app-server ve ACP oturumları "park" edilir, ısınmış havuz (`bin §2.2`) | Claude: sohbet/ajan başına süreç (`ClaudeSession`); diğerleri: tur başına bir süreç (`runner.ts`). Havuz yok |
| Bulut | `api.vi3ecode.com`: oturum, yetki, **ajan yönlendirme kararı**, senkron, ödeme (`bin §1`) | Yok. Hiçbir vi3ecode sunucusuna bağlanmaz; ağ trafiği yalnızca motor CLI'larının ve eklentilerin kendisi |
| Paket / güncelleme | Tauri NSIS + AppImage + universal dmg; minisign imzalı updater (`latest-linux.json`) | electron-builder: dmg+zip (arm64/x64, ad-hoc imza), NSIS + portable, AppImage. `.github/workflows/build.yml`: `check` (typecheck+test+build) → 3 işletim sistemi `package`, her paketlenmiş uygulama açılıp denenir (`scripts/smoke.cjs`: pencere, IPC, gerçek PTY, ekran görüntüsü artifact'ı) → `v*` etiketinde `release` (prerelease). İmzasız, otomatik güncelleme yok |
| Uygulamanın kendi bayrakları | `--app-mcp-shim --bridge-file`, `--instance`, `--qa` (`bin §1`) | `resources/mcp-shim.cjs`, `ELECTRON_RUN_AS_NODE=1` ile çalışan ayrı betik; instance/qa bayrağı yok |

---

## 3. Kabuk ve arayüz

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Proje sekmeleri | Klasör = proje, üstte sekmeler, gizli sekme (Ctrl/Cmd+Shift+N) | `TopBar`: açık projeler `settings.openProjects` sırasıyla sekme; açma/kapama. Gizli sekme yok | ≈ | `spec §2.1`, `shots/m01-chat-mode.png`; `shell/TopBar.tsx` |
| Mod değiştirici | Chat, Terminal, Agent hep açık; Bot/Work/Lab/Marketing/Deploy/Graph deneysel | Chat, Terminal, Agent (`Sidebar.tsx` `MODES`). Diğerleri bölüm 14'te | ≈ | `bin §11`; `shell/Sidebar.tsx` |
| Sol sütun | Mod bölümü, katlanır Engines listesi (kota rozeti), hesap satırı | Aynı iskelet: "New chat/Agent team" + "Tools", Engines (kurulu sayısı, Claude kota rozeti), "Local workspace" satırı + ayar dişlisi | ≈ | `shots/c1-approval-dd.png`; `Sidebar.tsx` |
| Sağ ray + dock | Explorer, Browser, Processes, Terminal, Git, Kanban, Notepad, Flow… sağ rayda; araç yanda açılır | Ray: Explorer, Browser, Git, Kanban, Notepad, Memory, Flow, Skills, Plugins, Activity. Dock'ta açılır, "ana alanda aç" düğmesi var. Global agents yalnız Tools penceresinde | ≈ | `Rail.tsx`, `ToolView.tsx` |
| Tools penceresi | "Reach build flows, project context and extensions" | Aynı pencere, 3 grup (Create and run / Project context / Look around); grup adları bizim | ≈ | `shots/a01-tools.png`; `ToolsModal.tsx` |
| Temalar | Light / Dark / System | `data-theme` + `prefers-color-scheme`, token'lı CSS. Renk değerleri yaklaşık (`spec §5`), birebir değil | ✅ | `styles.css`, `App.tsx` |
| Yazı tipleri | Inter + JetBrains Mono (OFL) | `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` (paketle gelir, ağ gerekmez) | ✅ | `spec §0.3`; `main.tsx` |
| Dil (en/tr) | `en` + `tr`, `navigator.language` ile seçilir (`rea §2.1`) | `t()` + `i18n.tr.json` (~600 anahtar), dil Ayarlar'dan seçilir, ilk açılışta sistem dili izlenmez. Koddaki 528 sabit `t('…')` metninin hepsi sözlükte (betikle sayıldı, 0 eksik); değişkenle kurulan metinler sayılmadı | ✅ | `i18n.ts`, `i18n.tr.json` |
| Ayarlar | ~20 sayfa: Workspace, AI, Safety, Account, Integrations, Labs…; `/` ile arama (`bin §11`) | 5 sayfa: General, Engines, Memory, Projects, About. `guardrails` ve `browserTools` için General'da anahtar var (varsayılan açık) | ≈ | `shell/SettingsModal.tsx`, `shared/schema.ts` |
| Klavye kısayolları | Ctrl+Shift+H (hafızaya kaydet), Alt+↑/↓, `/` | Yalnız Enter / Esc / Ctrl+Enter (commit) | ➖ | `bin §11`. Kullanıcı isteği çıkmadı, sonraya |
| Bildirimler | Bildirim merkezi, masaüstü bildirimi, per-pane zil | OS bildirimi, uygulama arka plandayken: onay bekliyor, thread bitti, flow bitti/bekliyor. Merkez yok | ≈ | `events.ts` `notify()` |
| Karşılama / dashboard | Ana sayfa: selam, son projeler, motor kullanımı | Proje yokken karşılama + son projeler listesi | ≈ | `App.tsx` `Welcome` |
| Quick launch, pop-out widget, pet, güvenlik skoru | Var | Yok. Çoklu pencere ve 3B asset gerektirir, çekirdek iş değil | ➖ | `bin §11` |

## 4. Chat Mode

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Motorlar | Claude (stream-json), Codex (app-server), ACP (Kimi/Cursor/Grok/Cline), opencode, Command Code, agy | Claude kalıcı süreç; Codex, Gemini, opencode, Cursor tur başına süreç. Diğer 6 motor yalnız terminal | ≈ | `bin §2`; `engines/*.ts`; bölüm 7 |
| Oturum kalıcılığı | Oturum klasörü: `session.json`, `chat-history.jsonl`, `native-session.json` | `userData/chats/<id>.json` (mesajlar + `engineSessionId`). Yeniden başlatmada çalışan tur `stopped` olur. Motor değişince geçmiş prompt'a yeniden yazılır (`withHistory`, 12 000 karakter) | ≈ | `bin §2.2`; `chat.ts`, `shared/prompt.ts` |
| Onay modları | Ask every time / Approve edits / Full access (+ Read-only/Plan) | 4 mod, aynı etiketler. Menüde 4 seçenek (orijinal demoda 3: `shots/c1-approval-dd.png`). Eşleme (Ask / Edits / Full / Read-only): Claude `manual` / `acceptEdits` / `bypassPermissions` / `dontAsk`; Codex `-s workspace-write` / `-s workspace-write` / bypass / `-s read-only`; Gemini `default` / `auto_edit` / `yolo` / `plan`; opencode varsayılan / varsayılan / `--auto` / `plan` ajanı. Gerçek "Ask" yalnız Claude'da (diğerleri soramaz, Codex'te `ask` = `edits`, sandbox'ta) | ≈ | `bin §2.2`, `cli §0.3`; `SettingsModal.tsx` `MAPPING`, `claudeSession.ts` `MODE` |
| "Approve edits" nasıl | Motor modu değil, uygulama düzenleme araçlarını kendi onaylar (`bin §2.3`) | Claude'un kendi `acceptEdits` modu | ≈ | `claudeSession.ts` |
| AUTO-APPROVE | Anahtar + ilk açılışta uyarı; read-only/plan genişlemez; guardrail'leri atlar | Anahtar + tek seferlik uyarı (`localStorage`); read-only genişlemez. **Guardrail'leri atlamaz** (bilinçli, bölüm 13) | ≈ | `shots/c4-autoapprove.png`; `chat/Composer.tsx`, `chat.ts` `onPermission` |
| Mid-turn steering | Claude: stdin'e mesaj; Codex: `turn/steer`; "Steer while busy" ayarı | Claude: çalışan sürece stream-json mesajı, `--replay-user-messages`, mesaj `steered` rozeti. Diğerleri kuyruk. Ayar yok | ≈ | `bin §2.3`; `claudeSession.ts` `send`, `chat.ts` `send` |
| Mesaj kuyruğu | Composer üstünde panel, Tab ile kuyruk, düzenlenebilir; Stop kuyruğu composer'a iade eder | Meşgulken yazılan mesaj `queued` rozetiyle durur, tur bitince kendiliğinden gider. Düzenleme yok; Stop kuyruğu `stopped` yapar | ≈ | `bin §4.3`; `chat.ts` `queues` |
| Onay kartları | Tüm girdi + bağlam, Onayla/Reddet, "bir daha sorma" | Araç + tek satır ayrıntı (komut/dosya/URL), **Deny / Always allow / Allow**; "Always allow" CLI'nin `permission_suggestions`'ını geri yollar. Bildirim var. "n onay bekliyor" paneli yok | ≈ | `bin §2.3`; `chat/ChatMain.tsx`, `claudeSession.ts` `respond` |
| Model / efor seçici | Provider/Model/Effort satırları, Auto, Profiles, hesaptan model listesi | Aynı üç satır + serbest model kimliği. Statik alias listeleri; Auto/Profiles/service tier yok | ≈ | `shots/c2-model-dd.png`; `chat/Composer.tsx` `EnginePicker` |
| Maliyet / süre altbilgisi | Süre, maliyet, motor·model | Süre + `$` (motor bildirirse: Claude, opencode) + motor·model. Codex/Gemini/Cursor maliyet vermez, katalogdan fiyatlama yok | ≈ | `bin §2.2`; `ChatMain.tsx` `Message` |
| Adım kartları | Fiil (Reading/Editing…), araç adımları, dosya kartları | "N steps" katlanır liste, araç adına göre ikon; çalışırken fiil ("Editing…") | ≈ | `spec §3.4`; `ChatMain.tsx` `Steps` |
| Markdown | react-markdown, mermaid, katex | react-markdown + GFM; mermaid/katex yok | ≈ | `components/Prose.tsx` |
| Kota göstergesi | Claude (`rate_limit_event`+`/usage`), Codex, Kimi, opencode Go | Yalnız Claude `rate_limit_event` → motor listesinde rozet | ≈ | `bin §2.3`; `engines/index.ts` `setUsage` |
| `+` menüsü | Dosya/klasör, araçlar, görsel yapıştırma, ekran görüntüsü | `@yol` ekleme (motor dosyayı kendi okur); tarayıcı ekran görüntüsü Browser panelinden gelir. Görsel ekleme yok | ≈ | `shots/c3-plus-menu.png`; `chat/Composer.tsx` `PlusMenu` |
| Çalışma modları Build/Plan/Goal, Worktree seçici | Composer'da "Bu mesajın nasıl çalışacağını seç"; Plan salt okunur analiz + plan; Claude/Codex: Build/Plan/Goal, Cursor/Antigravity: Build/Plan | Composer'da aynı etiketlerle Build/Plan (Claude, Codex, Cursor). Plan turu salt okunur çalışır (Claude: `dontAsk` + yazma araçları kapalı; Codex `-s read-only`; Cursor yalnız talimatla), plandan sonraki ilk Build turuna "plan mode has ended" notu eklenir. Goal yok. Worktree bölüm 5'te | ≈ | `bundle/en-dict` `sessionChat.workspace.runMode`; `shared/runMode.ts`, `chat/Composer.tsx` `RunModeMenu`, `chat.ts` `approvalFor` |
| Thread listesi | Sabitleme, arşiv, dışa aktarma, karşılaştırma, gruplama | Liste + silme; başlık tıklanınca yeniden adlandırma. Pin/arşiv/arama yok | ≈ | `ChatSidebar.tsx` |
| Direct Chat (projesiz), sohbeti dallandırma (Codex fork), özetleme | Var | Yok. Sohbet projeye bağlı | ➖ | `bin §2.4` |
| Dikte, Voice Chat | Var | Yok (bölüm 14) | ➖ | |

## 5. Agent Mode

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Takım dosyası | `.vi3ecode/agents.json`: `version, name?, projectId, updatedAt, agents[], settings` | Aynı yol, aynı alan adları. Okurken eski `team.json`'ı da kabul eder. Yazarken dosyadaki bilmediğimiz alanlar (`name`, `tools`, `serviceTier`…) korunur; `paused` hep yazılır, `instanceCount` yalnız 1'den büyükse (Lead'de hiç); takımda `supervision:true`, `maxSupervisionTurns:12` varsayılan. Ekstra `lead:true` alanı bizim | ≈ | `bin §4.2`, `spec §4.4`; `shared/formats.ts` `teamToDisk`; `tests/formats.test.ts` |
| Ajan alanları | `id` (`^[a-z0-9][a-z0-9-]{0,31}$`), `name` ≤60, `role` ≤80, `description` ≤4000, `prompt` ≤8000, `serviceTier`, `tools[]`, `paused`, `instanceCount` 1–8 | `id` daha gevşek (`^[\w-]{1,64}$`), `name` ≤40, `role` ≤60, `description` ≤300, `instructions` ≤4000. `paused` ve `instanceCount` 1–8 (Lead hep 1) okunur ve yazılır; `serviceTier`, `tools` düzenlenmez ama korunur | ≈ | `bin §4.2`; `shared/schema.ts` `sanitizeTeam` |
| Avatar / sprite | 12 portre + 12 glif, `sprite: "portrait-03"` | 12 + 12, dosyada aynı adlandırma (`portrait-04`, 1'den başlar); çizimler bizim, kodla üretilen piksel sanat | ✅ ad / ≈ görsel | `formats.ts` `spriteToDisk`; `Avatar.tsx`, `AvatarPicker.tsx` |
| İzin seviyeleri | `readOnly / ask / edits / full`, motorun kendi bayraklarıyla, desteklemeyen motor "bir basamak iner" | Aynı dört seviye (dosyada `readOnly`). Claude: `dontAsk` + düzenleme araçları kapalı; Codex `-s read-only`; Gemini `plan`; opencode `plan` ajanı; Cursor yalnız talimatla (bayrak yok). Uygulama düzeyinde "reddet" ve "iner" rozeti yok | ≈ | `bin §4.3`; `engines/*.ts`, `cursor.ts` |
| Protokol satırı | Yanıtın son satırı: `@handoff <id>[, <id>]: özet`, `@done: özet`, `@ask-user: {json}`; kopya `dev~2` | Aynı üç satır. Son 15 satırda arar; `dev` rolün tüm kopyalarına, `dev~2` yalnız o kopyaya gider (`dev~1` = `dev`); eski `HANDOFF:/DONE:` satırlarını da okur. Metinleri bizim | ✅ | `bin §4.4`; `shared/prompt.ts` `parseTurnEnd`; `tests/prompt.test.ts` |
| `@ask-user` | Soru kartları (1–4 soru, seçenekler, çoklu seçim) | Soru metne düzleştirilir ("seçenek / seçenek"), kullanıcı bir mesajla yanıtlar; kart/seçenek düğmesi yok | ≈ | `prompt.ts` `askText`; `Transcript.tsx` `Banner` |
| Paralel dalga | Tek yazar kuralı: okuyucular paralel, yazıcılar sıralı; sonuç tek özet olarak döner | `@handoff a, b:` dalga başlatır ama üyeler **sırayla** çalışır; son üye bitince sonuç veren ajana döner. Dalga orijinal gibi bir hop gidiş, bir hop dönüş sayılır. Gerçek eşzamanlılık ve tek yazar denetimi yok (sıralı olduğu için yazarlar zaten sırayla çalışır) | ≈ | `bin §4.3`; `team.ts` `state.wave` |
| Lead'e dönüş | Protokol satırsız tur Lead'e döner; Lead'e bir kez yeniden sorulur (`protocolRepair`) | `returnToLead`: belirsiz bitiş, bilinmeyen/izinsiz hedef, takım üyesinin `@done`'ı Lead'e döner. Lead satırsız bitirirse **bekler** (yeniden sorma yok). Düzeltme kartı yok, Lead'e not düşer | ≈ | `bin §4.4`; `prompt.ts` `decideNext` |
| Hop sınırı | `maxAutoRelayHops` 1–50, varsayılan 12 | Aynı (1–50, 12); dolunca `hop-cap` durumu, "Continue" yeni bir etap | ✅ | `schema.ts`, `team.ts` `runNext` |
| Bütçe | `budget.maxTurns` 1–1000, `maxCostUsd`; yalnız fiyatlı turlar sayılır | `turns` 0–500, `usd` 0–1000 (0 = sınırsız), etap başına; maliyet yalnız motor bildirirse sayılır. Dolunca `budget` durumu | ≈ | `bin §4.2`; `team.ts` |
| Auto-relay | Kapalıysa devirler onay bekler | Kapalıysa `waiting`; sıradaki ajan seçilip "Continue" | ✅ | `team.ts`, `agent/Transcript.tsx` `Banner` |
| Auto-approve | Onayları kendiliğinden verir; guardrail atlanır; read-only genişlemez | Onayları verir; read-only genişlemez; **guardrail eşleşmesi yine kart açar** | ≈ | `team.ts` `onPermission` |
| Ajan başına oturum | Ajan ve kopya başına motor oturumu, `--resume`; kalıcı (`runtime-v1.json`, `native-session.json`) | Claude/opencode/Codex/Cursor için ajan başına `resumeId`, sonraki turda yalnız "THREAD'de yeni olanlar" gider. Oturum kimlikleri **yalnız bellekte**; uygulama kapanınca yeniden kurulan thread tam bağlamla başlar | ≈ | `bin §4.3`; `team.ts` `state.sessions` |
| Tur mesajı | THREAD SO FAR / NEW IN THE THREAD…, 180 000 bayt bütçe, eski satırlar `(... N older line(s) dropped)` | Aynı iskelet; bütçe 60 000 karakter, satır başına 8 000; aynı "dropped" işareti | ≈ | `bin §4.4`; `prompt.ts` `threadLines` |
| Yönlendirme kararı | Sunucuda: `agent-coordination/decide`, imzalı; çevrimdışı ajan başlamaz | **Yerel**, saf fonksiyon `decideNext` + testler. Giriş yapmadan, çevrimdışı çalışır | ≈ | `bin §4.1, §12`; `prompt.ts`; `tests/prompt.test.ts` |
| Kullanıcı mesajı (çalışırken) | Çalışan ajana enjekte (Claude stdin, Codex steer), boştaki ajana "aside" | `to:` çipleri. Çalışan Claude turuna steer edilir; başka hedefe yazılırsa o ajan sıradaki olur. "Aside" (yönlendirmeyi bozmadan yan soru) yok | ≈ | `bin §4.3`; `team.ts` `send`; `agent/Composer.tsx` |
| Denetim (supervision) | `@steer/@stop/@retry/@reassign/@spawn/@watch/@ok` satırları, sınır 12 tur | Yok. Alan dosyaya sabit değerle yazılır ama motor yok | ➖ | `bin §4.4`. Ayrı bir orkestratör turu ve zamanlayıcı gerekir |
| Plan modu | Planlayıcı ajan, fazlar, senkron/asenkron, sorular paneli | Yok | ➖ | `bin §4.3` |
| Worktree izolasyonu, paralel geliştirici kopyaları | Thread başına `work/<ad>` dalı, 0–4 yazar şeridi, birleştirme; rol başına 1–8 kopya (`instanceCount`, `dev~2`) | Kopyalar var: Takım penceresinde «Parallel copies», composer'da `@Developer ×2` ve `#1 #2`; bir role yapılan devir ya da mesaj tüm kopyalara dalga olarak gider. Worktree thread başına: composer'da «bu branch'te / izole worktree»; izole thread `<repo>-vi3ecode-worktrees/<ad>` altında `work/<ad>` dalında çalışır, başlıkta Fark / Birleştir / klasörü göster / sil, listede dal adı. Birleştir kalan değişiklikleri commit'leyip `--no-ff` merge eder, hata olursa merge'ü geri alır; Sil commit'lenmemiş ya da birleşmemiş iş varsa sorar. Bir thread içindeki dalgalar yine sıralı (yazar şeritleri yok). Çalışan bir thread'de role yazılan mesaj yalnız ilk kopyaya gider | ≈ | `bin §4.3`; `shared/prompt.ts` `copiesOf`, `reach`; `main/worktree.ts`, `agent/WorktreeBar.tsx`; `tests/worktree.test.ts`. Open PR ve paralel yazar şeritleri yok |
| Global agents | Takımlar kütüphanede aynalanır, projeye bağlanır, kütüphane ajanında `handoffs` yok | `GlobalsTool`: takımı kaydet / projeye uygula / sil, `userData/agents/global-agents.json`, kaydederken `handoffs` temizlenir (50 giriş sınırı). Bağlantı/ayna/çakışma kuralları yok | ≈ | `bin §4.2`; `team.ts` `globalsApi`, `tools/GlobalsTool.tsx` |
| Okuma-yalnız reddi akışı | "Enable edits and continue", geri sayımlı otomatik red | Read-only ajan motor katmanında engellenir (yazamaz); özel akış yok | ➖ | `bin §4.4` |
| Kullanım sınırı bekleme / devam | Reset zamanlı kart, yerel devam (`agent_limit_resume_*`) | Yok; hata satırı + "Retry" | ➖ | `bin §4.3` |
| Dosya değişiklikleri | Thread'de dosya kartları | Tur öncesi/sonrası `git status` farkı + motorun bildirdiği dosyalar, tur kartında liste | ✅ | `team.ts`, `Transcript.tsx` |
| Ekran / kart dili | Capsule, handoff kartı, adım kartı, onay kartı, takım penceresi | Aynı kart ailesi: capsule, handoff, "N steps", onay, "Done:", soru bandı, durdu/hop/bütçe bandı. Takım penceresi: ajan düzenle, yeni ajan (şablonlardan), Lead yap, devir izinleri, yönlendirme + bütçe, "reset team" | ≈ | `shots/m03-agent-mode.png`, `m04-new-agent-team.png`, `a02-define-agent.png`, `a03-manage-team.png`, `a04-agent-dblclick.png`, `a05-thread-team-btn.png`, `n1-fixbug-preset.png`; `modes/agent/*` |
| Varsayılan takım | lead(readOnly) / analyst / dev / qa / designer | Aynı beş rol, aynı izin dağılımı; talimat metinleri bizim | ≈ | `spec §3.3.3`; `schema.ts` `DEFAULT_TEAM` |
| AI takım kurucu, optimizer, native alt-ajanlar, çoklu görünüm (Tree/Orchestrator) | Var | Yok | ➖ | `bin §4.2` |

## 6. Terminal Mode

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Gerçek PTY panelleri | `portable-pty`, xterm.js (WebGL) | `node-pty` + xterm.js + fit addon (WebGL yok); yeniden bağlanınca 256 KB'lık tampon (`attach`) geri çizilir | ≈ | `bin §1`; `main/pty.ts`, `modes/terminal/xterm.ts` |
| Izgara | Hazır 2x3…3x4 ve özel; 12 panele kadar | 1 / 2 sütun / 2×2 düzen; fazlası sekme şeridinde sayfalanır | ≈ | `spec §3.5`; `TerminalMain.tsx` `LAYOUTS` |
| Pane başlığı | Motor adı, durum çipi, model ve efor çipi; ayar, mikrofon, zil, reset | Motor ikonu + ad, durum rozeti (ready/busy/exited; çıktı zamanlamasından çıkarılır), model ve efor çipleri, "Pane settings" (sağlayıcı/model/efor değişince yeniden başlar), Restart, Close. Mikrofon ve zil yok | ≈ | `shots/m02-terminal-mode.png`; `Pane.tsx`, `PaneForm.tsx` |
| Motor bayrakları | `--model`, `--effort`; codex `--no-alt-screen -m -c model_reasoning_effort`; cline `--auto-approve false`; kiro `chat` | Aynı bayraklar. Eksik: `resume`, Kimi efor env'i, Codex service tier, terminal "bypass" anahtarları | ≈ | `rea §3.5`; `pty.ts` `engineArgs`; `tests/pty.test.ts` |
| Hafıza enjeksiyonu | `injectMemory`: `.claude/CLAUDE.md` yönetilen blok + `engine-inject/*.md` | Yalnız Claude: brief `.vi3ecode/engine-inject/claude.md`'ye yazılır (klasör `.gitignore`'lı, her açılışta yenilenir), `--append-system-prompt-file` ile verilir. Diğer motorlara enjeksiyon yok | ≈ | `bin §5.2`; `pty.ts` `engineLaunch` |
| Guardrail | Claude ailesinde PreToolUse hook'u (`bin §10.3`); yayımlı doküman "terminali kapsamaz" der | Yok | ➖ | `bin §10.3`, `spec §3.6` |
| Kalıcılık | `terminal-layout.json`, `terminal-scrollback/`, motor oturumu uygulama kapanınca dönüşür | Paneller ana süreçte yaşar (görünüm değişince korunur); uygulama kapanınca biter. Yalnız düzen boyutu `localStorage`'da | ➖ | `spec §3.5`; `pty.ts` `killAllPtys` |
| Sol sütun | Global agents, Workspace: Explorer, Processes, Terminal, Git, Kanban, Notepad | Workspace: Explorer, Processes, Terminal, Git, Kanban, Notepad, Memory. **"Processes" bizde açık panellerin listesi**; orijinalde kayıtlı çalıştırma komutları (`settings.json runCommands`, dev süreçleri) | ≈ | `shots/m02-terminal-mode.png`; `TerminalSidebar.tsx` |
| Flow durum paneli, Code Review, pop-out, görsel yapıştırma, dikte | Var | Yok | ➖ | `spec §3.5` |
| Kanban/Notepad'den terminale gönder | Kart ve not terminale yapıştırılır | Aynı (`sendToTerminal`) | ✅ | `context.ts` |

## 7. Motorlar

| Motor | vi3ecode onu nasıl sürüyor | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --permission-mode … --replay-user-messages --model --settings --mcp-config --strict-mcp-config --add-dir --append-system-prompt-file --allowedTools/--disallowedTools --resume`; `can_use_tool` kontrol isteği; `ultracode` efor `--settings`'e çevrilir; model kataloğu `initialize` ile; kota `rate_limit_event` + `/usage` PTY | `claudeArgs`: aynı akış bayrakları, `--permission-mode`, `--disallowedTools` (read-only), `--resume`, `--model`, `--effort`, `--mcp-config`, `--allowedTools`. Kontrol protokolü: `initialize`, `can_use_tool` → kart, `set_permission_mode` (canlı mod değişimi), `interrupt`. Eksik: `--strict-mcp-config`, `--settings`/ultracode, `--add-dir`, `--append-system-prompt*` (hafıza mesajın başına eklenir), model kataloğu, `/usage` yedeği, alt-ajanlar. Tek-tur çağrıları (Ask AI, flow adımı) da `--mcp-config` alır | ≈ | `bin §2.3`; `engines/claudeSession.ts`, `claude.ts` |
| Codex | `codex app-server` JSON-RPC: `thread/start`, `turn/start`, `turn/steer`, `item/*/requestApproval`, sıcak havuz, `account/rateLimits/read` | `codex exec --json --skip-git-repo-check -s <sandbox> \| --dangerously-bypass… [-m] [-c model_reasoning_effort=…] [resume <id>] -`, istem stdin'den; `thread.started`, `item.completed`, `turn.completed/failed` ayrıştırılır. Onay kartı, steer, kota, maliyet yok. Eklenti ve tarayıcı MCP'si `-c mcp_servers.<ad>.command/args/env=…` ile verilir (birim testli; canlı bir Codex'le doğrulanmadı) | ≈ (daha zayıf) | `bin §2.4`; `engines/codex.ts` `codexMcpOverrides`, `tests/engines.test.ts` |
| Gemini CLI | Orijinalde **motor değil** (`bin §2.1`) | `gemini -p "" -o stream-json --approval-mode plan\|default\|auto_edit\|yolo --skip-trust`. Bizde fazladan | ≈ (ek) | `cli §2.3`; `engines/gemini.ts` |
| ACP motorları: Kimi, Cursor, Grok, Cline | JSON-RPC 2.0 "Agent Client Protocol": `session/new`, `session/prompt`, `session/request_permission`, park edilmiş oturumlar | ACP istemcisi yok. Cursor: `agent -p --output-format stream-json [--force] [-m] [--resume]` tek-tur, **read-only yalnız talimatla**, canlı kayıtla doğrulanmadı. Kimi, Grok, Cline yalnız terminal | ➖ | `bin §2.5`, `cli §2.8` ([D] yalnız belge); `engines/cursor.ts` |
| opencode | `opencode run --pure --agent vi3ecode-* --format json --variant <efor> --session --auto -m`, `OPENCODE_CONFIG_CONTENT` ile üretilen ajanlar | `opencode run --format json [--agent plan] [--auto] [-m] [-s]`, mesaj argv'de (Windows ~8k sınırı notu kodda). Üretilmiş ajan, efor `--variant` yok. "Yalnız düzenlemeyi onayla" yok (orijinalde de yok) | ≈ | `bin §2.6`; `engines/opencode.ts` |
| Command Code | `-p --output-format … --permission-mode … --trust --skip-onboarding --no-session` | Yalnız terminal (`command-code --model --effort`). Headless adaptör yok | ➖ | `bin §2.7`, `cli §2.7` |
| Antigravity (`agy`) | JSON olayları, korumalı Plan, Build yalnız tam erişimle | Yalnız terminal (`agy --model --effort`) | ➖ | `bin §2.8` |
| Kiro CLI | Yalnız terminal (`kiro-cli chat`) | Aynı | ✅ | `bin §2.9`; `pty.ts` |
| Katalog, hesaplar | Gömülü 26 KB JSON (model, efor, fiyat, tarihsel id), uzak katalog, motor hesabı modelleri, çoklu hesap, kur/giriş komutları | Statik diziler (`engines/*.ts`; Claude/Codex/Kimi model adları katalogdan alınmış). Fiyatlama, Auto yönlendirme, çoklu hesap, uygulama içi kurulum yok; yalnız kurulum ipucu metni | ➖ | `bin §2.1` |
| Algılama | PATH + login kabuğu PATH'i + yaygın dizinler + `--version` | PATH + açılışta login kabuğu PATH'i (macOS/Linux) + `--version`; gizli motor yoklanmaz | ≈ | `bin §1`; `shellEnv.ts`, `engines/index.ts` `findOnPath` |

Küçük sorunlar (bu envanterde görüldü, düzeltilmedi): Kimi kurulum ipucu arşivlenmiş `kimi-cli`'yi gösteriyor
(güncel ürün `@moonshot-ai/kimi-code`, `bin §2.1`, `cli §0.2`); Grok ipucu başka bir paketi gösteriyor
(orijinal `curl -fsSL https://x.ai/cli/install.sh | bash`); motor süreçleri `process.env`'i olduğu gibi
alır (`ANTHROPIC_API_KEY` gibi anahtarlar aboneliği ezebilir, `cli §0.6`).

## 8. Onaylar ve guardrail'ler

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| 4 yerleşik kural | `db-destructive`, `file-delete`, `git-destructive`, `system-destructive`; başlıklar aynı | Aynı 4 kimlik ve başlık; regex'ler bizim. Kapsam: yalnız `db-destructive` "all", diğerleri "commands" (orijinalde üçünün kapsamı çıkarım) | ✅ kimlik / ≈ desen | `bin §10.2`; `shared/guardrails.ts`; `tests/guardrails.test.ts` |
| Nerede uygulanır | Her motor araç isteği; Full/Auto'da bile kart açar | Yalnız Claude izin yolunda (chat + ajan + Full access'li Flow adımı): Full access de `manual` modda koşar, uygulama guardrail dışındakilere "allow" der. Flow adımında soracak kimse olmadığı için eşleşen istek reddedilir ve Claude'a nedeni söylenir. Codex/Gemini/opencode/Cursor'da yok (soramazlar; Full = bypass) | ≈ | `bin §10.3`; `claudeSession.ts` `guarded`, `chat.ts`, `team.ts` |
| Özel kural, "Always block", kapsam seçimi | Var (kural, desen, kapsam, eylem) | Yok; eylem hep "kart aç". Ana şalter `settings.guardrails` Ayarlar > General'da | ➖ | `bin §10.2`, `spec §3.6` |
| Onay beyaz listesi, Supervised/Auto(Yolo) ayarı | Ayarlarda | Yok. Eski değerler eşlenir: `supervised`→`edits`, `auto`→`full` | ➖ | `schema.ts` `APPROVAL_ALIASES` |
| Sır redaksiyonu | Günlük, hafıza, uzak köprü, bot çıktısı | Etkinlik kaydı içerik tutmaz; **hafıza geri yazmada redaksiyon yok** | ➖ | `bin §10.4`; `activity.ts`, `memory.ts` |

## 9. Hafıza

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Kasa düzeni | `.vi3ecode/memory/`: `entries/<slug>.md`, `MEMORY.md`, `index.json`, `stats.json`, `feedback.json`, `retrieval-cache.json`, `.trash/`, kasa `.gitignore`'u | `entries/<slug>.md` (düz `memory/<slug>.md` okunur, kaydedince taşınır), `MEMORY.md`, `index.json`. Diğer yardımcı dosyalar yok | ≈ | `bin §5.1`; `main/project.ts` `memoryApi` |
| Not başlığı | `title, type, tags, updated, confidence, superseded_by` | `title, type, tags, created, updated`. `confidence`/`superseded_by` okunmaz ve yeniden yazılınca **düşer** | ≈ | `bin §5.1`; `shared/memory.ts` |
| Tipler | fact, decision, pattern, context, lesson_learned, warning, todo, reference | Aynı sekiz (`lesson_learned` ↔ `lesson` çevrilir) | ✅ | `spec §3.8`; `memory.ts` `parseNote` |
| `MEMORY.md` | "# Project Memory Index", tek satır/not, "most important" bölümü | "# Project memory", tipe göre gruplu `[[slug]]` satırları | ≈ | `bin §5.1`; `memory.ts` `buildIndex` |
| Enjeksiyon | Her mesaja uygun notlar + dizin (~1–2k token); `injectedMemoryIds` + "notes used" çipi | `<project-memory>` özeti, ≤6 000 karakter (~1,5k token): tip önceliği + yenilik sırası, **mesaja uygunluk puanı yok**. Chat ve ajan turlarının başına eklenir; ayar `memoryInject`; panelde token tahmini | ≈ | `bin §5.2`; `memory.ts` `buildBrief`, `chat.ts` `systemText` |
| Geri yazma | `MEMORY_WRITE {json}` tek satır ya da `entries/`'e dosya; `memoryAgentWrites`; `memory:write-confirmed`; gelen kutusu | Tek satır `MEMORY_WRITE {…}` yanıttan ayrıştırılır (turda ≤20), `entries/`'e yazılır, çakışan slug'a `-2`; ayar `memoryWriteBack` (varsayılan kapalı). Gelen kutusu/onay olayı/yasaklı önek koruması yok | ≈ | `bin §5.2`; `project.ts` `applyMemoryWrites` |
| Panel | Arama, tip süzgeci, 3B grafik, oy, sağlık kartı | Arama, tip süzgeci, liste/grafik (2B kuvvet düzeni), düzenle/sil, token tahmini | ≈ | `tools/MemoryTool.tsx`, `forceLayout.ts` |
| Bakım: Compact, Gardener, geçmişten/bağlamdan başlatma, Claude hafızası içe aktarma, global'e yükseltme, kapsam global/proje/oturum, BM25 + Türkçe kök arama | Var | Yok (AI bakım turları ayrı bir iş); yalnız proje kapsamı, alt dize araması | ➖ | `bin §5.1`, `spec §3.8` |

## 10. Skills

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Biçim | `<id>/SKILL.md`, `id` `^[a-z0-9][a-z0-9-]{0,63}$`, düz string frontmatter | Aynı kimlik kuralı; yazarken `name` + çift tırnaklı `description`; ad klasörden gelir. `references/`, `templates/` desteği yok | ≈ | `bin §6`; `shared/skills.ts`; `tests/skills.test.ts` |
| Kurulum hedefleri | `.vi3ecode/skills/`, `.claude/skills/`, `.opencode/skill/`, motor talimat dosyasında `<!-- vi3ecode:skills:begin/end -->` bloğu | Aynı üç klasör + `AGENTS.md` içinde aynı marker'lı blok ("## Vi3ecode Skills"). Bozuk marker'da tahmin etmez, hata verir. `AGENTS.override.md` (Codex iş politikası) ve `engine-inject/<motor>.md` yok | ≈ | `bin §6`; `main/skills.ts`, `skills.ts` `withSkillsBlock` |
| Kütüphane / mağaza | Kullanıcı kütüphanesi, GitHub bağlantısından alma, mağaza, favoriler, makbuz/geri alma | Yok; yalnız proje içi oluştur/düzenle/sil, "Installed" anahtarı, "Use in chat" | ➖ | `spec §3.9`; `tools/SkillsTool.tsx` |
| Ajan başına skill (≤8), sürükle-bırak (composer, pane, Lab kartı) | Var | Yok | ➖ | `spec §3.9` |

## 11. Eklentiler ve MCP

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Katalog | 9 mağaza eklentisi (graphify, postiz, vi3e-browser, vi3e-db, vi3e-security, vi3e-coverage, vi3e-deploy, vi3e-sentry, vi3e-figma); 17 alanlı manifest; Python `uv` aracı; hash'li artifact | 4 yerleşik eklenti: **REA**, Playwright, Context7, Filesystem; hepsi `npx` ile çalışan stdio MCP. Manifest, eylem, panel, yapılandırma alanı, sır depolama, mağaza, kurulum çalışma zamanı yok. REA sürümü sabit (`rea-agents@6.5.0 --mcp`); Playwright `@latest`, Context7 ve Filesystem sürümsüz: yani sabitlenmemiş | ≈ | `bin §8`; `main/plugins.ts` `CATALOG`; `tests/plugins.test.ts` |
| Proje etkinleştirme | Projeye `.mcp.json`, `.claude/settings.local.json` `enabledMcpjsonServers`, `.codex/config.toml` yazılır; `vi3ecode-<id>` adı | `.vi3ecode/plugins.json` `{version:1, active:[…]}` (repo ile gider) + **makine başına onay** `userData/plugin-consent.json`: klonlanmış repo kendi başına sunucu başlatamaz. Sunucu adı `vi3ecode-<id>` aynı. Projeye `.mcp.json` yazmıyoruz | ≈ | `bin §8`; `plugins.ts` `activeIds` |
| Motora verilişi | Claude `--mcp-config`, Codex `config.mcp_servers`, ACP `session/new`, opencode config, Cline/Command Code dosya | Claude (`--mcp-config`) ve Codex (`-c mcp_servers.*`); chat, ajan ve flow turlarında (`mcpConfig` turun seçeneği). Gemini, opencode, Cursor ve terminal panelleri: yok. Eklentiler sayfasındaki "diğer motorlar henüz almıyor" metni Codex için artık eskidi | ≈ | `bin §3`; `main/mcp.ts`, `engines/types.ts`, `PluginsTool.tsx` |
| İzin açıklaması | `process:spawn`, `fs:project-read`, `fs:project-write:<dir>`, `network`; kurulumdan önce onay | 4 etiket (`run-commands`, `read-project`, `write-project`, `network`); etkinleştirme penceresi izinleri ve çalışacak komut satırını gösterir, "sandbox değildir" der | ≈ | `bin §8`; `tools/PluginsTool.tsx` |
| Uygulama MCP shim'i | Uygulamanın kendisi `--app-mcp-shim` ile stdio MCP; loopback HTTP; sunucular `vi3ecode-browser` (11 araç), `vi3ecode-app` (24 araç), `vi3ecode-bots` (~45), `vi3ecode-context` | `resources/mcp-shim.cjs` (bağımlılıksız Node, JSON-RPC 2.0) → `127.0.0.1:<port>/call`, oturum başına rastgele Bearer token. Tek sunucu: `vi3ecode-browser`, **aynı 11 araç adı**. `vi3ecode-app` (24 araç: bağlam, proje, oturum, mod değiştirme…), bots, context yok. Sohbet anahtarı / pid başlığı yok | ≈ | `bin §3`; `resources/mcp-shim.cjs`, `browserBridge.ts` |

## 12. Browser paneli, Kanban, Notepad, Explorer, Git

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Browser paneli | Yerel alt webview (`BrowserHost`); ekran görüntüsü yalnız macOS; Firefox oturum içe aktarma; sohbet başına site izni; strict-CSP'de `eval` reddi | Electron `<webview>`: geri/ileri/yenile/durdur/adres/dış tarayıcı; yalnız http(s). "Sayfayı ekle" PNG'yi `.vi3ecode/captures/` (gitignore'lı) altına kaydedip composer'a `@yol` ekler; "metin olarak oku". Ekran görüntüsü her platformda (`capturePage`). Oturum içe aktarma ve site izni yok | ≈ | `bin §3`, `spec §3.12`; `tools/BrowserTool.tsx`, `main/browser.ts` |
| Motorların tarayıcıyı sürmesi | 11 araç; panel kapalıysa açılır; okuma serbest, eylem onaysız; read-only'de tıklama/yazma reddi; tur bitince kapanır | Aynı 11 araç; panel kapalıysa renderer'a `browser:open`. Claude'da okuma + eylem araçları `--allowedTools` ile önceden izinli, read-only turda eylem araçları izinli değil (`dontAsk` ile reddedilir); `browser_eval` önceden izinli değil, sorar. Codex de aynı sunucuyu alır ama okuma/eylem ayrımı ve read-only reddi orada yok (`allowedTools` Claude'a özgü). Gemini/opencode/Cursor almaz | ≈ | `bin §3`; `browserBridge.ts` `BROWSER_*_TOOLS`, `chat.ts` |
| Kanban özellikleri | Sürükle-bırak, süzgeç/arama/ilerleme, kartı çalıştır, sohbette aç, terminale gönder, dosya izleme | Sürükle-bırak, sütun ekle/yeniden adlandır/sil, kart penceresi (başlık, açıklama, etiket, takımdan atanan), sohbette aç, terminale gönder. Süzgeç, ilerleme, "kartı çalıştır", dosya izleme, AI yardımcı yok | ≈ | `spec §3.10`; `tools/BoardTool.tsx` |
| Notepad özellikleri | Not + çizim sayfaları; v/h/p/r/o/a/l/t/e araçları, geri al, yakınlaştırma, PNG; Ask AI nota yazar veya çizim yapar; sohbete/terminale gönder | Notlar + serbest kalem çizimi (renk, kalınlık, son çizgiyi sil, temizle); şekil/metin/yakınlaştırma/PNG yok. Ask AI yalnız nota **metin ekler**. Arama, sohbete/terminale gönder var. Sabitleme yok | ≈ | `spec §3.11`; `tools/NotesTool.tsx` |
| Explorer | Ağaç + git renkleri, oluştur/yeniden adlandır/sil, HTML/Mermaid önizleme, `@` bağlantısı | Salt okunur: tembel ağaç, süzgeç, ≤512 KB metin önizleme (ikili algılanır), `@yol` sürükle, sohbete gönder, yolu kopyala, dal adı. Düzenleme/dosya izleme/git rengi yok | ≈ | `bin §11`; `files.ts`, `tools/ExplorerTool.tsx` |
| Git | 36 komut: hunk, push/pull, dal, stash, PR, worktree, çoklu repo, AI commit | Durum (`porcelain=v2`), diff (izlenmeyen dosya dahil), stage/unstage (dosya düzeyi), commit + AI commit mesajı (salt okunur motor turu), log (50). `GIT_OPTIONAL_LOCKS=0`. Gerisi yok | ≈ | `bin §11`; `main/git.ts`, `GitTool.tsx` |
| Processes (kayıtlı çalıştırma komutları) | `settings.json runCommands`, başlat/durdur/log | Yok (bkz. bölüm 6 notu) | ➖ | `bin §7.1` |

## 13. Flow ve Activity

| Özellik | vi3ecode'da | Bizde | Durum | Kanıt |
|---|---|---|---|---|
| Flow modeli | Düğüm + kenar grafiği; `task/review/human` (+ graph türleri); adım başına motor/model/efor; paralel kopya; **kabul kontrolleri** (dosya var mı / komut 0 döner mi) ve onarım turları; kapsam; kapı seçenekleri; şablonlar, mağaza | **Doğrusal** adım listesi: `task`, `review`, `gate`; adım başına motor, model, izin. Grafik, kenar, paralel, kontrol/onarım, kapsam, kapı seçeneği, şablon, mağaza yok | ≈ | `bin §9`, `spec §3.13`; `shared/types.ts`, `shared/flow.ts` |
| Çalıştırma | Renderer'da (webview) koşar; sohbet composer'ından veya terminal Flow paneli ile | Ana süreçte sırayla; her adım tek-tur motor çağrısı, istem = hedef + önceki çıktılar (≤8 000 karakter) + adım. Çalıştırma yalnız Flow aracından | ≈ | `main/flows.ts` |
| Review | Üst akışı eleştirel doğrula | Son satır `VERDICT: PASS` ya da `VERDICT: FAIL — neden`; FAIL ya da satır yoksa çalıştırma hatayla biter (bizim tasarımımız, onarım yok) | ≈ | `shared/flow.ts` `parseVerdict`; `tests/flows.test.ts` |
| İnsan kapısı | Seçenek + serbest metin aşağıya iletilir | Onayla / Reddet; Reddet çalıştırmayı `rejected` ile bitirir. Bildirim gider | ≈ | `flows.ts` |
| Dosya / kayıt | Yazarlık konumu çıkarım: renderer depolaması + sunucu mağazası | Akış: `.vi3ecode/flows/<id>.json`; çalıştırma kayıtları `userData/flow-runs/` (son 30); kesilen çalıştırma "stopped" gösterilir | ≈ | `bin §9`; `flows.ts` |
| Activity | `activity-log.jsonl`, 17 alan, yüzeyler voice/chat/mcp/background/system, `stats/clear`, saklama günü, redaksiyon seviyesi | `userData/activity.jsonl` (son 2 000), alanlar: `ts, source(chat/team/flow/terminal/system), kind, outcome, projectId, engine, durationMs, costUsd`; konuşma/araç argümanı/dosya içeriği/çıktı **hiç tutulmaz**. Kaynak/proje/yalnız-hata süzgeci + canlı sayaçlar (çalışan sohbet, takım, bekleyen takım, terminal). Silme düğmesi, saklama ayarı, mcp/voice kaynağı yok | ≈ | `bin §10.1`, `spec §3.15`; `activity.ts`, `tools/ActivityTool.tsx` |

## 14. Yapılmayanlar (bütünüyle yok)

| Alan | vi3ecode'da | Bizde | Durum | Neden |
|---|---|---|---|---|
| Bot Mode | macOS-öncelikli kişisel ajanlar, SQLite, rutinler, ~45 araçlı `vi3ecode-bots` MCP, `/api/entitlements/bot-run` izni (`bin §11`) | Yok | ➖ | Deneysel, sunucu izni ve ayrı veri modeli gerektirir; çekirdek iş değil (`spec §6.2` Tier 2) |
| Canvas (Lab), Work, Graph | `canvas.json`/`canvas-labs/`, `graphs/`, Lab/Graph ajanları (`bin §7.1`) | Yok | ➖ | Büyük yüzeyler, ayrı AI istemleri; ajan takımına bağımlı değiller |
| Marketing Studio, Deploy | `marketing.json`, ffmpeg, Postiz/Oppus yayını; `vib3-deploy` arka ucu | Yok | ➖ | Üçüncü taraf hizmet ve sunucu gerektirir |
| Remote / Mobil | `wss` röle, ECDH + AES-GCM, 6 haneli karşılaştırma kodu, kill switch (`bin §11`) | Yok | ➖ | Röle sunucusu ve mobil uygulama ister |
| Hesap, ödeme, bulut senkron | Giriş (device code), Polar ödeme, yetkiler, 2 cihaz sınırı, senkron, referans | Yok | ➖ | Bilinçli: yerel, hesapsız, MIT. Orijinalde Agent Mode bile canlı oturum ister |
| Ses | Dikte (OpenRouter/Groq), Voice Chat (Codex realtime/WebRTC), Voice Assistant (24 araç) | Yok | ➖ | Üçüncü taraf anahtarı + WebRTC; çekirdek iş değil |
| Otomatik güncelleme | Tauri updater, minisign imzalı manifest | Yok. Sürüm GitHub Actions artifact'ı / Release (prerelease) | ➖ | İmza sertifikası ve güncelleme sunucusu gerekir; README imzasız kurulumu anlatır |
| Güvenlik denetimi, kod inceleme paneli, doğrulama servisi, proje iskeleleri (`template_*`), Init Project sihirbazı | Var | Yok | ➖ | AI denetim turları ve şablon veri seti; sonraya |

---

## 15. Dosya biçimleri

| Yol | Orijinal biçim | Bizde | Uyum |
|---|---|---|---|
| `.vi3ecode/agents.json` | `version, name?, projectId, updatedAt, agents[17 alan], settings{autoRelay, autoApprove, autoApproveParallelResults, returnToLead, supervision, maxSupervisionTurns, maxAutoRelayHops, budget{maxTurns,maxCostUsd}}` | Aynı yapı. `paused` ve `instanceCount` (1 ise yazılmaz) okunur ve yazılır; düzenlemediğimiz alanlar (`name`, `tools`, `serviceTier`) korunur; varsayılan: `supervision:true`, `maxSupervisionTurns:12`, `autoApproveParallelResults:false`. Ek: `lead:true` | Okunur/yazılır; orijinalin bilmediğimiz alanları korunur |
| `.vi3ecode/kanban.json` | `version, projectId, createdAt, updatedAt, columns[{id,title,color: slate\|sky\|amber\|violet\|rose\|emerald, createdAt, updatedAt}], cards[{id,columnId,title,description,assignee?,labels[],createdAt,updatedAt}]` | `version, projectId, columns[{id,title,color?}], cards[{id,columnId,title,description,assignee?,labels,createdAt}]`; renk `#rrggbb`, `createdAt` ms sayısı; üst düzey ve sütun/kart `updatedAt` yok; ≤20 sütun, ≤500 kart/sütun | Kartlar uyumlu; **renk değerleri farklı** (isimli renk okunurken düşer, orijinalin hex'i kabul edip etmediği doğrulanmadı) |
| `.vi3ecode/notes.json` | `version, projectId, createdAt, updatedAt, notes[{id,title,content,pinned,kind: note\|sketch, sketch{elements[],view,bg}, createdAt, updatedAt}]` | `version, notes[{id,title,body,strokes[{color,width,points[]}],updatedAt}]` | **Uyumsuz**: alan adları (`content`≠`body`) ve çizim modeli farklı; orijinalin dosyası bizde açılıp kaydedilirse not içeriği ve çizimler silinir |
| `.vi3ecode/memory/entries/<slug>.md` | Frontmatter `title, type, tags, updated, confidence, superseded_by`; gövdede `[[bağlantı]]` | `title, type, tags, created, updated`; `lesson_learned` ↔ `lesson` | Okunur/yazılır; `confidence`, `superseded_by` düşer |
| `.vi3ecode/memory/MEMORY.md`, `index.json` | `# Project Memory Index`; 16 alanlı giriş | `# Project memory` gruplu liste; `{version, entries[{slug,title,type,tags,links,updated}]}` | Üretilen dosyalar, biçim farklı |
| `.vi3ecode/skills/<id>/SKILL.md` + motor kopyaları | `---\nname\ndescription\n---\n\ngövde`; `.claude/skills`, `.opencode/skill`; `AGENTS.md` marker bloğu | Aynı hedefler ve aynı marker'lar; `description` hep çift tırnaklı | Uyumlu |
| `.vi3ecode/plugins.json` | Yok (kayıt uygulama düzeyinde `registry.json`; proje `.mcp.json` ve motor dosyaları) | `{version:1, active:["rea",…]}` | Bizim biçim |
| `.vi3ecode/flows/<id>.json` | Proje içinde karşılığı bilinmiyor (`bin §9`) | `{version:1,id,name,goal,steps[{id,kind,title,prompt,engine?,model?,approval?}],updatedAt}` | Bizim biçim |
| `.vi3ecode/engine-inject/claude.md` | Claude için `.claude/CLAUDE.md` yönetilen blok; diğer motorlar için `engine-inject/*.md` | Yalnız `claude.md`, klasörde `.gitignore: *` | Bizim biçim |
| `.vi3ecode/captures/*.png` | Yok (görseller `images/` ve uygulama verisinde) | Tarayıcı ekran görüntüleri, klasör gitignore'lı | Bizim biçim |
| Uygulama: `agents/global-agents.json` | `GlobalAgentLibrary` (5 alan), `GlobalTeamEntry` (8), proje bağlantıları | `{version:1, teams[{id,name,savedAt,team}]}` | Bizim biçim |
| Uygulama: sohbet/thread/flow | Oturum klasörü `session.json`, `chat-history.jsonl`; `agents/runtime-v1.json`; SQLite yalnız Bot | `chats/`, `team-runs/`, `flow-runs/` altında tek JSON/çalıştırma | Bizim biçim |
| `settings.json`, `config.json`, `canvas*.json`, `graphs/`, `marketing*.json`, `terminal-layout.json` | Var | Yok | ➖ |

---

## 16. Bilinçli farklar ve neden

1. **Electron, Tauri değil.** Repo Electron olarak başladı (`electron.vite.config.ts`, `rea §3.2`); `invoke` komut yüzeyi `ipcMain.handle` kanallarına bire bir taşınabilir.
2. **Yönlendirme kararı yerelde.** Orijinal karar sunucudan, imzalı gelir ve çevrimdışı çalışmaz (`bin §4.1`); biz aynı söz dizimi üzerinde kendi karar fonksiyonumuzu yazdık (`decideNext`). Sonuç: hesap, ağ, abonelik gerekmiyor.
3. **AUTO-APPROVE guardrail'i atlamaz.** Orijinal bir kez onaylanınca atlar (`bin §10.3`); biz "yıkıcı işlem her zaman sorar" kuralını Full ve AUTO-APPROVE'dan üstün tuttuk. Risk yönünden daha güvenli, ama orijinalden daha çok kart çıkar.
4. **Eklenti etkinleştirmesi makine onaylı.** Repoya giren `plugins.json` tek başına bir sunucu başlatmaz; klonladığınız bir repo komut çalıştıramaz. Eklentiler `uv` aracı değil `npx` MCP'si olduğu için kurulum çalışma zamanı ve hash doğrulaması yok; "sandbox değil" uyarısı arayüzde yazılı.
5. **Hafıza özeti tipe ve yeniliğe göre.** Mesaja uygunluk (BM25/kök arama) yerine basit ve tahmin edilebilir sıralama; üst sınır 6 000 karakter.
6. **Codex `exec --json`, app-server değil.** Çok daha az kod; karşılığında onay kartı, steer, kota ve maliyet kayboldu. `cli §0.3` ilk günde üç mod (read-only/auto-edit/full) önerir.
7. **Gemini CLI eklendi.** Orijinalde yok; `cli §0.1` Google'ın ücretsiz katmanı Antigravity'ye kaydırdığını söylüyor. Hem Gemini hem `agy` panelde var; yalnız Gemini headless.
8. **Paralel dalga sıralı.** Worktree olmadan iki yazıcıyı aynı anda çalıştırmak çakışma yaratır; önce güvenli semantik (sonuçlar birlikte döner), eşzamanlılık sonraya.
9. **Avatarlar kodla üretilen piksel sanat**, orijinalin portre/glif görselleri kullanılmadı (telif).
10. **Yardımcı motor çağrıları** (Ask AI, commit mesajı) yalnız `ai.ask`: salt okunur tek tur, varsayılan motor. Orijinalin motor allowlist'i (Claude/Codex/Command Code/Cursor) yok.
11. **Sohbetler repoda değil** (orijinalle aynı): `userData/chats/`. Bu bir fark değil, bilerek korunan kural.
12. **Repodan gelen Full access ve AUTO-APPROVE makine onaylı.** Klonlanan bir repodaki `agents.json` ya da `flows/*.json` bir ajana Full access veya AUTO-APPROVE verirse, bu ayar bu makinede onaylanana kadar Edits'e ve kapalıya iner. Takım penceresi bunu sarı bir satırla gösterir ve "Bu makinede izin ver" düğmesi sunar; ayarı uygulamada kendiniz açmak (Edits → Full, AUTO-APPROVE anahtarı, Flow adımında Full) da onay sayılır. Onay ayar başına: ilgisiz bir kayıt (isim değişikliği, Auto-relay) repodan gelen Full'u onaylamaz, sonradan başka bir ajana Full veren commit yeniden onay ister (`main/trust.ts`, `userData/trusted-settings.json`). Orijinalde böyle bir kontrol gözlemlenmedi.
13. **Windows'ta motorlar mutlak yolla başlar.** Çıplak ad Windows'ta önce proje klasöründe aranır; repoya konan `claude.cmd` çalışabilirdi. npm `.cmd` shim'leri açılıp hedef script `node` ile doğrudan çalıştırılır (cmd.exe argüman yeniden ayrıştırması yok); açılamayan `.cmd` başlatıcılarına tırnak, `%` ya da satır sonu içeren istem gönderilmez (`engines/index.ts` `binOf`, `spawnTarget`).

`appId` artık `dev.vi3ecode.desktop`: gerçek vi3ecode ile aynı makinede kurulu olsa bile kimlikler çakışmaz.

## 17. Sonraki adımlar (değere göre, en çok değer üstte)

1. **Biçim güvenliği (`notes.json`, `agents.json`).** Orijinalin `content/kind/sketch/pinned` alanlarını oku-yaz, bilinmeyen alanları koru; `agents.json`'da `tools/paused/instanceCount/name` kaybolmasın. Şu an orijinalin verisi bizde kaydedilince silinebilir; düzeltmesi küçük.
2. **Codex app-server (JSON-RPC):** onay kartları, `turn/steer`, kota, maliyet. Codex'te tarayıcı araçlarının okuma/eylem ayrımı ve read-only reddi de buna bağlı.
3. **Worktree izolasyonu + gerçek paralel dalga** (thread başına `work/<ad>`, birleştirme, "tek yazar" kuralı). Git katmanı (push/branch/stash/hunk) da buna bağlı.
4. **Hafıza kalitesi:** mesaja uygun not seçimi, geri yazmada sır redaksiyonu, gelen kutusu onayı. Ajan notları repoya commit olduğu için redaksiyon bir güvenlik meselesi.
5. **Guardrail arayüzü ve kapsamı:** ana şalter, özel kural, "Always block", Claude dışı motorlar ve terminal için hook; Ayarlar'da `guardrails` / `browserTools` anahtarları.
6. **Ajan güvenilirliği:** protocolRepair (Lead'e bir kez yeniden sor), düzeltme kartları, `@ask-user` soru kartları, "aside"; ardından denetim (supervision) turları.
7. **Terminal kalıcılığı:** düzen + kaydırma geçmişi diske, motor oturumunu devam ettirme; Processes (kayıtlı çalıştırma komutları).
8. **Motor genişliği:** Command Code, `agy`, Kimi Code, Cline, Grok headless adaptörleri (ACP istemcisi), hesaptan model listesi; Gemini/opencode/Cursor'a MCP verilmesi; motor süreçleri için ortam allowlist'i; Kimi/Grok kurulum ipuçlarının düzeltilmesi.
9. **Dağıtım:** kod imzası + otomatik güncelleme, ayrı `appId`, eski arayüz metinlerinin (`team.json`, "Codex henüz almıyor") düzeltilmesi.
10. **Flow ve Skills derinliği:** akışa kabul kontrolleri + onarım turları, Skills için içe aktarma/kütüphane.

Sonraya kalanlar: Notepad şekil/PNG, `vi3ecode-app` MCP'si, kısayollar, Bot/Canvas/Marketing/Remote/Hesap alanları (bölüm 14).

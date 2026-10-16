# Pro yakalama kiti

Orijinal vi3ecode'un bazı kararları kendi sunucusunda veriliyor: ajan devri, denetim (supervision), Plan Mode, Work Mode ve Bot Mode. Kod dışarıdan görünmüyor, ama verilen kararlar uygulamanın senin bilgisayarındaki dosyalarına yazılıyor. Bu kit, o dosyaları Pro hesapla yapılan test senaryolarından sonra toplar. Senin bilgisayarında çalışan Claude oturumu da bunlardan kuralları çıkarır.

**Gizlilik:** Toplanan veri yalnızca senin bilgisayarında kalır ve hiçbir yere gönderilmez. Bu repo herkese açık; repoya yalnızca kişisel bilgi içermeyen kurallar yazılır.
- Anahtar, eşleştirme, giriş ve hesap dosyaları hiç kopyalanmaz.
- Token, e-posta ve imza gibi değerler maskelenir.

Script `tools/pro-capture/collect.cjs`.

## Senin yapacakların

1. vi3ecode'un en son sürümünü kur ve **Pro hesabınla kendin giriş yap**. Şifreni ya da token'ını kimseyle paylaşma.
2. Testler için gerçek kodun olmayan, boş bir deneme projesi aç. Örneğin `~/vi3ecode-test` klasöründe `git init` yapıp bir `README.md` commit'le. Sohbet içerikleri toplanan veriye girecek.
3. Aşağıdaki senaryoları orijinal uygulamada sırayla yap. Her birinin sonunda thread'in bitmesini bekle.
4. Orijinal uygulamayı **tamamen kapat**, böylece dosyalar diske yazılır.
5. Bu repoyu bilgisayarına klonla ve klasörde Claude'u başlat. İki yoldan biri:
   - Terminalde:
     ```
     git clone https://github.com/Akadirr1/vi3ecode && cd vi3ecode
     claude remote-control
     ```
   - Ya da Claude Desktop uygulamasında bu klasörü aç.
6. O oturuma şunu yaz: **"tools/pro-capture/README.md içindeki Claude talimatlarını uygula. Deneme projem: ~/vi3ecode-test"**

## Senaryolar (orijinal uygulamada)

| # | Ne yapacaksın | Ne görmek istiyoruz |
|---|---|---|
| S1 | Ajan modunda Lead + Developer + QA takımı kur. Hedef: "README'ye bir başlık ekle, QA kontrol etsin". | Sıradaki ajanın nasıl seçildiği, Lead'e dönüş |
| S2 | Aynı takımda hedef: "Developer ve QA aynı anda README'yi okusun, sonra Lead özetlesin". | Paralel dalga, sonuçların Lead'e dönüşü |
| S3 | Takım ayarında **Adım limiti 3**, **Tur bütçesi 2** yap, uzun bir hedef ver. | Limit ve bütçe dolunca ne olduğu |
| S4 | **"Devredilen işi denetle" açık** olsun. Developer'a "`sleep 300` çalıştır, sonra bitti de" görevini devrettir ve 6–7 dakika bekle. | Denetçinin ne zaman uyandığı; @steer / @stop / @watch / @ok kararları |
| S5 | Bir ajanı salt okunur yap ve ona dosya yazdırmaya çalış. | "Enable edits and continue" kartı ve geri sayım |
| S6 | Ayarlar → Deneysel → **Plan Mode**'u aç. Yeni plan oluştur, planlayıcıya bir hedef yaz, **Run plan** de (önce senkron, sonra worktree ile). | Plan JSON'u, fazlar, onay kapıları, birleştirme |
| S7 | **Bot Mode**'da şablondan bir bot oluştur ve 2 dakika sonrasına bir rutin kur. | Rutin zamanlaması ve bot kararları |
| S8 | Varsa **Work Mode**'da yeni bir Work aç. | Yetki ve davranış |
| S9 | Aynı anda 4 thread başlat. | "Sıra bekliyor" ve kota bekleme davranışı |

Yapamadığın senaryo olursa atla, sorun değil.

## Claude için talimatlar (senin bilgisayarındaki oturum uygular)

1. Toplayıcıyı çalıştır. Çıktı repo dışında `~/vi3ecode-pro-capture/<zaman>` klasörüne gider:
   ```
   node tools/pro-capture/collect.cjs --project <deneme projesi>
   ```
   Uygulama verisi farklı bir yerdeyse `--app-data <klasör>` ver.
2. Çıktıyı incele (`manifest.txt`, `app-data/agents/runtime-v1.json`, `agent-jobs.json`, `activity-log.jsonl`, `bots/bots.sqlite3`, `project-vi3ecode/`). Gerekirse REA kullan; yoksa kurulum için kullanıcıdan onay al.
3. Her senaryo için **girdi → karar** kurallarını çıkar. Örneğin denetçinin hangi durumda kaç saniye sonra baktığı ve hangi eylemi seçtiği; hangi `@handoff` satırına hangi ajanın atandığı; Plan Mode'un faz alanları ve geçerlilik kuralları.
4. Kuralları `docs/pro-findings.md` dosyasına yaz. Her kuralın yanına hangi senaryodan ve hangi alandan çıktığını belirt (dosya adı + alan adı); gözlenen ile tahmin edileni ayır.
   - **Asla yazma:** e-posta, kullanıcı adı, sohbet metinleri, mutlak dosya yolları, hesap/abonelik bilgisi, token.
   - Örnek değer gerekiyorsa uydurma bir değer kullan.
5. `docs/pro-findings.md` dosyasını tek bir commit olarak `claude/determined-sagan-cd4vwp` branch'ine push'la. Toplanan ham veriyi asla repoya ekleme.
6. Kullanıcıya bulut oturumuna "pro-findings hazır" demesini söyle.

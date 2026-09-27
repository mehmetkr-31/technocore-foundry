# Gerçek katkı: Technocore kanıt kontrol raporu

Tarih: 2026-09-05. Bu rapor yerel otomatik doğrulama sonucudur; bağımsız
değerlendirme, imzalı görev kabulü veya airdrop uygunluk belgesi değildir.

## Sonuç

Depodaki mevcut iki gerçek kayıt kontrol edildi. İmzalar geçerli ve ikisi de
`did:key:z6MkgputwyYsihYJpxsd3Wc6so1sxuJUoJR3oEiNPU4tCyYo` kimliğine bağlı.
Yeni kimlik üretilmedi, özel anahtar okunmadı ve ağa mesaj gönderilmedi.

| Dosya | Sonuç | Kanıtladığı |
| --- | --- | --- |
| `lobby-seq-25843281.technocore-proof.json` | İmza geçerli | DID, oda/nonce/mesaj içeriğini imzalamış |
| `technocore-participation-a022410137e3f233.json` | İmza geçerli | DID, katkı beyanını imzalamış |

İmzalı metinler test kopyalarında değiştirildiğinde doğrulama başarısız oldu.
Lobby kaydının oda adı değiştirildiğinde de doğrulama başarısız oldu.
İmzasız `generation` alanı değiştirildiğinde imza geçerli kaldı: bu beklenen
sonuçtur ve sunucu bilgilerinin neden ayrı değerlendirilmesi gerektiğini gösterir.
Orijinal dosyalar değiştirilmedi.

## Tam dosya özetleri

- Lobby, 1362 bayt: `78aab8c8dfbb29f0d54400341fe42cf8ccaf94fc65159069fa70617c5c6a5c2a`
- Katkı beyanı, 1167 bayt: `bab6ad91f0a6ba63fe58ac6bd2423cef77aeea31e881f7cfadea5ca918769310`

Bu SHA-256 değerleri incelenen tam dosyaları tanımlar; sunucudan alınmış bir onay değildir.

## Tekrar kontrol et

Proje dizininde:

```bash
node --import tsx scripts/audit-public-participation.ts
```

Komut mevcut doğrulayıcıları kullanır; yeni, bağımsız bir kriptografik uygulama değildir.
`fetch` çağrıları bu çalışmada engellenir. İmza, beklenen DID veya olumsuz testlerden
biri tutmazsa komut başarısız olur. Parola ve kasa dosyası gerekmez.

## Açık kalanlar

- Sunucu sıra numarası, zaman damgası, generation, halen yayında olma ve sunucunun
  gerçekten kaydı kabul etmiş olması bu çevrimdışı imzayla kanıtlanmaz.
- Katkı beyanı, işin kalitesini veya başka birinin işi kabul ettiğini kanıtlamaz.
- Gerçek ödeme, testnet harcaması ve airdrop uygunluğu incelenmedi.
- Foundry görev açılışı, claim, teslimat ve görev sahibi kabulü henüz oluşturulmadı.
  Bu raporu tamamlanmış bir görev dossier'ı gibi sunmayın.

## Foundry için hazır görev metni

**Başlık:** Mevcut Technocore katkı kanıtlarının tekrarlanabilir çevrimdışı denetimi

**Amaç:** İki mevcut kamusal kanıtın imzasını, beklenen DID eşleşmesini ve
imzalı/imzasız alan ayrımını kullanıcıların anlayabileceği şekilde raporlamak.

**Kabul ölçütleri:** Yukarıdaki komut başarılı olmalı; iki dosyanın SHA-256 değeri
raporla eşleşmeli; imzalı metin ve oda değişiklikleri reddedilmeli; imzasız metadata
değişikliği sunucu doğrulaması gibi sunulmamalı; hiçbir özel anahtar veya ağ yazımı
kullanılmamalı. Teslimat bu Markdown raporu ve depodaki doğrulama komutudur.

**Dürüst işlem sırası:** Görev sahibi bu kapsamı kendi DID'iyle açar; işi üstlenen
gerçek katılımcı kendi DID'iyle claim ve teslimat imzalar; görev sahibi inceleyip
kararını imzalar. Hazır çalışma sonradan kayda geçiriliyorsa bu açıkça belirtilir,
eski tarihli görev anlaşması varmış gibi gösterilmez. Aynı operatörün ek kimliğini
bağımsız değerlendirici olarak kullanmayın. Karşı taraf olmadan bağımsız kabul
iddiası eklemeyin; rapor tek başına faydalı, tekrar üretilebilir bir çıktıdır.

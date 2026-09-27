# Çok-odalı kanıt paketi v2

V2; bir Foundry dossier'ını, iki Technocore oda dışa aktarımını ve isteğe bağlı
PaperRail gözlemini tek kanonik JSON dosyasında saklar. Oluşturma ve yeniden
doğrulama tamamen çevrimdışıdır. Mevcut v1 dosyaları değiştirilmez.

## Kullanım

```bash
npm run deal:bundle -- create dossier.json offers.jsonl deal.jsonl 0x<tam-sozlesme-kimligi> output.json
npm run deal:bundle -- verify output.json
```

İsteğe bağlı gözlem için `deal:audit --paper` komutunun JSON stdout çıktısını
ayrı dosyada saklayıp son argüman olarak ekleyin:

```bash
npm run deal:bundle -- create dossier.json offers.jsonl deal.jsonl 0x<tam-sozlesme-kimligi> output.json audit-report.json
```

`create` mevcut çıktı dosyasının üzerine yazmaz; yeni dosyayı `0600` izniyle açar.
Girdi sembolik bağlantılarını reddeder. Dossier 512 KiB, her oda 2 MiB, gözlem
raporu 512 KiB, tam paket 12 MiB ile sınırlıdır. Paket bir participation dosyası
veya kasa yedeği değildir; bunları dossier yerine kullanmayın.

`verify`, şemaya göre v1 veya v2 denetleyicisini seçer.

### Tarayıcıdan kullanım

Yerel uygulamada `/deals/bundle` ekranını açın. Görev dossier'ını, iki oda
JSONL dosyasını ve tam sözleşme kimliğini girip **Kontrol et ve paketi hazırla**
düğmesine basın. İsteğe bağlı gözlem alanı yalnızca kaydedilmiş raporu okur;
canlı sorgu yapmaz. Paylaşılabilirliği kontrol ettikten sonra **Paketi indir**
düğmesini kullanın. Sonradan aynı dosyayı **Kaydedilmiş paketi doğrula**
alanında denetleyebilirsiniz. Eski v1 dosyaları ve demo sayfanın altındaki
kapalı bölümde korunur. Kasa, parola ve participation dosyası gerekmez.

## Biçim ve doğrulama

Şema `foundry-work-deal-v2`; tam alanlar:
`schema`, `dossier`, `contract`, `transcripts`, `observation`, `binding`.
`transcripts` içinde `offers` ve `agreement` özgün UTF-8 metinleri bulunur.
Oda isimleri kullanıcı etiketinden değil protokol ve tam sözleşme kimliğinden
türetilir. Dossier ve dışa aktarımların baytları yeniden biçimlendirilmez.
Kanonik paketin sonunda LF bulunmaz. Dosya kimliği `fwd2_<SHA256-ilk24hane>`;
tam SHA-256 raporda tutulur. Dosya adı güven kaynağı değildir.

Her yüklemede dossier imzaları ve iki odalı anlaşma yeniden incelenir. Teklifin
job alanı görev kimliği ve imzalı görev makbuzu hash'iyle, ödeyen görev sahibiyle,
alacaklı işi üstlenen DID ile eşleşmelidir. Bağlantı alanları kaynaklardan yeniden
hesaplanır. Terminal olmayan ama geçerli bir anlaşma da paketlenebilir; `valid`
tamamlanmış iş veya ödenmiş ücret anlamına gelmez.

## Gözlem konusunda önemli ayrım

Kolektörün `matching` gibi hazır kararları güvenilir girdi olarak alınmaz.
Yalnızca sözleşme, sabit kaynak URL, bildirilen HTTP kodu, yerel gözlem zamanı,
varsa yanıt metni ve özeti saklanır. Kaydedilmiş gövdenin hash'i kontrol edilir;
not koşulları ve hash tanığı yeniden hesaplanır.

- `saved-body-consistent`: Dosyada saklanan metin koşullarla tutarlı.
- `inconsistent`: Saklanan metin veya ref anlaşmayla uyuşmuyor.
- `reported-missing`: Kolektör 404 bildirmiş; bu HTTP yanıtının gerçekliği kanıtlanmadı.
- `no-replayable-body`: Yeniden incelenebilir metin yok.
- `malformed-body`: Saklanan metin beklenen not biçiminde değil.
- `absent`: Gözlem eklenmemiş.

**Herhangi biri bu gözlemi ve hash'ini birlikte üretebilir.** Kaynak URL ve SHA-256,
yanıtın gerçekten o sunucudan geldiğini kanıtlamaz. Bu nedenle kaynak doğruluğu
daima `not-proven`, gözlem `untrusted-collector-snapshot` olarak kalır. Not herkesçe
değiştirilebilir; güncel eşleşme geçmiş lock anını kanıtlamaz. Zaman ve sıra
metadata'sı da imzasızdır. Gözlem tutarsızsa bile kanıt dosyasının yapısı geçerli
olabilir; sonuçta bu tutarsızlığı saklamak faydalıdır.

Paket kabı imzasızdır. Dossier'ın eklenmesi karşı tarafın o son dossier'ı kabul
ettiği anlamına gelmez. Teslim edilen artifact baytları gömülmez veya yeniden
doğrulanmaz. İş kalitesi, ödeme ve airdrop uygunluğu bu paketle garanti edilmez.

## Paylaşmadan önce

Paket, seçilen iki oda dışa aktarımının **tamamını** ve varsa not yanıtını taşır;
yalnızca seçili sözleşmenin mesajlarını değil. İçeriğin paylaşılabilir olduğunu
kontrol edin. Paket otomatik yayımlanmaz veya GitHub'a yüklenmez.

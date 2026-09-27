# İki odalı anlaşma denetimi — ilk aşama

Bu araç iki mevcut JSONL dosyasını **yerelde** inceler. Oda açmaz, ağa bağlanmaz,
anahtar istemez, mesaj imzalamaz ve PaperRail dahil hiçbir ödeme sistemine yazmaz.
Mevcut `foundry-work-deal-v1` paketini veya tek-oda doğrulayıcısını değiştirmez.

```bash
npm run deal:audit -- /tam/yol/offers.jsonl /tam/yol/deal.jsonl 0x<64-haneli-sozlesme-kimligi>
```

İlk dosya `tclk-offers` odasının dışa aktarımı olmalıdır. İkinci dosya sözleşme
kimliğinin `0x` sonrası ilk 16 hanesiyle oluşturulan `mb-p-tclk-…` odasındandır.
Her dosya en fazla 2 MiB olabilir. Sembolik bağlantılar kabul edilmez. Tam sözleşme
kimliği gerekir; ekranlarda gösterilen kısaltma kullanılamaz. Dosyaların son satır
sonu ve ham baytları korunmalıdır. Boş anlaşma odası, teklif/kabul mevcutsa yalnızca
tamamlanmamış anlaşma olarak raporlanabilir.

## Ne kontrol edilir?

- Tam sözleşmeye bağlı tek teklif/kabul çifti ve tekliften sonra gelen kabul.
- Seçilen her mesajın Ed25519 imzası ve iç/dış yazar DID eşleşmesi.
- Teklif/kabulün teklif odasında, sonraki mesajların türetilmiş odada olması.
- Kanonik frame biçimi, sözleşme hash'i, taraflar, geçişler ve hash kilidi tanığı.
- Kabulün teklif süresi bitmeden olması; lock/reveal'ın `refundAfterMs` öncesinde,
  refund'ın bu sınırda veya sonrasında olması. `claimByMs` bu durum makinesindeki
  reveal sınırı değildir; onu yanlışlıkla yeni bir protokol kuralına çevirmeyiz.

Referans: resmî `flop-labs/tclk` commit
`5cc4ab93efbc8999a3a7e1471b639deca25998ea`, `SPEC.md`, `src/machine.ts` ve
`examples/audit-export.mjs`. Bu bağımsız, sınırlı bir Foundry profilidir; upstream
auditor ile tüm özelliklerde eşdeğer olduğu iddia edilmez.

## Sonuç nasıl okunur?

- `ok`: Seçilen kayıtlar profil kontrollerinden geçti. **İş bitti veya ödeme yapıldı demek değil.**
- `verifiedStatus`: Kontroller geçerse durum; süre veya geçiş hatasında `null`.
- `structuralStatus`: Sürelerden bağımsız mesaj durum hesabı; tek başına kabul sonucu değildir.
- `terminal`: Başarıyla kontrol edilmiş claimed/refunded/cancelled durumu. Kabul edilmiş
  ama tamamlanmamış bir anlaşmada `ok: true`, `terminal: false` normaldir.
- `timingErrors`: İmzasız dışa aktarım zamanlarına göre sorunlar. Zaman kontrolünün
  geçmesi saatin veya geçmişin gerçekliğini kriptografik olarak kanıtlamaz.
- `ignoredRecords` ve `unparsedTclkRecords`: Seçilen sözleşmeye bağlanmayan veya
  parse edilemeyen kayıt sayıları. Geçmişin tamamının doğru olduğu iddiası değildir.

Her oda kendi append sırasını korur; odalar zaman damgasıyla yeniden sıralanmaz.
Sıra numaraları odalar arasında karşılaştırılmaz. Bu strict profilde yinelenmiş
seçili kayıtlar ve geriye giden zaman reddedilir; hata sessizce atlanmaz. İlgisiz
odadaki gürültü başka bir sözleşmeye mal edilmez. Hash dışındaki kilitler desteklenmez.

Exit 0 profil kontrollerinin geçtiğini, 1 başarısızlığı, 2 eksik komut argümanını belirtir.
Konsolda ham mesaj içeriği veya gizli anahtar değil, özetler ve denetim bilgileri çıkar.

## Henüz yapılmayanlar

Türkçe web arayüzü ve gerçek karşı tarafla
prova sonraki aşamalardır. Bu rapor sunucu dahil etme/tamlık, ödeme, iş kalitesi veya
airdrop uygunluk kanıtı değildir. Çevrimdışı denetleyici otomatik fetch yapmaz.
Çok-odalı [paket v2](WORK_DEAL_V2_TR.md) komut satırında kullanılabilir.

## İsteğe bağlı PaperRail gözlemi

```bash
npm run deal:audit -- /tam/yol/offers.jsonl /tam/yol/deal.jsonl 0x<64-haneli-sozlesme-kimligi> --paper
```

`--paper` açıkça istenirse ve yerel anlaşma kontrolleri geçerse ayrı gözlemci çağrılır.
Sadece doğrulanmış kilit koşullarından türetilen sabit `https://technocore.chat/kv/…`
adresine bir GET yapar. Kayıttaki keyfî URL/ref takip edilmez. Yönlendirme, kimlik
bilgisi gönderme, otomatik yeniden deneme veya ağ yazımı yoktur. İstek 8 saniye,
yanıt gövdesi 32 KiB ile sınırlıdır. Normal kullanım çevrimdışı kalır.

| Sonuç | Anlamı |
| --- | --- |
| `matching` | Okunan deneme notu, imzalı anlaşmanın koşulları ve durumuyla tutarlı |
| `missing` | Bu istekte 404 gözlendi; geçmişte hiç kayıt olmadığı söylenemez |
| `request-error` | Ağ hatası, kesilen gövde veya 200/404 dışı HTTP yanıtı; yok diye sayılmaz |
| `malformed` | Beklenmeyen biçim, UTF-8, gövde büyüklüğü veya bozuk not |
| `mismatch` | Ref, statement, deadline, durum veya açıklanmış hash tanığı uyuşmuyor |
| `not-applicable` | PaperRail değil; başka ödeme sistemine erişilmedi |

`matching`, sadece **şimdi okunan, herkesin değiştirebildiği deneme notuna** ilişkindir.
`claimed` notunda secret gerçekten statement hash'ini açmalıdır. Durum farkı asenkron
okuma/yazma veya müdahaleden kaynaklanabilir; tek başına sahtekârlık teşhisi değildir.
Notun bugünkü varlığı eski lock anını kanıtlamaz; kaybolması da hiç var olmadığını kanıtlamaz.
Cache kapatma isteği tazelik garantisi değildir. Gözlem zamanı yerel saattendir.

Raporda HTTP kodu, kaynak URL, yerel gözlem zamanı, alınabilen tam sınırlı yanıt metni
ve SHA-256 özeti bulunur. Bu alanlar imzalı sunucu kanıtı değildir; çevrimdışı bir
gözlem dosyasının kaynağı bu alanlar sayesinde doğrulanmış sayılmaz. Paylaşmadan önce
ham yanıtı kontrol edin. `--paper` kullanıldığında exit 0 için hem yerel denetim hem
not eşleşmesi gerekir. Diğer sonuçlar exit 1'dir; bu durum ödeme başarısızlığı anlamına gelmez.

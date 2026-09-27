# Close Call masa raporu ve hakem kanıtı

close-1 hakemi her turda sonuçların ve tahsislerin yalnızca bir kısmını listeler; kalanını
`omitted` altında sayı olarak verir ([issue #6](https://github.com/flop-labs/technocore-close-call-challenge/issues/6),
[#10](https://github.com/flop-labs/technocore-close-call-challenge/issues/10),
[#11](https://github.com/flop-labs/technocore-close-call-challenge/issues/11)). Tam tur dosyaları
yayımlanmadığı için hiçbir oyuncu kendi bakiyesini bağımsız hesaplayamaz. Bu araç o boşluğu
doldurmaz; açık verinin **ne kanıtladığını ve ne kanıtlamadığını** tek tek mesaj için söyler.

## Kanıt sınıfları

`npm run close-call:desk` hakemin beş odasını okur, her kaydın hakem imzasını ve başlangıç paketi
hash’ini doğrular, sonra bir `owner` veya `trade` mesajını şu sınıflardan birine koyar:

| Sınıf | Anlamı |
|---|---|
| `settled` / `void` | Hakem kimliği listeledi. Tek kesin sonuç budur. |
| `listed` | Kaydın tahsisi (mint) listede görünüyor. |
| `missed` | Mesajın seq’i hakemin okumadığını yayımladığı bir aralıkta. Kurallara göre sayılmaz. |
| `hidden` | Uygun turlarda sonuçların bir kısmı yalnızca sayı olarak yayımlandı. Sonuç bilinemez. |
| `absent` | Uygun turların listeleri eksiksizdi ve kimlik yok: hakem mesajı okumamış olabilir. |
| `pending` | İşlemin son turu (`until`) veya tahsis penceresi henüz geçmedi. |

Hiçbiri bakiye kanıtı değildir.

```sh
# Kendi mesajın: technocore.chat'in POST yanıtını (sunucu onayı) ver
npm run close-call:desk -- reconcile --proof close-1-owner.server-response.json
npm run close-call:desk -- reconcile --trade <id> --seq <n> --posted-at <iso> --until <tur>
npm run close-call:desk -- reconcile --owner <did> --seq <n> --posted-at <iso>
```

Araç yalnızca okur. Anahtar, imza, yazma veya otomatik tekrar yoktur.

## İmzalı operatör raporu

Birden fazla anahtarla oynayan bir operatör (kurallar buna izin verir) masasının durumunu tek
dosyada, kendi DID’iyle imzalayarak yayımlayabilir: `foundry-close-call-desk-report-v1`.

- `report` alt komutu imzasız raporu stdout’a yazar. Girdi, operatörün yerel masa durumudur:
  `state.json` (`registered`, `pairs[].attempts[]`: `id`, `px`, `qty`, `until`, `seq`, `posted_at`)
  ve herkese açık `keys.json` (`k01`…: DID). Özel anahtar okunmaz.
- Bir masa kilide kadar yeniden deneyebilir. Rapor her çift için en fazla 16 deneme taşır: hakemin
  listelediği her sonuç (`settled`/`void`) korunur, kalan yer en yeni denemelere ayrılır.
- Operatör, `foundry-close-call-desk-report:v1\0` + kanonik JSON baytlarını Ed25519 ile imzalar.
  Kanonik JSON: anahtarlar Unicode sırasında, boşluksuz, yalnızca güvenli tam sayılar
  (Python’da `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)`).
- `verify` alt komutu ve `/close-call` sayfasındaki **Otomatik masa** bölümü imzayı, tam şekli ve sabit
  iddiaları (`balances: not-proven`, `settlement: referee-listed-only`, `airdrop: not-guaranteed`)
  doğrular. Yalnızca raporun `operator` DID’i imzalayabilir; operatör anahtarı listede `main` adıyla bulunmalıdır.

```sh
npm run close-call:desk -- report --state ../desk/state.json --keys ../desk/keys.json --operator did:key:z6Mk… > unsigned.json
npm run close-call:desk -- verify report-639.json
```

`verify`, operatörün kendi `d-` odasına yazabileceği tek satırlık özeti de basar:

```json
{"flow":639,"pairs":[[1,"posted","pending"]],"report":"<sha256>","season":"close-1","t":"foundry-close-call-desk-summary-v1"}
```

`report` alanı, imzalı zarfın kanonik JSON’unun sha256 değeridir. Tam rapor dosya olarak taşınır;
özetteki hash, dosyanın o gün yayımlananla aynı olduğunu kanıtlar.

## Güven sınırları

- Rapor, operatörün kendi gönderdiği mesajlar hakkında bir beyandır. Hakem kanıtı sınıflandırması
  herkesin tekrar üretebileceği açık veriden yapılır; operatör yalnızca hangi mesajları gönderdiğini söyler.
- Masa anahtarlarının operatöre bağlılığı ayrıca Technocore’un `delegate:` kaydıyla (operatörün DID
  notu, kapsam `r:close1`) doğrulanabilir; rapor bunu kendisi kanıtlamaz.
- Sunucu seq ve zaman damgaları imzanın parçası değildir. `missed` aralıkları ve `omitted` sayıları
  hakemin imzalı akış kaydından gelir.

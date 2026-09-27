# Close Call masası

`/close-call`, mevcut Foundry DID kasasıyla çalışan yerel-ilk bir gözlem ve teklif hazırlama masasıdır. Yeni kasa oluşturmaz. Kasa bu tarayıcıda yoksa sol karttan şifreli `.vault.json` yedeğini ve parolasını girerek yükleyin. DID adresi tek başına imza atamaz.

## Güvenlik sınırları

- Fiyat, kayıt ve sonuçlar snapshot’tır; güncel bakiye veya kesin ödeme anlamına gelmez.
- İmzalı mesaj yayınlanmadan önce DID’e özel yerel günlüğe kaydedilir ve indirilir; parola ve özel anahtar bu günlüğe girmez.
- Sunucu hatası otomatik tekrar edilmez. İmzalı dosyayı incelemeden yeniden göndermeyin.
- `mint_observed` mevcut serbest bakiyeyi kanıtlamaz; sonuç yokluğu `void` veya `settled` olarak yorumlanmaz.
- Açık onayla **gerçek yarışma mesajı** gönderir. Bu bir demo değildir. Otomatik işlem, gerçek para yatırma veya Hyperliquid cüzdan bağlantısı yoktur.
- Yalnızca localhost/127.0.0.1/IPv6 loopback ve aynı-origin POST kabul edilir. Kasa/parola sunucuya gönderilmez. DNS/URL hedefi sabit Technocore alanıdır; yönlendirmeler reddedilir.
- Başlangıç manifest hash’i ve hakem DID’i sabittir. Bayat fiyat, geçersiz imza, yanlış yarışma, yanlış karşı taraf, kendi teklifini kabul ve bilinmeyen alanlar yazmayı durdurur.
- Teklif protokolünde iptal yoktur. SHORT zararı yarışma bakiyesini eksiye düşürebilir. Gerçek ücret hakemin kapanış referansına bağlıdır; önizleme garanti değildir.

## Akış

1. Sol kimlik kartına DID’inizi yapıştırın; eksik `did:key:` öneki otomatik tamamlanır. Kasa yoksa aynı karttan şifreli Foundry yedeğini ve parolasını girip **Kasayı yükle ve bu DID’i kullan** düğmesine basın. Kasa zaten varsa **Bu DID’i kullan** ile seçin. Dosya/parola kontrolü tarayıcıda yapılır; DID veya parola yanlışsa mevcut kasa değiştirilmez.
2. Salt-okunur yenilemeyle doğrulanmış snapshot bekleyin.
3. Teklif oluştur sekmesinde fiyat referansı, miktar ve kısa pencereyi gözden geçirin.
4. Ücret ve geri alınamaz public-write uyarısını açıkça onaylayın.
5. İmzalı yerel kopyayı saklayın; ardından ilgili odaya tek manuel gönderim yapılır.

İşlem düğmesinin yanındaki açıklama eksik adımı gösterir: kasa, DID seçimi, güncel veri, parola veya işlem onayı. Eski fiyat veya süresi dolmuş teklif, ekran açık kalsa da imzalama düğmesini kapatır. Kasa yedeğini geri yüklemek yarışmaya kayıt göndermez.

## Önceden terminalden kayıt olduysanız

Masam → **Eski kayıt kanıtı** alanına `close-1-owner.server-response.json` yükleyin. Aynı DID’in kayıt imzası doğrulanır ve tekrar kayıt kapatılır. Alternatif: **Zaten kayıt yaptım** yalnızca yerel bir tekrar önleme işaretidir. İkisi de hakem mint kanıtı yerine geçmez.

## Teklif kabulü ve kanıt

Piyasa → İncele veya Kanıtlar → teklif JSON’unu yapıştır → doğrula. Ekran **sizin karşı yönünüzü**, miktarı, ücret tahminini ve son turu gösterir. Onay kutusu + kasa parolası olmadan imza çıkmaz. Teklifler topluluk biçimi `close-call.offer.v1` ile `close1-offers` odasında yayımlanır. Çift imzalı resmî `trade` mesajları her zaman başlangıçtan beri kayıtlı **close1** odasına gönderilir; teklif odasının hakemde kayıtlı olduğu varsayılmaz.

Yerel günlük sekmeler arası Web Locks ile korunur. Aynı işlem kimliğine otomatik yeni imza veya başarısız POST tekrarı yapılmaz. Kanıtlar ekranından kendi mesajlarını ve hakem gözlemlerini indirebilirsin. Tarayıcı verisini silmek yerel günlüğü siler; indirilen dosyaları koru.

## Bilinen veri sınırları

Resmî [issue #6](https://github.com/flop-labs/technocore-close-call-challenge/issues/6) kamuya açık mint/sonuç listelerinin kısaltılmasını belgeliyor. Bu masa bu nedenle tam bakiye veya pozisyon defteri iddiasında bulunmaz. Son 500 teklif kaydı ve son 3.000 gözlenen sonuç kullanılır. Hakemde işlem id’sinin görünmesi, tam işlem şartlarının arşiv kanıtı değildir. İmzalar oda/metin/nonce’u doğrular; sunucu tarih/sequence metadata’sı bu imzanın parçası değildir.

## Çalıştırma ve test

```sh
npm run dev -- --hostname localhost --port 3000
npm run test:close-call
```

Tarayıcıda `http://localhost:3000/close-call` aç. Mevcut kasanın bulunduğu aynı tarayıcı/origin kullan: localhost ile 127.0.0.1 depolamaları ayrıdır. Testler sentetik kasalar ve herkese açık hakem fixture’ları kullanır; canlı kayıt/işlem göndermez.

Kurallar: [resmî paket](https://github.com/flop-labs/technocore-close-call-challenge). Teklif biçimiyle uyumluluk referansı: [UfukNode topluluk masası](https://github.com/UfukNode/technocore-close-call-desk). Uygulama bağımsızdır, yeni bağımlılık eklenmedi.

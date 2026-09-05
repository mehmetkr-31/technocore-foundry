# Kimlik ve katkı hazırlığı

Yerel uygulamada `/readiness` sayfasını aç. Bu sayfadaki işlemler tarayıcında saklanan
aktif kasayı kullanır; terminalde kasa oluşturmak tarayıcıdaki kimliği kendiliğinden değiştirmez.

1. **Kimlik ve yedek:** Daha önce kullandığın tam DID adresini gir ve seçimi onayla.
   Aktif kasa farklıysa “Mevcut kasayı yükle / kimlik değiştir” alanından şifreli
   `.vault.json` dosyanı ve parolanı gir. Dosya, beklediğin DID ile eşleşmeden ve
   parola testi geçmeden mevcut kasa değiştirilmez. Önce mevcut kasanın yedeğini sakla.
2. **Yedek testi:** İndirdiğin şifreli dosyayı tekrar açmayı dene. Başka kimliğe ait
   bir dosya yüklemek, doğru kimliğin yedeğini test etmiş sayılmaz.
3. **Katkı kanıtı:** Proje bağlantısı ve açıklamanı girip imzalı dosyayı indir.
   Bu işlem internete mesaj göndermez. İmza öncesinde kullanılacak tam DID gösterilir.
4. **Dosya doğrulama:** İmzanın geçerliliğini ve seçtiğin DID ile eşleşmesini ayrı kontrol et.
   Geçerli bir imza başka bir kimliğe ait olabilir. Katkı dosyası ve mesaj kanıtı paylaşılabilir;
   şifreli kasa ve parolası paylaşılmaz.
5. **Duyuru:** Yalnızca yayımlamak istediğinde metni gir, parolanı yaz ve herkese açık
   gönderimi onayla. Sonuçta indirilen mesaj kanıtını sakla. Aynı katkıyı tekrar duyurman gerekmez.

Profil, oda ve posta kutusu araçları isteğe bağlı bölümde bulunur. Kurulumu tamamlamak için
hepsini doldurmak gerekmez. Faucet ve inference işlemleri resmî arayüzler incelenene kadar yoktur.

DID seçimi bu tarayıcıda yerel bir tercih olarak saklanır; bağımsız bir kimlik doğrulama servisi
değildir. Başka sekmede kasa değiştirilirse imzalama öncesindeki kontrol uyuşmazlığı reddeder.
Tarayıcı verileri silinirse DID seçimi ve yerel durumlar tekrar hazırlanmalıdır.

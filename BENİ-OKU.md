# Dynamic Fit for Mplus

Doğrulayıcı ve ikinci düzey faktör modelleri için **dinamik uyum indeksi (DFI) kesme değerlerini** bu bilgisayardaki Mplus ile simüle eden yerel bir web uygulaması. Simülasyon mantığı R'daki `dynamic` paketinden (Wolf ve McNeish, 2023) aktarılmıştır: yanlış belirtme ve kesme değeri kuralları paketle aynıdır, veri üretimi ve kestirim ise Mplus'ta yapılır. Sağdaki APA 7 makale siz ilerledikçe kendiliğinden yazılır.

## Başlatma

En kolayı: GitHub'daki Releases sayfasından `DynamicFitMplus.exe` dosyasını indirip çift tıklayın (kurulum gerekmez, projeler exe'nin yanındaki `projects` klasörüne yazılır). Kaynaktan çalıştırmak için `baslat.bat` dosyasına çift tıklayın ya da bu klasörde `node serve.mjs` çalıştırın. Adres http://localhost:3401 (dolu ise 3402–3421). Gerekenler Mplus 8.x (8.3 ile denendi; ücretsiz demo en çok 6 maddeyle çalışır) ve kaynaktan çalıştırırken Node.js 18+'dır; npm paketi gerekmez. Arayüz biçemini ve yazı tiplerini internetten yükler. Exe'yi yeniden derlemek için `node tools/build-exe.mjs` (Node 20.12+ ve ilk seferde internet gerekir; `postject` aracı npx ile iner).

## Kullanım (5 adım)

1. **Data:** Üç yoldan biri.
   - **Ham veri (CSV):** "Try the sample data" ile hazır örneği deneyebilirsiniz.
   - **Mplus çıktısı (.out):** `OUTPUT: STDYX;` içeren, daha önce kestirilmiş bir CFA veya ikinci düzey model.
   - **Standart kestirimler:** Bir makaledeki yükler ve N. Hazır örnek: A-SAGS (Boivin ve ark., 2026).
2. **Structure:** CSV yolunda maddeleri faktörlere atayın, isterseniz ikinci düzey faktör ekleyin. Diğer yollarda okunan yapı gösterilir.
3. **Settings:**
   - Veri üretimi: sıralı/WLSMV ya da `dynamic` gibi normal/ML.
   - Tekrar sayısı: varsayılan 500.
   - Uygunsuz çözümler: varsayılan "Retain" (dynamic gibi). Bu ayarı değiştirmek yeniden çalıştırma gerektirmez.
   - Kesme kuralı model türünden gelir: sürekli maddeler ve ikinci düzey modellerde 90/10 yedekli 95/5; sıralı tek ve çok faktörlü modellerde %95 özgüllükte en yüksek duyarlılık (`catOne`/`catHB` gibi). Öteki kural Tablo 3'te verilir.
4. **Run:** CSV yolunda önce CFA, ardından düzey başına iki Monte Carlo koşusu çalışır: hipotez modeli ve CFI için temel model, aynı veride.
5. **Report:** Yöntem, yük tablosu, uyum ve kesme değerleri (Tablo 2), simülasyon koşulları ve uygunsuz çözüm sayıları (Tablo 3), dağılım şekli. Yazdırılabilir, HTML ve tekrar verisi (CSV) olarak indirilebilir.

## Neden Mplus sürümü?

- Kesme değerleri, kullanıcının raporladığı Mplus indeksleriyle aynı tanımlarla hesaplanır. Bu özellikle SRMR için önemlidir: Mplus ML'de varsayılan olarak ortalama yapısını da kestirir ve SRMR'yi ortalama artıklarıyla birlikte hesaplar; `dynamic` ve lavaan'ın varsayılanı ise ortalama yapısı içermez (15 maddede oran √(120/135) ≈ .943). Model `MODEL = NOMEANSTRUCTURE` ile kestirilmişse uygulama simülasyonu da öyle kurar.
- Sıralı maddeler için ikinci düzey modellerde de WLSMV ile kategorik DFI üretilir.
- Mplus 8.3'ün Monte Carlo çıktısı CFI vermez (McNeish ve Wolf, 2023a, Ek B; CFI/TLI Mplus 8.4'te eklendi). Bu yüzden her koşul aynı seed ile temel modelle de çalıştırılır ve CFI, Mplus'ın kendi formülüyle her tekrar için hesaplanır.

## Doğrulama

`node tools/engine-test.mjs` (`--quick`: 500 tekrarlı referans simülasyonu atlar):

- Yanlış belirtme seçimi `dynamic::multi_add_hier` ile aynı olmalı (A-SAGS: NGA BY GA1 .2902; SRGA BY GA3 .1265).
- Örnek verinin CFA'sı Türkçe karakterli klasörde de aynı sonucu vermeli.
- A-SAGS el girişi referans DFI'ı (ML, 500 tekrar, N = 492) aynı seed'lerle daha önce elde edilen kesme değerlerini birebir üretmeli: Level 1 .023/.062/.987, Level 2 .025/.075/.983.

Ayrıca:
- Yanlış belirtme seçimi, paketin kendi örneklerinde ve negatif yüklü modellerde `dynamic` ile aynıdır.
- Uygulamanın iki kesme kuralı, `dynamic`'in kendi simülasyon dağılımlarına uygulandığında paketin yazdırdığı 33 kesme değerinin 33'ünü verir.
- McNeish ve Wolf (2023a) Ek B simülasyonu, aynı seçenekler (`MODEL = NOMEANSTRUCTURE; INFORMATION = EXPECTED;`) ve seed (1981) ile her tekrarda birebir yeniden üretilmiştir.
- SRMR'deki fark, Mplus'ın ML'de varsayılan olarak ortalama yapısını kestirmesinden kaynaklanır.

## Sınırlar

- Tek grup, CFA ve ikinci düzey modeller desteklenir. Regresyon (ON), bifaktör ve çok gruplu modeller yoktur.
- İkinci düzey modellerde yapısal yanlış belirtme (`hier2`) en az dört birinci düzey faktör gerektirir; tam dört faktörde McNeish ve Manapat'ın (2024) tarif ettiği iki düzey kullanılır (`dynamic` bu durumda hata verir).
- Sürekli veri çok değişkenli normal üretilir; eksik veri örüntüsü ve normal dışılık yeniden üretilmez.
- Ters kodlu maddeler kesme değerlerini değiştirmez: yanlış belirtmeler kodlamaya duyarsız işaret alır (yükler pozitifken `dynamic` ile aynı). Ayarlar'daki "As dynamic" seçeneği paketi birebir yeniden üretir (`dynamic` issue #7).
- Eşitlik kısıtları simülasyonun analiz modelinde serbest bırakılır (`dynamic`'te olduğu gibi).
- Serbestlik derecesi 0 olan modeller reddedilir; uyumları sınanamaz.
- Tek faktörlü modellerde 1. düzey McNeish ve Wolf'un (2023a) formülünü izler (yuvarlar; maddelerin yaklaşık üçte biri). `dynamic` aşağı yuvarlar ve 10, 11, 16, 17, 22, 23, 28, 29 maddede bir korelasyon eksik ekler; Ayarlar'daki "As dynamic" seçeneği paketi birebir verir. Rapor bunu yazar.
- Mplus değişken adları en çok 8 karakterdir.

## Lisans ve kaynak

Lisans: AGPL-3.0 (`LICENSE`). Simülasyon kuralları AGPL-3 lisanslı `dynamic` paketinden türetilmiştir. Kaynaklar: McNeish ve Wolf (2023a, 2023b), McNeish ve Manapat (2024), McNeish (2023), McNeish ve Wolf (2024), Wolf ve McNeish (2023); ayrıntılar ve tam künyeler `README.md` dosyasındadır.

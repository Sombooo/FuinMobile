# Fuin Mobile 1.0.0-Beta.10 — Sürüm Notları (Release Notes)

> **"Kredi Kartı & Güvenli Not Eşitlemesi, Yumuşatılmış Squircle Logo ve Kurumsal Güvenlik"**  
> *Sürüm:* `1.0.0-beta.10`  
> *Yayın Tarihi:* Kasım 2026  
> *Mimari Standart:* Sıfır Bulut, Çevrimdışı-Öncelikli, P2P Eşitleme  

---

## 🌟 Beta 10 Neler Getiriyor?

Fuin Mobile `v1.0.0-beta.10`, masaüstü sürümüyle tam senkron olarak **Kredi Kartı** ve **Şifreli Güvenli Not** kasa giriş türlerini, iki yönlü diferansiyel eşitleme motorunu (`sync-merge`), yenilenen squircle yumuşatılmış uygulama logosunu, yerel What's New sürüm günlüğünü ve kurumsal seviye siber güvenlik uyumluluğunu sunar.

---

## 🛡️ Başlıca Değişiklikler ve İyileştirmeler

1. **Kredi Kartı & Güvenli Not Eşitleme Desteği (`sync-merge`):**
   - Masaüstünden aktarılan veya mobilde düzenlenen kart numaraları, son kullanma tarihleri, CVV, PIN ve şifreli güvenli notlar simetrik ve kayıpsız olarak eşitlenir.
   - Core field karşılaştırmasında kart ve güvenli not alanları koruma altına alındı.

2. **Yumuşatılmış Squircle Logo (Arayüz & Marka Bütünlüğü):**
   - Mobil uygulamanın uygulama içi ve mağaza logosu, masaüstüyle tam uyumlu sıcak Apple tarzı squircle yumuşatılmış köşeler ve şeffaf kenar yumuşatması (antialiasing) ile yenilendi.

3. **What's New & Çevrimdışı Sürüm Kataloğu:**
   - Beta 10 yenilikleri ve geçmiş sürümler Ayarlar > Yenilikler ekranı üzerinden çevrimdışı görüntülenebilir.

4. **Sıfır Bulut & Donanım Tabanlı Güvenlik:**
   - Android Keystore AES-256-GCM donanım destekli kasa ve AutofillService koruması ile `FLAG_SECURE` ekran yakalama kalkanı aktif tutuldu.

---

## 📦 Kurulum ve Dosya Doğrulama

| Platform | Dosya | Mimari | SHA-256 |
|---|---|---|---|
| **Android** | [`Fuin-1.0.0-beta.10.apk`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.10/Fuin-1.0.0-beta.10.apk) | Universal Android (arm64-v8a / armeabi-v7a / x86_64) | `f4e223931c9fbd20ffeb7f186284add7706e7d57e05f5eeb2a74a664e67a83aa` |
| **Bütünlük** | [`SHA256SUMS.txt`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.10/SHA256SUMS.txt) | Checksum Doğrulama | — |

İndirdiğiniz APK dosyasının bütünlüğünü doğrulamak için:

```bash
sha256sum -c SHA256SUMS.txt
```

# Fuin Mobile 1.0.0-Beta.11 — Sürüm Notları (Release Notes)

> **"2FA QR Tarayıcı, Canlı TOTP, Tek Adım Biyometrik Kilit & Taşınabilir Yedek Eşliği"**  
> *Sürüm:* `1.0.0-beta.11`  
> *Yayın Tarihi:* Kasım 2026  
> *Mimari Standart:* Sıfır Bulut, Çevrimdışı-Öncelikli, P2P Eşitleme  

---

## 🌟 Beta 11 Neler Getiriyor?

Fuin Mobile `v1.0.0-beta.11`, tek dokunuşla **2FA `otpauth://` QR kamera tarayıcı**, kart üzerinde canlı **30 sn TOTP geri sayım kodu**, tek adım biyometrik kilit açma, masaüstüyle tam uyumlu **Argon2id + AES-256-GCM `.fuin`** yedekleme / Chrome & Bitwarden & 1Password kart-not içe aktarma ve kurumsal/yurt Wi-Fi ağları için **AP İzolasyonu (Hotspot)** rehberliği sunar.

---

## 🛡️ Başlıca Değişiklikler ve İyileştirmeler

1. **2FA QR Kamera Tarayıcı & Canlı TOTP Sayacı:**
   - Kayıt düzenlerken tek dokunuşla `otpauth://` doğrulayıcı QR kodu tarama özelliği eklendi.
   - Android tam ekran kamera düzenindeki siyah ekran ve odak retikülü hizalama hatası giderildi.
   - 2FA kayıtları için kart üzerinde canlı 30 saniyelik TOTP doğrulama kodu ve geri sayım çubuğu eklendi.

2. **Tek Adım Biyometrik Kilit & Taşınabilir `.fuin` Yedekleme:**
   - Uygulama kilidi açılışındaki çift parmak izi/Face ID doğrulama istemi tek pürüzsüz adıma indirildi.
   - Argon2id + AES-256-GCM şifreli `.fuin` yedek dosyaları Fuin Masaüstü ile tam taşınabilir hale getirildi.

3. **Chrome CSV & JSON Kart/Not İçe Aktarma Eşliği:**
   - Bitwarden, 1Password ve Chrome CSV/JSON dışa aktarımlarından Kredi Kartı ve Güvenli Not kayıtları doğrudan Fuin Mobile'a aktarılabilir.

4. **Yerel Ağ Eşitlemesinde AP İzolasyonu (Hotspot) Rehberliği:**
   - Kurumsal veya öğrenci yurdu Wi-Fi ağlarında AP İzolasyonu nedeniyle cihazların birbirini göremediği durumlar için eşleştirme ve eşitleme uyarılarına Kişisel Erişim Noktası (Hotspot) ipucu eklendi.

---

## 📦 Kurulum ve Bütünlük Doğrulama

| Platform | Dosya | Mimari |
|---|---|---|
| **Android** | [`Fuin-1.0.0-beta.11.apk`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.11/Fuin-1.0.0-beta.11.apk) | Universal Android (arm64-v8a / armeabi-v7a / x86_64) |
| **Bütünlük** | [`SHA256SUMS.txt`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.11/SHA256SUMS.txt) | SHA-256 Doğrulama |

İndirdiğiniz APK dosyasının bütünlüğünü doğrulamak için:

```bash
sha256sum -c SHA256SUMS.txt
```

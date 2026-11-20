# Fuin Mobile 1.0.0-Beta.12 — Sürüm Notları (Release Notes)

> **"Native Android Pano Güvenliği & Arka Plan Otomatik Temizleme"**  
> *Sürüm:* `1.0.0-beta.12`  
> *Yayın Tarihi:* Kasım 2026  
> *Mimari Standart:* Sıfır Bulut, Çevrimdışı-Öncelikli, P2P Eşitleme  

---

## 🌟 Beta 12 Neler Getiriyor?

Fuin Mobile `v1.0.0-beta.12`, Android'de kopyalanan şifre ve gizli verilerin arka planda silinmeme sorununu Bitwarden / KeePassDX mimarisiyle kökten çözer. Native Kotlin katmanı üzerinden **hassas veri işaretleme (`EXTRA_IS_SENSITIVE`)**, **arka plan `AlarmManager` temizleme tetikleyicisi**, **gerçek `clearPrimaryClip()`** çağrısı ve **harici pano değişikliği izleme** desteği eklenir.

---

## 🛡️ Başlıca Değişiklikler ve İyileştirmeler

1. **Native Android `FuinClipboardModule` & `EXTRA_IS_SENSITIVE`:**
   - Kopyalanan şifre, kredi kartı, TOTP doğrulama kodları ve kurtarma anahtarları Android 13+ üzerinde `ClipDescription.EXTRA_IS_SENSITIVE` bayrağıyla işaretlenir (sistem önizleme baloncuğunda `••••` maskeleme ve Gboard geçmiş koruması).
   - Süre dolduğunda Android 9+ (`API 28+`) cihazlarda doğrudan `ClipboardManager.clearPrimaryClip()` çağrılır.

2. **Arka Planda Güvenilir `AlarmManager` + `ClipboardClearReceiver`:**
   - Uygulama arka plana alınsa veya uyutulsa dahi zamanlanmış `AlarmManager` + non-exported `ClipboardClearReceiver` sistem panosunu zamanında temizler.
   - `OnPrimaryClipChangedListener` ile kullanıcı arada başka bir metin kopyalarsa bekleyen temizleme iptal edilir; yeni kopyalanan içerik silinmez.
   - `SharedPreferences` veya `SecureStore` içine hiçbir zaman açık metin yazılmaz; yalnızca rastgele UUID belirteç ve süre bilgisi tutulur.

3. **Kurtarma Anahtarı & Android 10+ Geri Dönüş Yolu Düzeltmesi:**
   - `App.js` içindeki kurtarma anahtarı kopyalaması da otomatik temizlenen `copySecure(..., 45000)` mekanizmasına bağlandı.
   - Fallback (`expo-clipboard`) yolunda uygulama aktif değilken Android 10+ pano okuma engeli yüzünden zamanlayıcının erken silinmesi hatası düzeltildi.

---

## 📦 Kurulum ve Bütünlük Doğrulama

| Platform | Dosya | Mimari |
|---|---|---|
| **Android** | [`Fuin-1.0.0-beta.12.apk`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.12/Fuin-1.0.0-beta.12.apk) | Universal Android (arm64-v8a / armeabi-v7a / x86_64) |
| **Bütünlük** | [`SHA256SUMS.txt`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.12/SHA256SUMS.txt) | SHA-256 Doğrulama |

İndirdiğiniz APK dosyasının bütünlüğünü doğrulamak için:

```bash
sha256sum -c SHA256SUMS.txt
```

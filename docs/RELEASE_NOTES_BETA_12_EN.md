# Fuin Mobile 1.0.0-Beta.12 — Release Notes

> **"Native Android Clipboard Security & Background Auto-Clear"**  
> *Version:* `1.0.0-beta.12`  
> *Release Date:* November 2026  
> *Architecture Standard:* Zero Cloud, Local-First, Offline P2P Sync  

---

## 🌟 What's New in Beta 12?

Fuin Mobile `v1.0.0-beta.12` solves Android's background clipboard clearing restriction using Bitwarden / KeePassDX standards. A new native Kotlin clipboard guard adds **`EXTRA_IS_SENSITIVE`** flagging on Android 13+, OS-level **`AlarmManager` + `BroadcastReceiver`** background clearing, real **`ClipboardManager.clearPrimaryClip()`** invocation, and external clip preservation.

---

## 🛡️ Key Features & Improvements

1. **Native Android `FuinClipboardModule` & `EXTRA_IS_SENSITIVE`:**
   - Tags copied passwords, cards, TOTP codes, and recovery keys with `ClipDescription.EXTRA_IS_SENSITIVE` so Android 13+ previews stay masked (`••••`) and compliant keyboards avoid caching them.
   - Clears the system clipboard using native `ClipboardManager.clearPrimaryClip()` on Android 9+ (`API 28+`) with an empty-sensitive fallback for older versions.

2. **Reliable Background `AlarmManager` + `ClipboardClearReceiver`:**
   - Schedules OS alarms targeting non-exported `ClipboardClearReceiver` so expired secrets wipe even while Fuin Mobile is backgrounded or suspended.
   - Registers `OnPrimaryClipChangedListener` to cancel pending wipes immediately if the user copies something else from another app.
   - Zero plaintext is ever persisted to `SharedPreferences` or `SecureStore` (stores only an opaque UUID token and expiry timestamp).

3. **Recovery Key Security & Android 10+ Fallback Fix:**
   - Routes recovery key copy actions in `App.js` through timed `copySecure(..., 45000)`.
   - Fixes the `expo-clipboard` fallback path so background read restrictions never prematurely drop clipboard expiry metadata before returning to the app.

---

## 📦 Installation & Integrity Verification

| Platform | Asset | Architecture |
|---|---|---|
| **Android** | [`Fuin-1.0.0-beta.12.apk`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.12/Fuin-1.0.0-beta.12.apk) | Universal Android (arm64-v8a / armeabi-v7a / x86_64) |
| **Checksums** | [`SHA256SUMS.txt`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.12/SHA256SUMS.txt) | SHA-256 Verification |

To verify APK integrity before installation:

```bash
sha256sum -c SHA256SUMS.txt
```

# Fuin Mobile 1.0.0-Beta.11 — Release Notes

> **"2FA QR Scanner, Live TOTP, Single-Step Biometric Unlock & Portable Backup Parity"**  
> *Version:* `1.0.0-beta.11`  
> *Release Date:* November 2026  
> *Architecture Standard:* Zero Cloud, Local-First, Offline P2P Sync  

---

## 🌟 What's New in Beta 11?

Fuin Mobile `v1.0.0-beta.11` introduces one-tap **2FA `otpauth://` QR camera scanning**, live **30-second TOTP countdown codes** directly on vault cards, single-step biometric unlock, cross-platform **Argon2id + AES-256-GCM `.fuin`** backup & Chrome/Bitwarden/1Password card-note import parity, and **AP Isolation (Personal Hotspot)** guidance during LAN P2P sync.

---

## 🛡️ Key Features & Improvements

1. **2FA QR Camera Scanner & Live TOTP Countdown:**
   - Added one-tap `otpauth://` authenticator QR scanning when editing login items.
   - Fixed full-screen Android camera layout rendering and aiming reticle alignment.
   - Displays live auto-refreshing 30s TOTP verification codes and countdown bars directly on mobile vault cards.

2. **Single-Step Biometric Unlock & Portable `.fuin` Backup Parity:**
   - Streamlined mobile unlock to a single biometric authentication prompt.
   - Enabled full Argon2id + AES-256-GCM encrypted `.fuin` backup portability with Fuin Desktop.

3. **Chrome CSV & JSON Card/Note Import Parity:**
   - Import Credit Cards and Secure Notes directly from Bitwarden, 1Password, and Chrome CSV/JSON exports.

4. **LAN Sync AP Isolation (Personal Hotspot) Guidance:**
   - Added Personal Hotspot guidance to pairing and sync unreachable alerts when corporate or dorm Wi-Fi uses AP Isolation.

---

## 📦 Installation & Integrity Verification

| Platform | Asset | Architecture |
|---|---|---|
| **Android** | [`Fuin-1.0.0-beta.11.apk`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.11/Fuin-1.0.0-beta.11.apk) | Universal Android (arm64-v8a / armeabi-v7a / x86_64) |
| **Checksums** | [`SHA256SUMS.txt`](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.11/SHA256SUMS.txt) | SHA-256 Verification |

To verify APK integrity before installation:

```bash
sha256sum -c SHA256SUMS.txt
```

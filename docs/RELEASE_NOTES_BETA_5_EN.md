# Fuin Mobile v1.0.0-beta.5 (Android)

> **"Quietly Secure" — 100% Offline, Peer-to-Peer Password Manager**

---

### 📦 Direct Download

| Platform | Package | Architecture | Direct Download |
| :--- | :--- | :--- | :--- |
| **Android** | Standalone APK | Universal (arm64-v8a, armeabi-v7a, x86_64) | [**Download Fuin-1.0.0-beta.5.apk**](https://github.com/Sombooo/FuinMobile/releases/download/v1.0.0-beta.5/Fuin-1.0.0-beta.5.apk) |

Verify authenticity via `SHA256SUMS.txt` attached below.

---

### What's New in Beta 5

#### 1. Unified Architecture & Versioning
- Aligned versioning across the Fuin ecosystem (`v1.0.0-beta.5`) for seamless compatibility between Desktop (macOS / Windows) and Mobile (Android).
- Displayed explicit versioning and cryptographic security indicators in Settings.

#### 2. Pair vs. Sync Architecture Clarification
- Fuin uses **one-time optical QR codes exclusively for device pairing** (exchanging cryptographic identities and tokens).
- Vault synchronization is performed strictly over **direct Local Area Network (LAN P2P)** or **Personal Hotspot**, keeping the cryptographic exchange zero-cloud and high-speed.

#### 3. Air-Gap & Screen Security
- Strict `FLAG_SECURE` enforcement to prevent screenshots and task-switcher previews of secret credentials.
- 100% Zero-Cloud Heritage: Zero telemetry, zero analytics, zero external network requests.
- Strict RFC 1918 local subnet validation for peer discovery.

#### 4. Verification Checksum
Check the SHA-256 integrity of your download:
```bash
shasum -a 256 -c SHA256SUMS.txt
```

---
*Security reports:* [hellofuin@gmail.com](mailto:hellofuin@gmail.com) · *Repository:* [github.com/Sombooo/FuinMobile](https://github.com/Sombooo/FuinMobile)

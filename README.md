<div align="center">
  
# ⬡ Fuin Mobile
**Quietly secure on the go.**

The official mobile companion for the [Fuin](https://github.com/Sombooo/Fuin) local-first password manager. Built for privacy.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform: iOS | Android](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-lightgray.svg)](#)

</div>

<br />

> [!NOTE]
> **Vibe Coding Project:** Fuin Mobile is built with AI-assisted "vibe coding". While it implements strict offline-first security principles, please explore, audit, and use it at your own discretion.

## What is Fuin Mobile?

Fuin Mobile brings your Fuin password vault to your pocket without compromising on privacy. 

Just like the desktop application, Fuin Mobile operates **completely offline**. It has no internet connectivity requirements, connects to no remote servers, and uses no third-party cloud infrastructure.

- **Air-Gapped QR Sync (V2):** Sync your vault from your computer by simply scanning animated QR codes with your camera—completely offline, with zero network or Bluetooth exposure.
- **Biometric Authentication:** Seamless and secure access using Face ID, Touch ID, or Android Biometrics.
- **Screen Capture Protection:** Built-in safeguards automatically block screenshots and screen recordings while viewing sensitive credentials.
- **Zero Cloud Dependence:** No accounts, no telemetry, no tracking, and no subscriptions.

---

## ⚙️ Security & Architecture

Fuin Mobile is built with proven, modern cryptography calibrated specifically for mobile hardware:

- **Authenticated Local Encryption:** Your mobile vault is encrypted locally with **AES-256-GCM** using random nonces.
- **Key Derivation (Argon2id):** When you set a local password, it is derived using **Argon2id** (64 MiB memory, 3 iterations) to resist brute-force attacks while ensuring rapid, responsive unlock times on mobile processors without triggering OS memory termination.
- **Air-Gapped Sync Cryptography:** Cross-device transfer envelopes are encrypted using **XChaCha20-Poly1305** and protected by replay-resistant generational markers and snapshot hashing.

---

## 🚀 Development & Running from Source

Fuin Mobile is built with **React Native** and **Expo**.

### Prerequisites
- Node.js (v18+)
- Expo CLI

### Setup
```bash
# Clone the repository
git clone https://github.com/Sombooo/FuinMobile.git
cd FuinMobile

# Install dependencies
npm install

# Start the Expo development server
npx expo start
```

---

## ☕ Support the Development

Fuin is an independent, open-source project. If you enjoy the absolute privacy and security it provides, consider supporting the continuous development of the desktop and mobile apps!

[![Support via Lemon Squeezy](https://img.shields.io/badge/Support_Fuin-Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://fuindev.lemonsqueezy.com/checkout/buy/c898c753-098b-4c0b-a721-77332db06bdc)

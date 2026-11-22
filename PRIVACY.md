# PRIVACY POLICY & DISCLOSURES

Fuin Mobile is built on a strict **local-first, zero-knowledge** privacy model.

## 1. What We Do Not Collect
- **No Cloud Infrastructure:** Your vault is never uploaded to or stored on any remote server.
- **No User Accounts:** Fuin Mobile requires no sign-up, email address, or personal identifier.
- **No Telemetry or Analytics:** Fuin Mobile contains zero analytics SDKs, advertising identifiers, or crash-reporting trackers.

## 2. Local Data Storage
All passwords, TOTP secrets, categories, and notes are encrypted with **AES-256-GCM** and stored exclusively in your device's sandboxed application storage and hardware-backed `SecureStore`.

## 3. Cross-Device Synchronization
Your data only moves between your own devices when you explicitly initiate a sync session:
- **Local LAN Sync (P2P):** Transfers XChaCha20-Poly1305 encrypted vault packets directly between Fuin Mobile and Fuin Desktop over your private local network (RFC1918 Wi-Fi or phone hotspot) using a temporary 120-second listener. Initial device trust is established once via an optical QR code pairing exchange. No third-party servers, relays, or cloud intermediaries are ever involved.

## 4. Device Permissions
- **Camera (`CAMERA`):** Used exclusively on demand to scan the one-time device pairing QR code from Fuin Desktop and `otpauth://` 2FA QR codes.
- **Biometrics (`USE_BIOMETRIC` / `NSFaceIDUsageDescription`):** Used locally to unlock your vault via Android BiometricPrompt, Touch ID, or Face ID.

## 5. Optional External Network Requests & Local LAN Transport
Fuin Mobile operates completely offline by default. External HTTPS requests occur only in two user-initiated scenarios (strictly pinned to `https://` endpoints):
1. **Password Breach Check (HIBP k-Anonymity):** When you manually run a breach scan in Tools, Fuin Mobile sends only the first **5 characters** of each password's SHA-1 hash to `https://api.pwnedpasswords.com/range/`. Full hashes and plaintext passwords never leave your device.
2. **Release Update Check:** Checking for app updates queries the public GitHub Releases API (`https://api.github.com/repos/Sombooo/FuinMobile/releases`) over HTTPS, verifies APK signing certificate continuity and SHA-256 digests, and installs only upon explicit user action.
- **Android Local LAN Note:** Android cleartext HTTP capability is used solely during user-initiated LAN P2P sync targeting strictly validated private `RFC1918` / loopback IPv4 addresses (HTTP redirects disabled).

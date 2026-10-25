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
- **Local LAN Sync (P2P):** Transfers XChaCha20-Poly1305 encrypted vault packets directly between Fuin Mobile and Fuin Desktop over your local Wi-Fi network (strictly restricted to private RFC1918 IP addresses).
- **Air-Gap QR Sync (V2):** Transfers encrypted vault chunks optically via animated QR codes using the device camera with zero network connectivity required.

## 4. Device Permissions
- **Camera (`CAMERA`):** Used exclusively on demand to scan pairing and Air-Gap sync QR codes from Fuin Desktop.
- **Biometrics (`USE_BIOMETRIC` / `NSFaceIDUsageDescription`):** Used locally to unlock your vault via Android BiometricPrompt, Touch ID, or Face ID.

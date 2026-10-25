# SECURITY ARCHITECTURE

Fuin Mobile is engineered around a strict **zero-knowledge, offline-first, peer-to-peer** security model.

## 1. Local Vault Cryptography
- **Key Derivation (Argon2id):** Master passwords and recovery keys are derived locally using **Argon2id** (`m = 65536` [64 MiB], `t = 3`, `p = 1`) via native C/C++ bindings (`react-native-argon2`).
- **Authenticated Encryption at Rest:** The local vault is encrypted with **AES-256-GCM** using 96-bit CSPRNG nonces and 128-bit authentication tags (`react-native-quick-crypto`), persisted via atomic `.tmp` + `.bak` replacement transactions.
- **Brute-Force & Tamper Defense:**
  - Failed login attempts are tracked in hardware-backed `SecureStore`. After 3 failed attempts, exponential backoff (`5s` up to `300s`) is enforced.
  - After 15 consecutive failed attempts, the local vault is automatically erased to protect against physical device extraction.
  - Recovery code verification uses `crypto.timingSafeEqual` and independent exponential backoff throttling.

## 2. Session, Screen & Clipboard Hygiene
- **Screen Capture Prevention:** Enforces `ScreenCapture.preventScreenCaptureAsync()` to block screenshots, screen recording, and app-switcher previews.
- **Auto-Expiring Clipboard:** Copied passwords and usernames are automatically cleared after 30–45 seconds using constant-time SHA-256 hash comparison so unrelated user clipboard data is not overwritten.
- **Background Auto-Lock:** Automatically locks the vault and clears in-memory state when the app transitions to the background beyond the configured grace period.

## 3. Hybrid P2P Synchronization Security
- **Local LAN Sync (P2P):**
  - Uses a 256-bit symmetric `pairKey` exchanged optically via QR code and authenticated with **XChaCha20-Poly1305**.
  - Enforces strict **RFC1918 / Loopback** IP validation to prevent SSRF or external traffic leakage.
  - Verifies directional markers (`direction === 'response'`), `requestNonce` cryptographic binding, 120-second timestamp freshness, and response nonce uniqueness to defeat LAN reflection and replay attacks.
- **Air-Gap QR Sync (V2):**
  - Verifies CRC-32 frame checksums, Base45 encoding, XChaCha20-Poly1305 authentication tags, and strictly increasing `generation` counters to prevent rollback attacks.

## Responsible Disclosure
If you discover a security vulnerability, please open a confidential security advisory on GitHub or contact the maintainers before public disclosure.

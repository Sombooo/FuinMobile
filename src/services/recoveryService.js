'use strict';

/**
 * FuinMobile Recovery Key Service (recoveryService.js)
 *
 * Consolidates mobile recovery key generation, authenticated AES-256-GCM encryption
 * (keyed via Argon2id deriveLocalKey), SecureStore persistence, and constant-time
 * recovery verification into a single clean, testable module.
 *
 * Security Invariants:
 * 1. Recovery key is 128-bit CSPRNG formatted as 32 uppercase hex chars in 4-char groups.
 * 2. Wire format: [32-byte salt][12-byte iv][16-byte GCM authTag][ciphertext] (base64).
 * 3. Only SHA-256(canonicalKey) and the AES-256-GCM ciphertext are written to SecureStore.
 *    Plaintext recovery keys and master passwords are NEVER persisted to SecureStore.
 * 4. Constant-time comparison (crypto.timingSafeEqual) is used for hash verification.
 * 5. Derived key and plaintext buffers are explicitly zeroized (.fill(0)) in finally blocks.
 * 6. Legacy plaintext keys ('fuin-recovery-code', 'fuin-recovery-pass') are supported on
 *    read-fallback and automatically deleted upon successful creation or recovery.
 */

const RECOVERY_HASH_KEY = 'fuin-recovery-code-hash';
const RECOVERY_DATA_KEY = 'fuin-recovery-data';
const LEGACY_CODE_KEY = 'fuin-recovery-code';
const LEGACY_PASS_KEY = 'fuin-recovery-pass';

const SALT_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = SALT_BYTES + IV_BYTES + TAG_BYTES; // 60 bytes
const KEY_ENTROPY_BYTES = 16;
const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;

function getCryptoModule(deps) {
  if (deps && deps.crypto) return deps.crypto;
  try {
    return require('react-native-quick-crypto');
  } catch {
    try {
      return require('crypto');
    } catch {
      return null;
    }
  }
}

function getBufferModule(deps) {
  if (deps && deps.Buffer) return deps.Buffer;
  try {
    return require('@craftzdog/react-native-buffer').Buffer;
  } catch {
    try {
      return require('buffer').Buffer;
    } catch {
      return typeof Buffer !== 'undefined' ? Buffer : null;
    }
  }
}

function getSecureStoreModule(deps) {
  if (deps && deps.secureStore) return deps.secureStore;
  return require('expo-secure-store');
}

function getDeriveLocalKeyFn(deps) {
  if (deps && typeof deps.deriveLocalKey === 'function') return deps.deriveLocalKey;
  return require('../crypto').deriveLocalKey;
}

function zeroizeBuffer(buf) {
  if (buf && typeof buf.fill === 'function') {
    try {
      buf.fill(0);
    } catch {}
  }
}

function normalizeRecoveryKey(rawKey) {
  return String(rawKey || '').trim().toUpperCase();
}

/**
 * Generates a 128-bit CSPRNG recovery key formatted as:
 * XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (32 uppercase hex chars grouped in 4s).
 */
function generateMobileRecoveryKey(randomBytesFn) {
  const usingCustomRng = typeof randomBytesFn === 'function';
  let keyBytes;
  if (usingCustomRng) {
    keyBytes = randomBytesFn(KEY_ENTROPY_BYTES);
  } else {
    const cryptoMod = getCryptoModule();
    if (!cryptoMod || typeof cryptoMod.randomBytes !== 'function') {
      throw new Error('RecoveryService: No CSPRNG provider available');
    }
    keyBytes = cryptoMod.randomBytes(KEY_ENTROPY_BYTES);
  }

  if (!keyBytes || keyBytes.length !== KEY_ENTROPY_BYTES) {
    throw new Error('RecoveryService: Expected 16 random bytes for recovery key');
  }

  try {
    const hex = Array.from(keyBytes)
      .map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase())
      .join('');
    return hex.match(/.{4}/g).join('-');
  } finally {
    if (!usingCustomRng) {
      zeroizeBuffer(keyBytes);
    }
  }
}

/**
 * Encrypts the master password with a key derived via deriveLocalKey(canonicalKey, salt)
 * using AES-256-GCM. Wire format: [32B salt][12B iv][16B authTag][ciphertext] (base64).
 */
async function encryptPasswordForRecovery(masterPassword, rawRecoveryKey, deps = {}) {
  if (typeof masterPassword !== 'string' || masterPassword.length === 0) {
    throw new Error('RecoveryService: Master password is required');
  }
  const canonicalKey = normalizeRecoveryKey(rawRecoveryKey);
  if (!canonicalKey) {
    throw new Error('RecoveryService: Recovery key is required');
  }

  const cryptoMod = getCryptoModule(deps);
  const BufferClass = getBufferModule(deps);
  const deriveLocalKey = getDeriveLocalKeyFn(deps);

  if (!cryptoMod || !BufferClass || typeof deriveLocalKey !== 'function') {
    throw new Error('RecoveryService: Missing cryptographic dependencies');
  }

  const recoverySalt = cryptoMod.randomBytes(SALT_BYTES);
  const iv = cryptoMod.randomBytes(IV_BYTES);
  let recoveryKey = null;
  let plainBuf = null;

  try {
    recoveryKey = await deriveLocalKey(canonicalKey, recoverySalt);
    plainBuf = BufferClass.from(masterPassword, 'utf8');

    const cipher = cryptoMod.createCipheriv('aes-256-gcm', recoveryKey, iv);
    const enc1 = cipher.update(plainBuf);
    const enc2 = cipher.final();
    const tag = cipher.getAuthTag();

    const encryptedPassB64 = BufferClass.concat([recoverySalt, iv, tag, enc1, enc2]).toString('base64');
    const keyHashHex = cryptoMod.createHash('sha256').update(canonicalKey).digest('hex');

    return { keyHashHex, encryptedPassB64 };
  } finally {
    zeroizeBuffer(recoveryKey);
    zeroizeBuffer(plainBuf);
  }
}

/**
 * Generates a fresh recovery key, encrypts masterPassword, stores only the hash and
 * ciphertext in SecureStore, deletes any legacy plaintext keys, and returns the key.
 */
async function createAndStoreRecoveryKey(masterPassword, deps = {}) {
  const cryptoMod = getCryptoModule(deps);
  const secureStore = getSecureStoreModule(deps);

  const randomBytesFn =
    typeof deps.randomBytes === 'function'
      ? deps.randomBytes
      : (n) => cryptoMod.randomBytes(n);

  const rawMasterKey = generateMobileRecoveryKey(randomBytesFn);
  const { keyHashHex, encryptedPassB64 } = await encryptPasswordForRecovery(
    masterPassword,
    rawMasterKey,
    deps
  );

  await secureStore.setItemAsync(RECOVERY_HASH_KEY, keyHashHex);
  await secureStore.setItemAsync(RECOVERY_DATA_KEY, encryptedPassB64);

  // Clean up any legacy plaintext recovery entries
  await secureStore.deleteItemAsync(LEGACY_CODE_KEY).catch(() => {});
  await secureStore.deleteItemAsync(LEGACY_PASS_KEY).catch(() => {});

  return rawMasterKey;
}

/**
 * Checks whether a recovery key is currently stored (modern encrypted format or legacy).
 */
async function hasStoredRecoveryKey(deps = {}) {
  try {
    const secureStore = getSecureStoreModule(deps);
    const savedHashHex = await secureStore.getItemAsync(RECOVERY_HASH_KEY);
    if (savedHashHex) return true;
    const legacyKey = await secureStore.getItemAsync(LEGACY_CODE_KEY);
    return Boolean(legacyKey);
  } catch {
    return false;
  }
}

/**
 * Verifies user-supplied recovery key using constant-time SHA-256 comparison and
 * decrypts the stored master password. Supports legacy plaintext fallback & cleanup.
 *
 * Returns { ok: true, password } or { ok: false, reason: 'none' | 'invalid' }.
 */
async function verifyAndRecoverPassword(inputKey, deps = {}) {
  const cryptoMod = getCryptoModule(deps);
  const BufferClass = getBufferModule(deps);
  const secureStore = getSecureStoreModule(deps);
  const deriveLocalKey = getDeriveLocalKeyFn(deps);

  const savedHashHex = await secureStore.getItemAsync(RECOVERY_HASH_KEY);
  const encryptedPassB64 = await secureStore.getItemAsync(RECOVERY_DATA_KEY);
  const legacyKey = await secureStore.getItemAsync(LEGACY_CODE_KEY);
  const legacyPass = await secureStore.getItemAsync(LEGACY_PASS_KEY);

  if (!savedHashHex && !legacyKey) {
    return { ok: false, reason: 'none' };
  }

  const input = normalizeRecoveryKey(inputKey);
  if (!input) {
    return { ok: false, reason: 'invalid' };
  }

  if (savedHashHex && encryptedPassB64) {
    if (typeof savedHashHex !== 'string' || !SHA256_HEX_RE.test(savedHashHex)) {
      return { ok: false, reason: 'invalid' };
    }

    const inputHash = cryptoMod.createHash('sha256').update(input).digest();
    const targetHash = BufferClass.from(savedHashHex, 'hex');

    if (
      inputHash.length !== targetHash.length ||
      !cryptoMod.timingSafeEqual(inputHash, targetHash)
    ) {
      return { ok: false, reason: 'invalid' };
    }

    let payload = null;
    let recoveryKey = null;
    let decrypted = null;

    try {
      payload = BufferClass.from(encryptedPassB64, 'base64');
      if (payload.length <= HEADER_BYTES) {
        return { ok: false, reason: 'invalid' };
      }

      const recoverySalt = payload.subarray(0, SALT_BYTES);
      const iv = payload.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
      const authTag = payload.subarray(SALT_BYTES + IV_BYTES, HEADER_BYTES);
      const ciphertext = payload.subarray(HEADER_BYTES);

      recoveryKey = await deriveLocalKey(input, recoverySalt);
      const decipher = cryptoMod.createDecipheriv('aes-256-gcm', recoveryKey, iv);
      decipher.setAuthTag(authTag);

      const dec1 = decipher.update(ciphertext);
      const dec2 = decipher.final();
      decrypted = BufferClass.concat([dec1, dec2]);

      return { ok: true, password: decrypted.toString('utf8') };
    } catch {
      return { ok: false, reason: 'invalid' };
    } finally {
      zeroizeBuffer(recoveryKey);
      zeroizeBuffer(decrypted);
      zeroizeBuffer(payload);
    }
  }

  if (legacyKey && legacyPass) {
    const inputHash = cryptoMod.createHash('sha256').update(input).digest();
    const targetHash = cryptoMod
      .createHash('sha256')
      .update(normalizeRecoveryKey(legacyKey))
      .digest();

    if (
      inputHash.length === targetHash.length &&
      cryptoMod.timingSafeEqual(inputHash, targetHash)
    ) {
      await secureStore.deleteItemAsync(LEGACY_CODE_KEY).catch(() => {});
      await secureStore.deleteItemAsync(LEGACY_PASS_KEY).catch(() => {});
      return { ok: true, password: legacyPass };
    }

    return { ok: false, reason: 'invalid' };
  }

  return { ok: false, reason: 'invalid' };
}

module.exports = {
  RECOVERY_HASH_KEY,
  RECOVERY_DATA_KEY,
  LEGACY_CODE_KEY,
  LEGACY_PASS_KEY,
  normalizeRecoveryKey,
  generateMobileRecoveryKey,
  encryptPasswordForRecovery,
  createAndStoreRecoveryKey,
  hasStoredRecoveryKey,
  verifyAndRecoverPassword,
};

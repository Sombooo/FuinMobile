import crypto from 'react-native-quick-crypto';
import Argon2 from 'react-native-argon2';
import { Buffer } from '@craftzdog/react-native-buffer';

// ── KDF PARAMETER SPECIFICATION & RATIONALE (F-02) ──────────────────────────
// Desktop Vault KDF:  Argon2id (m=131072 KiB / 128 MiB, t=4, p=1)
// Mobile Local Vault: Argon2id (m=65536 KiB / 64 MiB, t=3, p=1)
// Sync V2 KDF:        Argon2id (m=65536 KiB / 64 MiB, t=3, p=4) [uniform cross-device]
//
// Rationale for Mobile Local Vault parameters:
// Mobile devices operate under strict OS memory limits (e.g. iOS Jetsam memory watchdog,
// Android Low Memory Killer) and battery/thermal constraints. Allocating 128 MiB on
// resource-constrained or backgrounded mobile devices risks immediate OS-level process termination.
// Setting m=64 MiB and t=3 maintains RFC 9106 memory-hard resistance against offline
// GPU/ASIC brute-force attacks while guaranteeing reliable sub-second unlock performance
// without freezing the mobile UI thread or triggering watchdog OOM kills.
const MEM_COST = 65536;    // 64 MiB (RFC 9106 memory-hard constraint)
const TIME_COST = 3;        // 3 iterations
const PARALLELISM = 1;      // 1 lane (optimal for single-threaded mobile JSI)


// ═══════════════════════════════════════════════════════════════════
// LOCAL VAULT ENCRYPTION
// ═══════════════════════════════════════════════════════════════════
export async function deriveArgonKeyWithParams(password, saltBuffer, memory, iterations, parallelism) {
  const saltHex = saltBuffer.toString('hex');
  const result = await Argon2(password, saltHex, {
    iterations,
    memory,
    parallelism,
    hashLength: 32,
    mode: 'argon2id',
    saltEncoding: 'hex'
  });
  return Buffer.from(result.rawHash, 'hex');
}

export async function deriveLocalKey(password, saltBuffer) {
  return deriveArgonKeyWithParams(password, saltBuffer, MEM_COST, TIME_COST, PARALLELISM);
}

export async function encryptLocalVault(vaultJsonString, password) {
  const localSalt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  let localKey = null;
  let plainBuf = null;

  try {
    localKey = await deriveLocalKey(password, localSalt);
    plainBuf = Buffer.from(vaultJsonString, 'utf8');

    const cipher = crypto.createCipheriv('aes-256-gcm', localKey, iv);
    const enc1 = cipher.update(plainBuf);
    const enc2 = cipher.final();
    const tag = cipher.getAuthTag();
    
    // Format: [localSalt32][iv12][tag16][ciphertext]
    const packet = Buffer.concat([localSalt, iv, tag, enc1, enc2]);
    return packet.toString('base64');
  } finally {
    if (localKey) {
      try { localKey.fill(0); } catch {}
    }
    if (plainBuf) {
      try { plainBuf.fill(0); } catch {}
    }
  }
}

async function decryptPacketWithArgonParams(b64Packet, password, memory, iterations, parallelism) {
  if (typeof b64Packet !== 'string') throw new Error('Geçersiz veri tipi');
  if (b64Packet.length < 80 || b64Packet.length > 26843545) {
    throw new Error('Lokal kasa dosya boyutu geçersiz');
  }

  let payload = null;
  let localKey = null;
  let decrypted = null;

  try {
    payload = Buffer.from(b64Packet, 'base64');
    if (payload.length < 60) throw new Error('Geçersiz paket boyutu');

    const localSalt = payload.subarray(0, 32);
    const iv = payload.subarray(32, 44);
    const authTag = payload.subarray(44, 60);
    const ciphertext = payload.subarray(60);

    localKey = await deriveArgonKeyWithParams(password, localSalt, memory, iterations, parallelism);

    const decipher = crypto.createDecipheriv('aes-256-gcm', localKey, iv);
    decipher.setAuthTag(authTag);

    const dec1 = decipher.update(ciphertext);
    const dec2 = decipher.final();
    decrypted = Buffer.concat([dec1, dec2]);

    return decrypted.toString('utf8');
  } finally {
    if (localKey) {
      try { localKey.fill(0); } catch {}
    }
    if (payload) {
      try { payload.fill(0); } catch {}
    }
    if (decrypted) {
      try { decrypted.fill(0); } catch {}
    }
  }
}

export async function decryptLocalVault(b64Packet, password) {
  if (typeof b64Packet === 'string' && b64Packet.length > 13981013) {
    throw new Error('Lokal kasa dosya boyutu geçersiz');
  }
  return decryptPacketWithArgonParams(b64Packet, password, MEM_COST, TIME_COST, PARALLELISM);
}

export function extractFuinBackupEnvelope(rawContent) {
  const trimmed = String(rawContent || '').trim();
  let ciphertext = '';
  let kdf = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    const parsedJson = JSON.parse(trimmed);
    if (typeof parsedJson === 'string') {
      ciphertext = parsedJson;
    } else if (parsedJson && typeof parsedJson.ciphertext === 'string') {
      ciphertext = parsedJson.ciphertext;
      if (typeof parsedJson.kdf === 'string') kdf = parsedJson.kdf;
    } else if (parsedJson && typeof parsedJson.data === 'string' && !parsedJson.iv) {
      ciphertext = parsedJson.data;
    }
  } else {
    ciphertext = trimmed;
  }
  if (typeof ciphertext !== 'string' || ciphertext.length < 80) {
    throw new Error('invalid-fuin-format');
  }
  return { ciphertext, kdf };
}

export async function encryptFuinBackupEnvelope(vaultJsonString, password) {
  const ciphertext = await encryptLocalVault(vaultJsonString, password);
  return JSON.stringify({
    format: 'fuin-encrypted-backup',
    version: 1,
    kdf: 'argon2id-64m-3t-1p',
    exportedAt: Date.now(),
    ciphertext,
  }, null, 2);
}

export async function decryptFuinBackup(rawOrCiphertext, password, knownKdf = null) {
  let ciphertext = rawOrCiphertext;
  let kdf = knownKdf;
  if (!kdf && typeof rawOrCiphertext === 'string' && rawOrCiphertext.trim().startsWith('{')) {
    ({ ciphertext, kdf } = extractFuinBackupEnvelope(rawOrCiphertext));
  }
  const useMobileParams = kdf === 'argon2id-64m-3t-1p';
  return decryptPacketWithArgonParams(
    ciphertext,
    password,
    useMobileParams ? MEM_COST : 131072,
    useMobileParams ? TIME_COST : 4,
    1
  );
}

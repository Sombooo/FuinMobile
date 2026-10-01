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
export async function deriveLocalKey(password, saltBuffer) {
  // Argon2 is fully supported now since it's just local (no desktop discrepancy)
  const saltHex = saltBuffer.toString('hex');
  const result = await Argon2(password, saltHex, {
    iterations: TIME_COST,
    memory: MEM_COST,
    parallelism: PARALLELISM,
    hashLength: 32,
    mode: 'argon2id',
    saltEncoding: 'hex'
  });
  return Buffer.from(result.rawHash, 'hex');
}

export async function encryptLocalVault(vaultJsonString, password) {
  const localSalt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  
  const localKey = await deriveLocalKey(password, localSalt);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', localKey, iv);
  const enc1 = cipher.update(Buffer.from(vaultJsonString, 'utf8'));
  const enc2 = cipher.final();
  const tag = cipher.getAuthTag();
  
  // Format: [localSalt32][iv12][tag16][ciphertext]
  const packet = Buffer.concat([localSalt, iv, tag, enc1, enc2]);
  const b64 = packet.toString('base64');
  
  // Zeroize key after encryption
  localKey.fill(0);
  
  return b64;
}

export async function decryptLocalVault(b64Packet, password) {
  if (typeof b64Packet !== 'string') throw new Error('Geçersiz veri tipi');
  if (b64Packet.length < 80 || b64Packet.length > 13981013) {
    throw new Error('Lokal kasa dosya boyutu geçersiz');
  }

  const payload = Buffer.from(b64Packet, 'base64');
  
  const localSalt = payload.subarray(0, 32);
  const iv = payload.subarray(32, 44);
  const authTag = payload.subarray(44, 60);
  const ciphertext = payload.subarray(60);
  
  const localKey = await deriveLocalKey(password, localSalt);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', localKey, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  const vaultString = decrypted.toString('utf8');
  
  // Zeroize sensitive buffers
  localKey.fill(0);
  payload.fill(0);
  decrypted.fill(0);
  
  return vaultString;
}

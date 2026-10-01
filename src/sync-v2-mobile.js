import crypto from "react-native-quick-crypto";

import { Buffer } from '@craftzdog/react-native-buffer';
// Polyfill: base45 lib references global Buffer internally (not available in RN)
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
import Argon2 from 'react-native-argon2';
import * as base45 from 'base45';
import crc32 from 'crc-32';
import cbor from 'cbor';
import { decompress } from 'fzstd';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';


const SESSION_TIMEOUT_MS = 300000; // 5 minutes (matches Desktop)

export class ChunkAssembler {
  constructor() {
    this.chunks = {};
    this.total = 0;
    this.sessionId = null;
    this.startedAt = Date.now();
  }

  reset() {
    this.chunks = {};
    this.total = 0;
    this.sessionId = null;
    this.startedAt = Date.now();
  }

  add(qrString) {
    if (Date.now() - this.startedAt > SESSION_TIMEOUT_MS) {
      this.reset();
      return { error: 'Oturum zaman aşımına uğradı', timedOut: true };
    }

    try {
      const parts = qrString.split('|');
      if (parts.length !== 6 || parts[0] !== 'FUIN' || parts[1] !== '2') {
        throw new Error('Geçersiz veya desteklenmeyen protokol formatı');
      }

      const sessHex = parts[2];
      if (!/^[0-9a-f]{16}$/.test(sessHex)) throw new Error('Geçersiz Session ID');

      const [idxStr, totStr] = parts[3].split('/');
      const index = parseInt(idxStr, 10);
      const total = parseInt(totStr, 10);
      if (index < 1 || total < 1 || index > total) throw new Error('Geçersiz index/total');

      const headerCrc = parts[4];
      if (!/^[0-9A-F]{8}$/.test(headerCrc)) throw new Error('Geçersiz CRC formatı');

      if (!this.sessionId) {
        this.sessionId = sessHex;
        this.total = total;
      } else {
        if (this.sessionId !== sessHex) return { error: 'Farklı oturum (ignored)' };
        if (this.total !== total) throw new Error('Tutarsız total chunk sayısı');
      }

      const decoded = Buffer.from(base45.decode(parts[5]));
      if (this.chunks[index]) {
        if (!this.chunks[index].equals(decoded)) throw new Error('Çakışan kopya parça');
        return this._checkComplete();
      }
      const computedCrc = (crc32.buf(decoded) >>> 0).toString(16).toUpperCase().padStart(8, '0');
      
      if (computedCrc !== headerCrc) {
        throw new Error('CRC uyuşmazlığı'); 
      }

      this.chunks[index] = decoded;
      return this._checkComplete();

    } catch (e) {
      return { error: e.message };
    }
  }

  _checkComplete() {
    const keys = Object.keys(this.chunks);
    if (keys.length === this.total) {
      const buffers = [];
      for (let i = 1; i <= this.total; i++) {
        buffers.push(this.chunks[i]);
      }
      const envelope = Buffer.concat(buffers);
      return { complete: true, envelope, sessionIdHex: this.sessionId };
    }
    return { complete: false, progress: Math.round((keys.length / this.total) * 100) };
  }
}

export async function processSyncEnvelope(envelope, sessionIdHex, syncPassword) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 59) {
    throw new Error('Geçersiz veya bozuk zarf boyutu');
  }

  if (envelope[0] !== 0x46 || envelope[1] !== 0x53 || envelope[2] !== 0x02) {
    throw new Error('Bu senkronizasyon sürümü desteklenmiyor. Lütfen uygulamayı güncelleyin');
  }

  const salt = envelope.subarray(3, 19);
  const nonce = envelope.subarray(19, 43);
  const ciphertextWithTag = envelope.subarray(43);

  const domainString = Buffer.from('FUIN_SYNC_V2', 'utf8');
  const effectiveSalt = Buffer.concat([salt, domainString]);
  
  const argonResult = await Argon2(syncPassword, effectiveSalt.toString('hex'), {
    iterations: 3,
    memory: 65536,
    parallelism: 4,
    hashLength: 32,
    mode: 'argon2id',
    saltEncoding: 'hex'
  });
  const syncKey = Buffer.from(argonResult.rawHash, 'hex');

  const sessionIdBuf = Buffer.from(sessionIdHex, 'hex');
  const aad = Buffer.concat([Buffer.from([0x02]), sessionIdBuf, salt]);

  const cipher = new XChaCha20Poly1305(syncKey);
  let decryptedBytes = null;
  try {
    decryptedBytes = cipher.open(nonce, ciphertextWithTag, aad);
  } catch (e) {
    syncKey.fill(0);
    throw new Error('Yanlış Sync Password veya bozulmuş/tahrif edilmiş veri');
  }
  syncKey.fill(0);

  if (!decryptedBytes) {
    throw new Error('Senkronizasyon verisi doğrulanamadı');
  }

  let decompressedBytes = null;
  try {
    decompressedBytes = Buffer.from(decompress(decryptedBytes));
  } catch (e) {
    Buffer.from(decryptedBytes).fill(0);
    throw new Error('Bozuk senkronizasyon verisi (ZSTD)');
  }
  Buffer.from(decryptedBytes).fill(0);

  let payload = null;
  try {
    payload = cbor.decodeFirstSync(decompressedBytes);
  } catch (e) {
    decompressedBytes.fill(0);
    throw new Error('Bozuk senkronizasyon verisi (CBOR)');
  }

  if (!payload || typeof payload !== 'object') {
    decompressedBytes.fill(0);
    throw new Error('Geçersiz payload formatı');
  }
  
  // Validate protocol
  if (payload.protocol_version !== 2) {
    decompressedBytes.fill(0);
    throw new Error('Bu senkronizasyon sürümü desteklenmiyor. Lütfen uygulamayı güncelleyin');
  }
  
  if (payload.vault_schema_version !== 1) {
    decompressedBytes.fill(0);
    throw new Error('Vault şeması desteklenmiyor. Lütfen uygulamayı güncelleyin');
  }

  // Validate sessionId consistency
  if (Buffer.from(payload.session_id).toString('hex') !== sessionIdHex) {
    decompressedBytes.fill(0);
    throw new Error('Oturum kimliği uyuşmazlığı');
  }

  // Validate snapshot hash
  const canonicalEntries = cbor.encodeOne(payload.entries, { canonical: true });
  const computedHash = crypto.createHash('sha256').update(canonicalEntries).digest();
  
  const expectedHash = Buffer.from(payload.snapshot_hash);
  if (!computedHash.equals(expectedHash)) {
    decompressedBytes.fill(0);
    throw new Error('Senkronizasyon verisi doğrulanamadı (Hash mismatch)');
  }

  decompressedBytes.fill(0);

  return {
    generation: payload.generation,
    snapshotHash: expectedHash.toString('hex'),
    sessionId: sessionIdHex,
    timestamp: payload.timestamp,
    entries: payload.entries
  };
}

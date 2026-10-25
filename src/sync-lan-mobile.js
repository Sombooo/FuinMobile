import { Buffer } from '@craftzdog/react-native-buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import * as SecureStore from 'expo-secure-store';
import crypto from 'react-native-quick-crypto';

export const LAN_SYNC_AAD = Buffer.from('FUIN_LAN_SYNC_V1_PROTOCOL', 'utf8');

/**
 * Verifies if an IPv4/IPv6 address belongs strictly to local private networks (RFC 1918 / loopback / link-local).
 * Prevents SSRF / vault exfiltration via crafted QR codes pointing to public internet hosts.
 */
export function isRFC1918OrLoopback(ip) {
  if (!ip || typeof ip !== 'string') return false;
  let cleanIp = ip.trim();

  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  const lower = cleanIp.toLowerCase();
  if (lower === '::1' || lower === 'localhost') return true;
  if (lower.startsWith('fe80:')) return true;
  if ((lower.startsWith('fc') || lower.startsWith('fd')) && lower.includes(':')) return true;

  const parts = cleanIp.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p) || parseInt(p, 10) < 0 || parseInt(p, 10) > 255)) {
    return false;
  }

  const [a, b] = parts.map(p => parseInt(p, 10));
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

export async function savePairingInfo({ deviceId, pairKey, port, addresses }) {
  if (pairKey !== undefined) {
    if (typeof pairKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pairKey)) {
      throw new Error('Geçersiz eşleşme anahtarı (pairKey 32 bayt hex olmalıdır).');
    }
  }
  const parsedPort = port !== undefined ? Number(port) : 8765;
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error('Geçersiz yerel ağ port numarası.');
  }
  let validAddresses = [];
  if (Array.isArray(addresses) && addresses.length > 0) {
    validAddresses = addresses.filter(ip => isRFC1918OrLoopback(ip));
    if (validAddresses.length === 0) {
      throw new Error('Güvenlik hatası: QR kodundaki adres yerel ağ (RFC1918) adresi değil.');
    }
  }

  if (deviceId) await SecureStore.setItemAsync('fuin_lan_paired_device', String(deviceId));
  if (pairKey) await SecureStore.setItemAsync('fuin_lan_pair_key', pairKey);
  if (port) await SecureStore.setItemAsync('fuin_lan_port', String(parsedPort));
  if (validAddresses.length > 0) {
    await SecureStore.setItemAsync('fuin_lan_addresses', JSON.stringify(validAddresses));
  }
}

export async function getPairingInfo() {
  const deviceId = await SecureStore.getItemAsync('fuin_lan_paired_device');
  const pairKey = await SecureStore.getItemAsync('fuin_lan_pair_key');
  const port = await SecureStore.getItemAsync('fuin_lan_port');
  const addrsStr = await SecureStore.getItemAsync('fuin_lan_addresses');
  let addresses = [];
  try { if (addrsStr) addresses = JSON.parse(addrsStr); } catch {}
  if (Array.isArray(addresses)) {
    addresses = addresses.filter(ip => isRFC1918OrLoopback(ip));
  } else {
    addresses = [];
  }

  if (!pairKey || !deviceId) return null;
  const parsedPort = port ? parseInt(port, 10) : 8765;
  return {
    deviceId,
    pairKey,
    port: (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) ? parsedPort : 8765,
    addresses
  };
}

export async function getMobileDeviceId() {
  let id = await SecureStore.getItemAsync('fuin_mobile_device_id');
  if (!id) {
    id = `mobile-${crypto.randomBytes(8).toString('hex')}`;
    await SecureStore.setItemAsync('fuin_mobile_device_id', id);
  }
  return id;
}

export async function clearPairingInfo() {
  await SecureStore.deleteItemAsync('fuin_lan_paired_device');
  await SecureStore.deleteItemAsync('fuin_lan_pair_key');
  await SecureStore.deleteItemAsync('fuin_lan_port');
  await SecureStore.deleteItemAsync('fuin_lan_addresses');
}

export function encryptLanPayload(dataObj, pairKeyBuf) {
  const cipher = new XChaCha20Poly1305(pairKeyBuf);
  const nonce = crypto.randomBytes(24);
  const plaintext = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ciphertextWithTag = cipher.seal(nonce, plaintext, LAN_SYNC_AAD);

  return {
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertextWithTag).toString('hex')
  };
}

export function decryptLanPayload(packet, pairKeyBuf) {
  const cipher = new XChaCha20Poly1305(pairKeyBuf);
  const nonce = Buffer.from(packet.nonce, 'hex');
  const ciphertextWithTag = Buffer.from(packet.ciphertext, 'hex');
  const decrypted = cipher.open(nonce, ciphertextWithTag, LAN_SYNC_AAD);
  if (!decrypted) {
    throw new Error('LAN senkronizasyonu şifre çözme doğrulaması başarısız (yetkisiz anahtar veya bozuk veri)');
  }
  return JSON.parse(Buffer.from(decrypted).toString('utf8'));
}

const _usedResponseNonces = new Map();
const RESPONSE_NONCE_TTL_MS = 5 * 60 * 1000;

function checkAndRecordResponseNonce(nonce) {
  const now = Date.now();
  for (const [k, ts] of _usedResponseNonces.entries()) {
    if (now - ts > RESPONSE_NONCE_TTL_MS) {
      _usedResponseNonces.delete(k);
    }
  }
  if (_usedResponseNonces.has(nonce)) {
    throw new Error('Güvenlik hatası: Tekrarlanan senkronizasyon yanıtı algılandı (replay engellendi).');
  }
  _usedResponseNonces.set(nonce, now);
}

export async function performLanSync(vaultData) {
  const pairing = await getPairingInfo();
  if (!pairing) {
    throw new Error('Eşleşmiş masaüstü cihazı bulunamadı. Lütfen önce QR ile eşleştirin.');
  }

  let entries = [];
  if (vaultData) {
    if (Array.isArray(vaultData.entries)) {
      entries = vaultData.entries;
    } else if (Array.isArray(vaultData)) {
      entries = vaultData;
    } else if (typeof vaultData === 'string') {
      try {
        const parsed = JSON.parse(vaultData);
        if (Array.isArray(parsed?.entries)) entries = parsed.entries;
      } catch {}
    }
  }

  const pairKeyBuf = Buffer.from(pairing.pairKey, 'hex');
  try {
    const payload = {
      protocol: 'fuin-lan-v1',
      direction: 'request',
      timestamp: Date.now(),
      entries
    };

    const encrypted = encryptLanPayload(payload, pairKeyBuf);
    const mobileDeviceId = await getMobileDeviceId();

    const rawIps = pairing.addresses && pairing.addresses.length > 0 ? pairing.addresses : ['192.168.1.100'];
    const candidateIps = rawIps.filter(ip => isRFC1918OrLoopback(ip));
    if (candidateIps.length === 0) {
      throw new Error('Güvenlik hatası: Geçerli bir yerel ağ (RFC1918) IP adresi bulunamadı.');
    }
    let lastError = null;
    let responseData = null;

    for (const ip of candidateIps) {
      let timer = null;
      try {
        const url = `http://${ip}:${pairing.port}/sync`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) {
          timer = setTimeout(() => controller.abort(), 3500);
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: pairing.deviceId,
            mobileDeviceId,
            deviceName: 'Mobil Cihaz',
            nonce: encrypted.nonce,
            ciphertext: encrypted.ciphertext
          }),
          signal: controller ? controller.signal : undefined
        });

        if (timer) clearTimeout(timer);

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          const errMsg = errJson.error || `HTTP ${res.status}`;
          if (res.status === 401 || res.status === 403 || res.status === 400) {
            if (res.status === 401 || (errMsg && errMsg.toLowerCase().includes('not paired'))) {
              // SECURITY: Never auto-delete local pairKey on unauthenticated HTTP 401 (prevents LAN ARP-spoof unpair DoS)
              lastError = new Error('Masaüstü cihazı eşleşmeyi doğrulayamadı. Masaüstünde eşleşmeyi kaldırdıysanız yeniden QR okutun.');
            } else {
              lastError = new Error(errMsg);
            }
            break;
          }
          throw new Error(errMsg);
        }

        responseData = await res.json();
        if (ip && Array.isArray(pairing.addresses) && pairing.addresses[0] !== ip) {
          pairing.addresses = [ip, ...pairing.addresses.filter(a => a !== ip)];
          savePairingInfo(pairing).catch(() => {});
        }
        break;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastError = e;
      }
    }

    if (!responseData || typeof responseData.nonce !== 'string' || typeof responseData.ciphertext !== 'string') {
      throw new Error(`Masaüstü cihazına bağlanılamadı: ${lastError?.message || 'Zaman aşımı'}`);
    }

    if (responseData.nonce === encrypted.nonce) {
      throw new Error('Güvenlik hatası: İstek paketi yansıtma saldırısı engellendi (reflection).');
    }
    checkAndRecordResponseNonce(responseData.nonce);

    const decryptedResponse = decryptLanPayload({
      nonce: responseData.nonce,
      ciphertext: responseData.ciphertext
    }, pairKeyBuf);

    // Cryptographic direction & request-nonce binding check (prevents Reflection & Stale Response Injection)
    if (
      decryptedResponse.direction !== 'response' ||
      decryptedResponse.requestNonce !== encrypted.nonce
    ) {
      throw new Error('Güvenlik hatası: Senkronizasyon yanıtı bu istekle eşleşmiyor (MitM / Reflection engellendi).');
    }

    // Replay attack guard: Validate response timestamp freshness
    if (decryptedResponse && typeof decryptedResponse.timestamp === 'number') {
      const timeDelta = Math.abs(Date.now() - decryptedResponse.timestamp);
      if (timeDelta > 120000) {
        throw new Error('Senkronizasyon yanıtı zaman aşımına uğramış (replay koruması)');
      }
    }

    return decryptedResponse;
  } finally {
    pairKeyBuf.fill(0);
  }
}

export async function sendPairRequest(pairing) {
  if (!pairing || !pairing.pairKey || !pairing.deviceId) return null;
  if (typeof pairing.pairKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pairing.pairKey)) return null;
  const mobileDeviceId = await getMobileDeviceId();
  const rawIps = pairing.addresses && pairing.addresses.length > 0 ? pairing.addresses : ['192.168.1.100'];
  const candidateIps = rawIps.filter(ip => isRFC1918OrLoopback(ip));
  if (candidateIps.length === 0) return null;

  const pairKeyBuf = Buffer.from(pairing.pairKey, 'hex');
  try {
    const encryptedProof = encryptLanPayload({
      action: 'pair',
      direction: 'request',
      deviceId: mobileDeviceId,
      deviceName: 'Mobil Cihaz',
      timestamp: Date.now()
    }, pairKeyBuf);

    for (const ip of candidateIps) {
      let timer = null;
      try {
        const url = `http://${ip}:${pairing.port}/pair`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) {
          timer = setTimeout(() => controller.abort(), 2000);
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: mobileDeviceId,
            deviceName: 'Mobil Cihaz',
            nonce: encryptedProof.nonce,
            ciphertext: encryptedProof.ciphertext
          }),
          signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (res.ok) {
          const resJson = await res.json();
          if (
            !resJson ||
            typeof resJson.nonce !== 'string' ||
            typeof resJson.ciphertext !== 'string' ||
            resJson.nonce === encryptedProof.nonce
          ) {
            continue;
          }
          const ack = decryptLanPayload({
            nonce: resJson.nonce,
            ciphertext: resJson.ciphertext
          }, pairKeyBuf);
          if (
            !ack ||
            ack.action !== 'pair-ack' ||
            ack.direction !== 'response' ||
            ack.requestNonce !== encryptedProof.nonce
          ) {
            continue;
          }
          if (ip && Array.isArray(pairing.addresses) && pairing.addresses[0] !== ip) {
            pairing.addresses = [ip, ...pairing.addresses.filter(a => a !== ip)];
          }
          return resJson;
        }
      } catch {
        if (timer) clearTimeout(timer);
      }
    }
    return null;
  } finally {
    pairKeyBuf.fill(0);
  }
}

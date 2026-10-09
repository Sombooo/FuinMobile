import { Buffer } from '@craftzdog/react-native-buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import * as SecureStore from 'expo-secure-store';
import crypto from 'react-native-quick-crypto';

export const LAN_SYNC_AAD = Buffer.from('FUIN_LAN_SYNC_V1_PROTOCOL', 'utf8');

export async function savePairingInfo({ deviceId, pairKey, port, addresses }) {
  if (deviceId) await SecureStore.setItemAsync('fuin_lan_paired_device', deviceId);
  if (pairKey) await SecureStore.setItemAsync('fuin_lan_pair_key', pairKey);
  if (port) await SecureStore.setItemAsync('fuin_lan_port', String(port));
  if (addresses && addresses.length > 0) {
    await SecureStore.setItemAsync('fuin_lan_addresses', JSON.stringify(addresses));
  }
}

export async function getPairingInfo() {
  const deviceId = await SecureStore.getItemAsync('fuin_lan_paired_device');
  const pairKey = await SecureStore.getItemAsync('fuin_lan_pair_key');
  const port = await SecureStore.getItemAsync('fuin_lan_port');
  const addrsStr = await SecureStore.getItemAsync('fuin_lan_addresses');
  let addresses = [];
  try { if (addrsStr) addresses = JSON.parse(addrsStr); } catch {}

  if (!pairKey || !deviceId) return null;
  return {
    deviceId,
    pairKey,
    port: port ? parseInt(port, 10) : 8765,
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
  const payload = {
    protocol: 'fuin-lan-v1',
    timestamp: Date.now(),
    entries
  };

  const encrypted = encryptLanPayload(payload, pairKeyBuf);
  const mobileDeviceId = await getMobileDeviceId();

  const candidateIps = pairing.addresses && pairing.addresses.length > 0 ? pairing.addresses : ['192.168.1.100'];
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
          pendingPairKey: pairing.pairKey,
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
          lastError = new Error(errMsg);
          break;
        }
        throw new Error(errMsg);
      }

      responseData = await res.json();
      break;
    } catch (e) {
      if (timer) clearTimeout(timer);
      lastError = e;
    }
  }

  if (!responseData) {
    throw new Error(`Masaüstü cihazına bağlanılamadı: ${lastError?.message || 'Zaman aşımı'}`);
  }

  const decryptedResponse = decryptLanPayload({
    nonce: responseData.nonce,
    ciphertext: responseData.ciphertext
  }, pairKeyBuf);

  return decryptedResponse;
}

export async function sendPairRequest(pairing) {
  if (!pairing || !pairing.pairKey || !pairing.deviceId) return null;
  const mobileDeviceId = await getMobileDeviceId();
  const candidateIps = pairing.addresses && pairing.addresses.length > 0 ? pairing.addresses : ['192.168.1.100'];

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
          pairKeyHex: pairing.pairKey
        }),
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      if (timer) clearTimeout(timer);
    }
  }
  return null;
}

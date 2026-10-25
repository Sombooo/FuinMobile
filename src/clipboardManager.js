import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import crypto from 'react-native-quick-crypto';
import { Buffer } from '@craftzdog/react-native-buffer';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUIN MOBILE — SECURE CLIPBOARD MANAGER (clipboardManager.js)
 *
 * Ensures copied credentials are automatically cleared after specified timeout
 * (default: 45s for passwords, 30s for usernames) even across app backgrounding,
 * navigation, or modal closures.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

let activeTimer = null;
let lastCopiedHash = null;
let expireTimestamp = 0;

function computeClipHash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Copies sensitive text and schedules reliable automatic clearing.
 *
 * @param {string} text
 * @param {number} [durationMs=45000]
 */
export async function copySecure(text, durationMs = 45000) {
  if (typeof text !== 'string') return;
  try {
    await Clipboard.setStringAsync(text);
    lastCopiedHash = computeClipHash(text);
    expireTimestamp = Date.now() + durationMs;

    // Persist only expiry and SHA-256 digest (never plaintext!) to SecureStore
    try {
      await SecureStore.setItemAsync('fuin_clip_expire', expireTimestamp.toString());
      await SecureStore.setItemAsync('fuin_clip_hash', lastCopiedHash);
      await SecureStore.deleteItemAsync('fuin_clip_val').catch(() => {});
    } catch {}

    scheduleClear(durationMs);
  } catch (err) {
    console.warn('[clipboardManager] copySecure error:', err);
  }
}

function scheduleClear(delayMs) {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  activeTimer = setTimeout(async () => {
    await clearIfExpired();
  }, Math.max(100, delayMs));
}

/**
 * Verifies if clipboard expiry timestamp has elapsed, and if so wipes the clipboard.
 * If user has returned to app before expiry, reschedules remaining time.
 */
export async function clearIfExpired() {
  try {
    const now = Date.now();
    let exp = expireTimestamp;
    let savedHash = lastCopiedHash;

    if (!exp) {
      try {
        const storedExp = await SecureStore.getItemAsync('fuin_clip_expire');
        if (storedExp) exp = parseInt(storedExp, 10);
      } catch {}
    }
    if (!savedHash) {
      try {
        savedHash = await SecureStore.getItemAsync('fuin_clip_hash');
      } catch {}
    }

    if (exp && now >= exp) {
      // Time has expired. Check if clipboard still holds Fuin data.
      try {
        const currentClip = await Clipboard.getStringAsync().catch(() => null);
        let shouldClear = !savedHash;
        if (!shouldClear && typeof currentClip === 'string') {
          const currentHashBuf = Buffer.from(computeClipHash(currentClip), 'utf8');
          const savedHashBuf = Buffer.from(String(savedHash), 'utf8');
          if (
            currentHashBuf.length === savedHashBuf.length &&
            crypto.timingSafeEqual(currentHashBuf, savedHashBuf)
          ) {
            shouldClear = true;
          }
        }
        if (shouldClear) {
          await Clipboard.setStringAsync('');
        }
      } catch {}

      expireTimestamp = 0;
      lastCopiedHash = null;
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
      try {
        await SecureStore.deleteItemAsync('fuin_clip_expire');
        await SecureStore.deleteItemAsync('fuin_clip_hash');
        await SecureStore.deleteItemAsync('fuin_clip_val');
      } catch {}
    } else if (exp && now < exp) {
      // Re-schedule for remaining time (e.g. app returned from background)
      scheduleClear(exp - now);
    }
  } catch (err) {
    console.warn('[clipboardManager] clearIfExpired error:', err);
  }
}

// AppState listener: whenever app becomes active, check if clipboard expired or reschedule
if (typeof AppState !== 'undefined' && AppState.addEventListener) {
  AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      clearIfExpired();
    }
  });
}

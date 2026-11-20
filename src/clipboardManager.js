import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { AppState, NativeModules, Platform } from 'react-native';
import crypto from 'react-native-quick-crypto';
import { Buffer } from '@craftzdog/react-native-buffer';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUIN MOBILE — SECURE CLIPBOARD MANAGER (clipboardManager.js)
 *
 * Ensures copied credentials are protected and automatically cleared after the
 * specified timeout (default: 45s for passwords/recovery keys/notes, 30s for
 * usernames/TOTP/cards, 20s for CVV/PIN):
 *  - Android (native FuinClipboardModule): tags ClipData with EXTRA_IS_SENSITIVE,
 *    monitors external clip changes via OnPrimaryClipChangedListener, and clears
 *    via clearPrimaryClip() (API 28+) backed by Handler + OS AlarmManager.
 *  - iOS / web / fallback: uses expo-clipboard with SHA-256 verification and
 *    AppState-aware deferral so background clipboard read limits never drop expiry.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const DEFAULT_CLEAR_MS = 45000;

let activeTimer = null;
let lastCopiedHash = null;
let expireTimestamp = 0;
let copyGeneration = 0;

function getNativeClipboardModule() {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules?.FuinClipboardModule;
  if (!mod || typeof mod.copySensitive !== 'function') return null;
  return mod;
}

function computeClipHash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hashesMatchConstantTime(currentText, savedHash) {
  if (typeof currentText !== 'string' || typeof savedHash !== 'string' || !savedHash) {
    return false;
  }
  const currentHashBuf = Buffer.from(computeClipHash(currentText), 'utf8');
  const savedHashBuf = Buffer.from(savedHash, 'utf8');
  if (currentHashBuf.length !== savedHashBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(currentHashBuf, savedHashBuf);
}

function cancelJsTimer() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

async function clearStoredMetadata() {
  expireTimestamp = 0;
  lastCopiedHash = null;
  cancelJsTimer();
  try {
    await SecureStore.deleteItemAsync('fuin_clip_expire').catch(() => {});
    await SecureStore.deleteItemAsync('fuin_clip_hash').catch(() => {});
    await SecureStore.deleteItemAsync('fuin_clip_val').catch(() => {});
  } catch {}
}

async function readStoredExpiry() {
  if (expireTimestamp) return expireTimestamp;
  try {
    const storedExp = await SecureStore.getItemAsync('fuin_clip_expire');
    if (storedExp) {
      const parsed = parseInt(storedExp, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {}
  return 0;
}

async function readStoredHash() {
  if (lastCopiedHash) return lastCopiedHash;
  try {
    return await SecureStore.getItemAsync('fuin_clip_hash');
  } catch {
    return null;
  }
}

function scheduleClear(delayMs) {
  cancelJsTimer();
  activeTimer = setTimeout(() => {
    clearIfExpired();
  }, Math.max(100, delayMs));
}

/**
 * Copies sensitive text and schedules reliable automatic clearing.
 *
 * @param {string} text
 * @param {number} [durationMs=45000]
 * @param {{ isSensitive?: boolean }} [options={}]
 */
export async function copySecure(text, durationMs = DEFAULT_CLEAR_MS, options = {}) {
  if (typeof text !== 'string') return;
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0
    ? Math.floor(durationMs)
    : 0;
  const isSensitive = options?.isSensitive !== false;
  copyGeneration += 1;

  try {
    const nativeMod = getNativeClipboardModule();
    if (nativeMod) {
      await nativeMod.copySensitive(text, safeDurationMs, isSensitive);

      // Native module owns clip tracking via OnPrimaryClipChangedListener + opaque token.
      // Never persist plaintext or stale JS hash alongside native copy.
      lastCopiedHash = null;
      if (safeDurationMs > 0) {
        expireTimestamp = Date.now() + safeDurationMs;
        try {
          await SecureStore.setItemAsync('fuin_clip_expire', expireTimestamp.toString());
          await SecureStore.deleteItemAsync('fuin_clip_hash').catch(() => {});
          await SecureStore.deleteItemAsync('fuin_clip_val').catch(() => {});
        } catch {}
        scheduleClear(safeDurationMs);
      } else {
        await clearStoredMetadata();
      }
      return;
    }

    // Fallback path (iOS / web / non-native dev environments)
    await Clipboard.setStringAsync(text);

    if (safeDurationMs > 0) {
      lastCopiedHash = computeClipHash(text);
      expireTimestamp = Date.now() + safeDurationMs;

      // Persist only expiry and SHA-256 digest (never plaintext!) to SecureStore
      try {
        await SecureStore.setItemAsync('fuin_clip_expire', expireTimestamp.toString());
        await SecureStore.setItemAsync('fuin_clip_hash', lastCopiedHash);
        await SecureStore.deleteItemAsync('fuin_clip_val').catch(() => {});
      } catch {}

      scheduleClear(safeDurationMs);
    } else {
      await clearStoredMetadata();
    }
  } catch (err) {
    console.warn('[clipboardManager] copySecure error:', err);
  }
}

/**
 * Verifies if clipboard expiry timestamp has elapsed, and if so wipes the clipboard.
 * On Android with native FuinClipboardModule, delegates directly to native clearIfExpired()
 * without reading clipboard plaintext. On fallback platforms, defers clearing while app
 * is not active so OS background clipboard restrictions never drop the pending expiry.
 */
export async function clearIfExpired() {
  try {
    const now = Date.now();
    const nativeMod = getNativeClipboardModule();

    if (nativeMod && typeof nativeMod.clearIfExpired === 'function') {
      const genBeforeNative = copyGeneration;
      let nativeCleared = false;
      try {
        nativeCleared = Boolean(await nativeMod.clearIfExpired());
      } catch (nativeErr) {
        console.warn('[clipboardManager] native clearIfExpired error:', nativeErr);
        return false;
      }

      if (nativeCleared) {
        if (copyGeneration === genBeforeNative) {
          await clearStoredMetadata();
        }
        return true;
      }

      const afterNow = Date.now();
      const exp = await readStoredExpiry();
      if (exp && afterNow >= exp) {
        if (copyGeneration === genBeforeNative) {
          await clearStoredMetadata();
        }
        return false;
      }
      if (exp && afterNow < exp) {
        if (copyGeneration === genBeforeNative) {
          scheduleClear(exp - afterNow);
        }
        return false;
      }
      return false;
    }

    // Fallback path (iOS / web / non-native environments)
    const exp = await readStoredExpiry();
    const savedHash = await readStoredHash();

    if (exp && now >= exp) {
      // Never read clipboard or discard expiry while app is not active:
      // Android 10+ / iOS block background clipboard reads and return '' or fail.
      if (AppState?.currentState && AppState.currentState !== 'active') {
        cancelJsTimer();
        return false;
      }

      const currentClip = await Clipboard.getStringAsync().catch(() => null);
      if (currentClip === null) {
        // Read failed transiently — keep expiry metadata intact for next active retry.
        return false;
      }

      let cleared = false;
      if (currentClip.length > 0) {
        const shouldClear = !savedHash || hashesMatchConstantTime(currentClip, savedHash);
        if (shouldClear) {
          await Clipboard.setStringAsync('');
          cleared = true;
        }
      }

      await clearStoredMetadata();
      return cleared;
    } else if (exp && now < exp) {
      // Re-schedule for remaining time (e.g. app returned from background)
      scheduleClear(exp - now);
      return false;
    }

    return false;
  } catch (err) {
    console.warn('[clipboardManager] clearIfExpired error:', err);
    return false;
  }
}

/**
 * Immediately wipes any pending clipboard secret (e.g. on manual vault lock).
 * On Android native, delegates directly to FuinClipboardModule.clearNow().
 * On fallback platforms, wipes clipboard if the current content matches our hash.
 */
export async function clearClipboardNow() {
  try {
    const nativeMod = getNativeClipboardModule();
    if (nativeMod && typeof nativeMod.clearNow === 'function') {
      await nativeMod.clearNow();
      await clearStoredMetadata();
      return true;
    }

    const exp = await readStoredExpiry();
    const savedHash = await readStoredHash();
    if (!exp && !savedHash) {
      cancelJsTimer();
      return false;
    }

    if (AppState?.currentState && AppState.currentState !== 'active') {
      // Mark already expired so next active transition immediately clears it
      expireTimestamp = 1;
      cancelJsTimer();
      try {
        await SecureStore.setItemAsync('fuin_clip_expire', '1');
      } catch {}
      return false;
    }

    const currentClip = await Clipboard.getStringAsync().catch(() => null);
    if (currentClip === null) {
      expireTimestamp = 1;
      cancelJsTimer();
      try {
        await SecureStore.setItemAsync('fuin_clip_expire', '1');
      } catch {}
      return false;
    }

    let cleared = false;
    if (currentClip.length > 0) {
      const shouldClear = !savedHash || hashesMatchConstantTime(currentClip, savedHash);
      if (shouldClear) {
        await Clipboard.setStringAsync('');
        cleared = true;
      }
    }

    await clearStoredMetadata();
    return cleared;
  } catch (err) {
    console.warn('[clipboardManager] clearClipboardNow error:', err);
    return false;
  }
}

// AppState listener: whenever app becomes active, check if clipboard expired or reschedule
if (typeof AppState !== 'undefined' && typeof AppState.addEventListener === 'function') {
  AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      clearIfExpired();
    }
  });
}

#!/usr/bin/env node
'use strict';

/**
 * FuinMobile Native & Fallback Clipboard Security Test Suite
 * Verifies:
 * 1. Android native FuinClipboardModule delegation (EXTRA_IS_SENSITIVE, zero plaintext)
 * 2. Native clearIfExpired() & clearClipboardNow() delegation (no background clipboard reads)
 * 3. Fallback (iOS / web / non-native) Android 10+ background-deferral bug fix
 * 4. Fallback transient clipboard read failure resilience
 * 5. Fallback external clipboard overwrite protection (SHA-256 + timingSafeEqual)
 * 6. Fallback clearClipboardNow() behavior in active & background states
 * 7. JS call-site hygiene (App.js, VaultScreen.js, GeneratorModal.js, useVaultLifecycle.js)
 * 8. Native Android Kotlin & Expo config-plugin security invariants
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${label}`);
    console.error(`    -> ${err.stack || err.message}`);
    failed++;
  }
}

/**
 * Transforms ES module syntax in src/clipboardManager.js into CommonJS
 * and executes it inside an isolated VM context with controllable mocks,
 * fake clock, and fake timers (zero real timers left open).
 */
function loadClipboardManager({
  platformOS = 'ios',
  nativeModule = null,
  initialAppState = 'active',
  initialClipboard = '',
  initialStore = {},
} = {}) {
  const srcPath = path.join(ROOT, 'src', 'clipboardManager.js');
  const rawSource = fs.readFileSync(srcPath, 'utf8');

  const exportedNames = [];
  let cjsSource = rawSource
    .replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
    .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const {$1} = require('$2');")
    .replace(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
    .replace(/export\s+async\s+function\s+(\w+)\s*\(/g, (_, fnName) => {
      exportedNames.push(fnName);
      return `async function ${fnName}(`;
    })
    .replace(/export\s+function\s+(\w+)\s*\(/g, (_, fnName) => {
      exportedNames.push(fnName);
      return `function ${fnName}(`;
    });

  cjsSource += `\nmodule.exports = { ${exportedNames.join(', ')} };\n`;

  let nowMs = 1700000000000;
  let nextTimerId = 1;
  const timers = new Map();

  const store = new Map(Object.entries(initialStore));
  const secureStoreSetCalls = [];
  const secureStoreDeleteCalls = [];

  let clipboardText = initialClipboard;
  let failClipboardGet = false;
  const clipboardSetCalls = [];
  let clipboardGetCalls = 0;

  const appStateListeners = [];
  const AppState = {
    currentState: initialAppState,
    addEventListener(event, cb) {
      if (event === 'change' && typeof cb === 'function') {
        appStateListeners.push(cb);
      }
      return {
        remove() {
          const idx = appStateListeners.indexOf(cb);
          if (idx >= 0) appStateListeners.splice(idx, 1);
        },
      };
    },
  };

  const mocks = {
    'expo-clipboard': {
      async setStringAsync(val) {
        clipboardSetCalls.push(val);
        clipboardText = val;
      },
      async getStringAsync() {
        clipboardGetCalls++;
        if (failClipboardGet) {
          throw new Error('Clipboard unavailable in background');
        }
        return clipboardText;
      },
    },
    'expo-secure-store': {
      async setItemAsync(key, val) {
        secureStoreSetCalls.push([key, val]);
        store.set(key, val);
      },
      async getItemAsync(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async deleteItemAsync(key) {
        secureStoreDeleteCalls.push(key);
        store.delete(key);
      },
    },
    'react-native': {
      AppState,
      Platform: { OS: platformOS },
      NativeModules: nativeModule ? { FuinClipboardModule: nativeModule } : {},
    },
    'react-native-quick-crypto': crypto,
    '@craftzdog/react-native-buffer': { Buffer },
  };

  function FakeDate(...args) {
    if (args.length === 0) return new Date(nowMs);
    return new Date(...args);
  }
  FakeDate.now = () => nowMs;
  FakeDate.UTC = Date.UTC;
  FakeDate.parse = Date.parse;
  FakeDate.prototype = Date.prototype;

  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require(id) {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) {
        return mocks[id];
      }
      throw new Error(`Unexpected require in clipboardManager.js: ${id}`);
    },
    Date: FakeDate,
    setTimeout(fn, delay) {
      const id = nextTimerId++;
      timers.set(id, { fn, runAt: nowMs + (Number(delay) || 0), delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    console: {
      log() {},
      warn() {},
      error() {},
    },
  };

  vm.runInNewContext(cjsSource, sandbox, { filename: 'src/clipboardManager.js' });

  return {
    mod: moduleObj.exports,
    store,
    secureStoreSetCalls,
    secureStoreDeleteCalls,
    clipboardSetCalls,
    get clipboardText() {
      return clipboardText;
    },
    set clipboardText(val) {
      clipboardText = val;
    },
    get clipboardGetCalls() {
      return clipboardGetCalls;
    },
    set failClipboardGet(val) {
      failClipboardGet = val;
    },
    timers,
    advanceTime(ms) {
      nowMs += ms;
    },
    async triggerDueTimers() {
      const due = [];
      for (const [id, entry] of timers.entries()) {
        if (entry.runAt <= nowMs) {
          due.push([id, entry]);
        }
      }
      for (const [id, entry] of due) {
        timers.delete(id);
        await entry.fn();
      }
    },
    async setAppState(nextState, { emit = true } = {}) {
      AppState.currentState = nextState;
      if (emit) {
        for (const cb of [...appStateListeners]) {
          await cb(nextState);
        }
      }
    },
  };
}

async function runAll() {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('FUIN MOBILE CLIPBOARD SECURITY & NATIVE BRIDGE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Android Native Path: copySecure ─────────────────────────────────────
  await test('1. Android native copySecure delegates with isSensitive=true and never persists plaintext', async () => {
    const nativeCalls = { copySensitive: [], clearIfExpired: 0, clearNow: 0, cancelPendingClear: 0 };
    const env = loadClipboardManager({
      platformOS: 'android',
      initialStore: {
        fuin_clip_val: 'stale-legacy-plaintext',
        fuin_clip_hash: 'stale-js-hash',
      },
      nativeModule: {
        async copySensitive(text, durationMs, isSensitive) {
          nativeCalls.copySensitive.push({ text, durationMs, isSensitive });
          return true;
        },
        async clearIfExpired() {
          nativeCalls.clearIfExpired++;
          return false;
        },
        async clearNow() {
          nativeCalls.clearNow++;
          return true;
        },
        async cancelPendingClear() {
          nativeCalls.cancelPendingClear++;
          return true;
        },
      },
    });

    const secret = 'Super$ecret-Fuin-Passw0rd!99';
    await env.mod.copySecure(secret, 45000);

    assert.strictEqual(nativeCalls.copySensitive.length, 1);
    assert.deepStrictEqual(nativeCalls.copySensitive[0], {
      text: secret,
      durationMs: 45000,
      isSensitive: true,
    });
    assert.strictEqual(
      env.clipboardSetCalls.length,
      0,
      'Must NOT call expo-clipboard setStringAsync when native module is active'
    );

    // Zero plaintext in SecureStore anywhere
    for (const [key, val] of env.store.entries()) {
      assert.strictEqual(
        String(val).includes(secret),
        false,
        `Plaintext secret must NEVER appear in SecureStore key "${key}"`
      );
    }
    assert.strictEqual(env.store.has('fuin_clip_val'), false, 'Legacy fuin_clip_val must be deleted');
    assert.strictEqual(env.store.has('fuin_clip_hash'), false, 'Stale fuin_clip_hash must be deleted on native path');
    assert.ok(env.store.get('fuin_clip_expire'), 'Expiry timestamp should be recorded for fallback sync');
    assert.strictEqual(env.timers.size, 1, 'Lightweight JS fallback timer should be scheduled');

    // Explicit isSensitive: false option is respected
    await env.mod.copySecure('public-label', 30000, { isSensitive: false });
    assert.deepStrictEqual(nativeCalls.copySensitive[1], {
      text: 'public-label',
      durationMs: 30000,
      isSensitive: false,
    });

    // durationMs <= 0 passes 0 and clears JS timers/metadata
    await env.mod.copySecure(secret, 0);
    assert.deepStrictEqual(nativeCalls.copySensitive[2], {
      text: secret,
      durationMs: 0,
      isSensitive: true,
    });
    assert.strictEqual(env.timers.size, 0, 'durationMs=0 must not leave a pending JS timer');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
  });

  // ── 2. Android Native Path: clearIfExpired & clearClipboardNow ─────────────
  await test('2. Android native clearIfExpired & clearClipboardNow delegate cleanly without JS clipboard reads', async () => {
    let nativeClearedReturn = false;
    const calls = { clearIfExpired: 0, clearNow: 0 };
    const env = loadClipboardManager({
      platformOS: 'android',
      nativeModule: {
        async copySensitive() {
          return true;
        },
        async clearIfExpired() {
          calls.clearIfExpired++;
          return nativeClearedReturn;
        },
        async clearNow() {
          calls.clearNow++;
          return true;
        },
        async cancelPendingClear() {
          return true;
        },
      },
    });

    await env.mod.copySecure('2fa-987654', 30000);

    // Before expiry: delegates to native clearIfExpired and keeps remaining timer
    env.advanceTime(10000);
    const beforeRes = await env.mod.clearIfExpired();
    assert.strictEqual(beforeRes, false);
    assert.strictEqual(calls.clearIfExpired, 1);
    assert.strictEqual(env.clipboardGetCalls, 0, 'Must never call Clipboard.getStringAsync on Android native path');
    assert.ok(env.store.has('fuin_clip_expire'));

    // After expiry (even while app is in background): delegates to native clearIfExpired & cleans JS metadata
    await env.setAppState('background', { emit: false });
    env.advanceTime(25000);
    nativeClearedReturn = true;
    const afterRes = await env.mod.clearIfExpired();
    assert.strictEqual(afterRes, true);
    assert.strictEqual(calls.clearIfExpired, 2);
    assert.strictEqual(env.clipboardGetCalls, 0, 'Native clearIfExpired must never trigger Clipboard.getStringAsync');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
    assert.strictEqual(env.timers.size, 0);

    // Bridge-latency skew regression: native already expired & cleared (returns true)
    // while JS clock is still a few ms before JS expireTimestamp (now < exp).
    // Must return true, delete fuin_clip_expire, and leave zero spurious timers.
    await env.mod.copySecure('skew-window-secret', 30000);
    env.advanceTime(29980); // 20ms before JS exp, after native exp
    nativeClearedReturn = true;
    const skewRes = await env.mod.clearIfExpired();
    assert.strictEqual(skewRes, true, 'Must return true when native cleared within bridge-latency skew window');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false, 'fuin_clip_expire must be cleared when native cleared');
    assert.strictEqual(env.timers.size, 0, 'Must not schedule spurious JS timer after native already cleared');

    // clearClipboardNow delegates directly to FuinClipboardModule.clearNow()
    await env.mod.copySecure('instant-wipe-secret', 45000);
    assert.strictEqual(env.timers.size, 1);
    const nowRes = await env.mod.clearClipboardNow();
    assert.strictEqual(nowRes, true);
    assert.strictEqual(calls.clearNow, 1);
    assert.strictEqual(env.timers.size, 0);
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
  });

  // ── 3. Fallback Path: Android 10+ / iOS Background Bug Fix ─────────────────
  await test('3. Fallback path preserves expiry in background and wipes once AppState returns active', async () => {
    const env = loadClipboardManager({
      platformOS: 'ios',
      initialAppState: 'active',
    });

    const secret = 'RecoveryKey-XXXX-YYYY-ZZZZ';
    await env.mod.copySecure(secret, 45000);

    assert.strictEqual(env.clipboardText, secret);
    const expectedHash = crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
    assert.strictEqual(env.store.get('fuin_clip_hash'), expectedHash);
    assert.ok(env.store.get('fuin_clip_expire'));
    for (const [, val] of env.store.entries()) {
      assert.strictEqual(String(val).includes(secret), false, 'Plaintext must never be stored in SecureStore');
    }

    // Move app to background and elapse expiry
    await env.setAppState('background', { emit: true });
    env.advanceTime(46000);
    await env.triggerDueTimers();

    // Critical invariant: background expiry MUST NOT discard fuin_clip_expire / fuin_clip_hash
    assert.strictEqual(env.clipboardGetCalls, 0, 'Must not read clipboard while AppState is background');
    assert.strictEqual(env.clipboardText, secret, 'Clipboard untouched while backgrounded on fallback');
    assert.ok(env.store.has('fuin_clip_expire'), 'fuin_clip_expire must remain intact while backgrounded');
    assert.strictEqual(env.store.get('fuin_clip_hash'), expectedHash, 'fuin_clip_hash must remain intact while backgrounded');

    // Return to active -> AppState listener triggers clearIfExpired() -> wipes clipboard & cleans metadata
    await env.setAppState('active', { emit: true });
    // Flush microtasks started by AppState callback
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(env.clipboardGetCalls, 1);
    assert.strictEqual(env.clipboardText, '', 'Clipboard must be wiped once app returns active');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
    assert.strictEqual(env.store.has('fuin_clip_hash'), false);
    assert.strictEqual(env.timers.size, 0);
  });

  // ── 4. Fallback Path: Transient Clipboard Read Failure Resilience ──────────
  await test('4. Fallback path keeps expiry metadata if Clipboard.getStringAsync fails transiently', async () => {
    const env = loadClipboardManager({
      platformOS: 'ios',
      initialAppState: 'active',
    });

    const secret = 'Transient-Fail-Secret-42';
    await env.mod.copySecure(secret, 20000);
    env.advanceTime(25000);

    // Simulate getStringAsync failure
    env.failClipboardGet = true;
    const failedAttempt = await env.mod.clearIfExpired();
    assert.strictEqual(failedAttempt, false);
    assert.ok(env.store.has('fuin_clip_expire'), 'Must retain fuin_clip_expire when clipboard read fails');
    assert.ok(env.store.has('fuin_clip_hash'), 'Must retain fuin_clip_hash when clipboard read fails');

    // Once read succeeds, clipboard is wiped and metadata cleared
    env.failClipboardGet = false;
    const retryAttempt = await env.mod.clearIfExpired();
    assert.strictEqual(retryAttempt, true);
    assert.strictEqual(env.clipboardText, '');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
    assert.strictEqual(env.store.has('fuin_clip_hash'), false);
  });

  // ── 5. Fallback Path: External Clipboard Change Protection ─────────────────
  await test('5. Fallback path never overwrites newer user clipboard content copied elsewhere', async () => {
    const env = loadClipboardManager({
      platformOS: 'ios',
      initialAppState: 'active',
    });

    const fuinSecret = 'Fuin-Original-Password-123!';
    await env.mod.copySecure(fuinSecret, 45000);

    // User copies something else outside Fuin
    const userNewClip = 'Meeting notes at 3pm';
    env.clipboardText = userNewClip;

    env.advanceTime(50000);
    const cleared = await env.mod.clearIfExpired();

    assert.strictEqual(cleared, false);
    assert.strictEqual(
      env.clipboardText,
      userNewClip,
      'User clipboard content copied after Fuin must NOT be overwritten'
    );
    assert.deepStrictEqual(
      env.clipboardSetCalls,
      [fuinSecret],
      'setStringAsync("") must not be called on hash mismatch'
    );
    assert.strictEqual(env.store.has('fuin_clip_expire'), false, 'Stale expiry should be cleaned up');
    assert.strictEqual(env.store.has('fuin_clip_hash'), false, 'Stale hash should be cleaned up');
  });

  // ── 6. Fallback Path: clearClipboardNow ────────────────────────────────────
  await test('6. Fallback clearClipboardNow wipes matching secret, preserves foreign clip, defers in background', async () => {
    const env = loadClipboardManager({
      platformOS: 'ios',
      initialAppState: 'active',
    });

    // Active + matching secret -> immediate wipe
    await env.mod.copySecure('LockWipe-Secret', 45000);
    assert.strictEqual(await env.mod.clearClipboardNow(), true);
    assert.strictEqual(env.clipboardText, '');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);

    // Active + foreign clip -> preserve user's clipboard
    await env.mod.copySecure('LockWipe-Secret-2', 45000);
    env.clipboardText = 'Different user clipboard text';
    assert.strictEqual(await env.mod.clearClipboardNow(), false);
    assert.strictEqual(env.clipboardText, 'Different user clipboard text');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);

    // Background -> marks expired without losing hash, wipes on next active transition
    await env.mod.copySecure('BgLockWipe-Secret', 45000);
    await env.setAppState('background', { emit: false });
    assert.strictEqual(await env.mod.clearClipboardNow(), false);
    assert.strictEqual(env.store.get('fuin_clip_expire'), '1');
    assert.ok(env.store.has('fuin_clip_hash'));

    await env.setAppState('active', { emit: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env.clipboardText, '');
    assert.strictEqual(env.store.has('fuin_clip_expire'), false);
  });

  // ── 7. JS Call-Site Hygiene & Zero Plaintext Static Checks ─────────────────
  await test('7. JS call sites route all secrets through copySecure with no raw ClipboardExpo usage', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
    const vaultSrc = fs.readFileSync(path.join(ROOT, 'src/screens/VaultScreen.js'), 'utf8');
    const genSrc = fs.readFileSync(path.join(ROOT, 'src/screens/GeneratorModal.js'), 'utf8');
    const clipSrc = fs.readFileSync(path.join(ROOT, 'src/clipboardManager.js'), 'utf8');
    const lifecycleSrc = fs.readFileSync(path.join(ROOT, 'src/hooks/useVaultLifecycle.js'), 'utf8');

    // App.js: recovery key copy goes through copySecure, no raw ClipboardExpo left
    assert.strictEqual(appSrc.includes('ClipboardExpo.setStringAsync'), false, 'App.js must not call ClipboardExpo.setStringAsync');
    assert.strictEqual(appSrc.includes("from 'expo-clipboard'"), false, 'Unused expo-clipboard import must be removed from App.js');
    assert.ok(appSrc.includes('copySecure(masterKeyData, 45000)'), 'App.js must copy recovery key via copySecure(masterKeyData, 45000)');

    // VaultScreen.js & GeneratorModal.js: no unused expo-clipboard imports
    assert.strictEqual(vaultSrc.includes("from 'expo-clipboard'"), false, 'Unused expo-clipboard import must be removed from VaultScreen.js');
    assert.strictEqual(genSrc.includes("from 'expo-clipboard'"), false, 'Unused expo-clipboard import must be removed from GeneratorModal.js');
    assert.ok(vaultSrc.includes('copySecure('), 'VaultScreen.js must use copySecure');
    assert.ok(genSrc.includes('copySecure('), 'GeneratorModal.js must use copySecure');

    // clipboardManager.js invariants
    assert.ok(clipSrc.includes('FuinClipboardModule'), 'clipboardManager.js must integrate NativeModules.FuinClipboardModule');
    assert.ok(clipSrc.includes('clearClipboardNow'), 'clipboardManager.js must export clearClipboardNow');
    assert.ok(clipSrc.includes('timingSafeEqual'), 'clipboardManager.js fallback must use constant-time hash comparison');
    assert.strictEqual(clipSrc.includes("setItemAsync('fuin_clip_val'"), false, 'Plaintext fuin_clip_val must never be written');
    assert.ok(clipSrc.includes("setItemAsync('fuin_clip_hash'"), 'Fallback must store SHA-256 hash in fuin_clip_hash');

    // useVaultLifecycle.js calls clearIfExpired on resume
    assert.ok(lifecycleSrc.includes('clearIfExpired()'), 'useVaultLifecycle.js must invoke clearIfExpired() on resume');
  });

  // ── 8. Native Android Kotlin & Expo Plugin Wiring Invariants ───────────────
  await test('8. Native Android clipboard Kotlin modules and manifest enforce all security invariants', () => {
    const helperPath = path.join(ROOT, 'plugins/android/java/FuinClipboardHelper.kt');
    const modulePath = path.join(ROOT, 'plugins/android/java/FuinClipboardModule.kt');
    const receiverPath = path.join(ROOT, 'plugins/android/java/ClipboardClearReceiver.kt');
    const packagePath = path.join(ROOT, 'plugins/android/java/FuinAutofillPackage.kt');
    const pluginPath = path.join(ROOT, 'plugins/withAndroidAutofill.js');

    for (const p of [helperPath, modulePath, receiverPath, packagePath, pluginPath]) {
      assert.ok(fs.existsSync(p), `Required native file missing: ${path.relative(ROOT, p)}`);
    }

    const helperKt = fs.readFileSync(helperPath, 'utf8');
    const moduleKt = fs.readFileSync(modulePath, 'utf8');
    const receiverKt = fs.readFileSync(receiverPath, 'utf8');
    const packageKt = fs.readFileSync(packagePath, 'utf8');
    const pluginJs = fs.readFileSync(pluginPath, 'utf8');

    // Package declarations
    assert.ok(helperKt.includes('package com.sombooosteam.fuin'));
    assert.ok(moduleKt.includes('package com.sombooosteam.fuin'));
    assert.ok(receiverKt.includes('package com.sombooosteam.fuin'));

    // EXTRA_IS_SENSITIVE + PersistableBundle (Android 13+ & Gboard backport)
    assert.ok(helperKt.includes('android.content.extra.IS_SENSITIVE'), 'Helper must define EXTRA_IS_SENSITIVE string');
    assert.ok(helperKt.includes('EXTRA_IS_SENSITIVE'), 'Helper must set EXTRA_IS_SENSITIVE');
    assert.ok(helperKt.includes('PersistableBundle'), 'Helper must attach EXTRA_IS_SENSITIVE via PersistableBundle');

    // API 28+ clearPrimaryClip() with empty fallback
    assert.ok(helperKt.includes('Build.VERSION_CODES.P'), 'clearPrimaryClip() must be guarded by API 28 (P)');
    assert.ok(helperKt.includes('clearPrimaryClip()'), 'Helper must call ClipboardManager.clearPrimaryClip()');

    // AlarmManager + FLAG_IMMUTABLE + Android 12+ exact alarm guard
    assert.ok(helperKt.includes('AlarmManager'), 'Helper must schedule OS-level AlarmManager backup');
    assert.ok(helperKt.includes('FLAG_IMMUTABLE'), 'PendingIntent must include FLAG_IMMUTABLE');
    assert.ok(helperKt.includes('Build.VERSION_CODES.S'), 'canScheduleExactAlarms() must be guarded by API 31 (S)');
    assert.ok(helperKt.includes('canScheduleExactAlarms()'), 'Helper must check canScheduleExactAlarms()');
    assert.ok(helperKt.includes('setAndAllowWhileIdle'), 'Helper must fall back cleanly to setAndAllowWhileIdle');

    // External clipboard overwrite protection via OnPrimaryClipChangedListener
    assert.ok(helperKt.includes('OnPrimaryClipChangedListener'), 'Helper must register OnPrimaryClipChangedListener');
    assert.ok(helperKt.includes('addPrimaryClipChangedListener'), 'Helper must attach OnPrimaryClipChangedListener');

    // Zero plaintext persistence in SharedPreferences / Intent / Logs
    assert.strictEqual(/putString\s*\([^)]*,\s*text\s*\)/.test(helperKt), false, 'Helper must never persist plaintext text in SharedPreferences');
    assert.strictEqual(/putExtra\s*\([^)]*,\s*text\s*\)/.test(helperKt), false, 'Helper must never put plaintext text in Intent extras');
    assert.strictEqual(/Log\.\w+\s*\(/.test(helperKt), false, 'Helper must never log clipboard operations or secrets');

    // React Native bridge methods
    assert.ok(moduleKt.includes('override fun getName(): String = "FuinClipboardModule"'));
    assert.ok(moduleKt.includes('fun copySensitive('));
    assert.ok(moduleKt.includes('fun clearNow('));
    assert.ok(moduleKt.includes('fun clearIfExpired('));
    assert.ok(moduleKt.includes('fun cancelPendingClear('));

    // Receiver action + token guard
    assert.ok(receiverKt.includes('BroadcastReceiver()'));
    assert.ok(receiverKt.includes('ACTION_CLEAR_CLIPBOARD'));
    assert.ok(receiverKt.includes('EXTRA_CLEAR_TOKEN'));
    assert.ok(receiverKt.includes('clearIfTokenMatches('));

    // Package registration & Expo plugin manifest declaration (exported=false)
    assert.ok(packageKt.includes('FuinClipboardModule(reactContext)'), 'FuinAutofillPackage must register FuinClipboardModule');
    assert.ok(pluginJs.includes('.ClipboardClearReceiver'), 'withAndroidAutofill.js must declare .ClipboardClearReceiver');
    assert.ok(
      /ClipboardClearReceiver[\s\S]{0,200}'android:exported':\s*'false'/.test(pluginJs),
      'ClipboardClearReceiver must be declared with android:exported="false" in withAndroidAutofill.js'
    );

    // If local android/ project exists, verify manifest and Kotlin sync parity
    const localManifestPath = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
    if (fs.existsSync(localManifestPath)) {
      const localManifest = fs.readFileSync(localManifestPath, 'utf8');
      assert.ok(
        /<receiver[^>]*android:name="\.ClipboardClearReceiver"[^>]*android:exported="false"|<receiver[^>]*android:exported="false"[^>]*android:name="\.ClipboardClearReceiver"/.test(localManifest),
        'Local AndroidManifest.xml must declare .ClipboardClearReceiver with android:exported="false"'
      );
    }

    const localJavaDir = path.join(ROOT, 'android/app/src/main/java/com/sombooosteam/fuin');
    if (fs.existsSync(localJavaDir)) {
      for (const fileName of ['FuinClipboardHelper.kt', 'FuinClipboardModule.kt', 'ClipboardClearReceiver.kt', 'FuinAutofillPackage.kt']) {
        const pluginContent = fs.readFileSync(path.join(ROOT, 'plugins/android/java', fileName), 'utf8');
        const syncedPath = path.join(localJavaDir, fileName);
        assert.ok(fs.existsSync(syncedPath), `Local android/ is missing synced ${fileName}`);
        const syncedContent = fs.readFileSync(syncedPath, 'utf8');
        assert.strictEqual(syncedContent, pluginContent, `Local android/ ${fileName} is out of sync with plugins/android/java/`);
      }
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`CLIPBOARD SECURITY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

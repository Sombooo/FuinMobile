#!/usr/bin/env node
'use strict';

/**
 * FuinMobile Recovery Service & i18n Parity Test Suite
 *
 * Verifies:
 * 1. recoveryService.js key format, AES-256-GCM wire format, encrypt/decrypt round-trip
 * 2. Derived key buffer zeroization in finally blocks
 * 3. Tampered ciphertext, tampered auth tag, wrong key, and missing key handling
 * 4. Zero plaintext recovery key / master password ever persisted to SecureStore
 * 5. Legacy plaintext fallback recovery & automatic cleanup
 * 6. Static wiring checks across App.js, LockScreen.js, VaultScreen.js, CustomAlert.js
 * 7. Fuin Warm Dark / Warm Paper token invariant (theme.paper / theme.card, never theme.surface)
 * 8. TR/EN 1:1 key parity & placeholder parity in src/i18n.js + zero hardcoded Turkish UI strings
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const recoveryService = require('./src/services/recoveryService');

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

function createMockSecureStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  const setCalls = [];
  const deleteCalls = [];
  return {
    map,
    setCalls,
    deleteCalls,
    async getItemAsync(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItemAsync(key, value) {
      setCalls.push([key, value]);
      map.set(key, String(value));
    },
    async deleteItemAsync(key) {
      deleteCalls.push(key);
      map.delete(key);
    },
  };
}

function createMockDeriveLocalKey(capturedBuffers = []) {
  return async (keyStr, saltBuf) => {
    const derived = crypto.pbkdf2Sync(String(keyStr), saltBuf, 1000, 32, 'sha256');
    capturedBuffers.push(derived);
    return derived;
  };
}

function parseMobileI18nDictionaries() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');
  const match = src.match(/const TRANSLATIONS\s*=\s*(\{[\s\S]*?\n\});/);
  assert.ok(match, 'Could not locate TRANSLATIONS object in src/i18n.js');
  const sandbox = {};
  vm.runInNewContext(`result = ${match[1]};`, sandbox, { filename: 'src/i18n.js' });
  return sandbox.result;
}

function extractPlaceholders(str) {
  const matches = String(str || '').match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return Array.from(new Set(matches)).sort();
}

function findNonCanonicalTurkishStrings(fileRelPath, allowedExactStrings = new Set()) {
  const src = fs.readFileSync(path.join(ROOT, fileRelPath), 'utf8');
  // Strip block comments and line comments
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const hits = [];
  const stringLiteralRe = /(['"`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
  const turkishCharRe = /[çğıöşüÇĞİÖŞÜ]/;
  let m;
  while ((m = stringLiteralRe.exec(noComments)) !== null) {
    const val = m[2];
    if (turkishCharRe.test(val) && !allowedExactStrings.has(val)) {
      hits.push(val);
    }
  }
  return hits;
}

async function runAll() {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('FUIN MOBILE RECOVERY SERVICE & I18N PARITY TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Recovery key generation format ──────────────────────────────────────
  await test('1. generateMobileRecoveryKey formats 16 CSPRNG bytes as 32 uppercase hex chars in 4-char groups', () => {
    const pattern = /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/;

    const deterministic = recoveryService.generateMobileRecoveryKey(() =>
      Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
    );
    assert.strictEqual(deterministic, '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF');
    assert.ok(pattern.test(deterministic));

    const k1 = recoveryService.generateMobileRecoveryKey((n) => crypto.randomBytes(n));
    const k2 = recoveryService.generateMobileRecoveryKey((n) => crypto.randomBytes(n));
    assert.ok(pattern.test(k1), `Key 1 format mismatch: ${k1}`);
    assert.ok(pattern.test(k2), `Key 2 format mismatch: ${k2}`);
    assert.strictEqual(k1.replace(/-/g, '').length, 32);
    assert.notStrictEqual(k1, k2, 'Two generated CSPRNG recovery keys must differ');

    assert.throws(() => recoveryService.generateMobileRecoveryKey(() => Buffer.alloc(8)));
  });

  // ── 2. Encrypt & verify round-trip + wire format + buffer zeroization ──────
  await test('2. encryptPasswordForRecovery & verifyAndRecoverPassword round-trip with exact wire format and buffer zeroization', async () => {
    const secureStore = createMockSecureStore({
      'fuin-recovery-code': 'OLD-LEGACY-CODE',
      'fuin-recovery-pass': 'OLD-LEGACY-PASSWORD',
    });
    const derivedBuffers = [];
    const deps = {
      crypto,
      Buffer,
      secureStore,
      deriveLocalKey: createMockDeriveLocalKey(derivedBuffers),
    };

    const masterPw = 'Fuin-M@st3r-P@ssw0rd-2026!🔐';
    const rawKey = await recoveryService.createAndStoreRecoveryKey(masterPw, deps);

    assert.ok(/^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/.test(rawKey));
    assert.strictEqual(await recoveryService.hasStoredRecoveryKey(deps), true);

    // Zero plaintext stored in SecureStore
    for (const [k, v] of secureStore.map.entries()) {
      assert.strictEqual(v.includes(rawKey), false, `Plaintext recovery key leaked in SecureStore key "${k}"`);
      assert.strictEqual(v.includes(masterPw), false, `Plaintext master password leaked in SecureStore key "${k}"`);
    }
    assert.strictEqual(secureStore.map.has('fuin-recovery-code'), false, 'Legacy fuin-recovery-code must be cleaned up');
    assert.strictEqual(secureStore.map.has('fuin-recovery-pass'), false, 'Legacy fuin-recovery-pass must be cleaned up');
    assert.strictEqual(secureStore.map.has('fuin-recovery-code-hash'), true);
    assert.strictEqual(secureStore.map.has('fuin-recovery-data'), true);

    // Wire format verification: [32B salt][12B iv][16B tag][ciphertext]
    const expectedHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    assert.strictEqual(secureStore.map.get('fuin-recovery-code-hash'), expectedHash);
    const rawPayload = Buffer.from(secureStore.map.get('fuin-recovery-data'), 'base64');
    assert.ok(rawPayload.length > 60, 'Encrypted recovery payload must exceed 60-byte header');

    // Derived key from encryption must already be zeroized in finally
    assert.strictEqual(derivedBuffers.length, 1);
    assert.ok(derivedBuffers[0].every((b) => b === 0), 'Derived key buffer must be zeroized after encryption');

    // Recovery succeeds with whitespace & lowercase input
    const res = await recoveryService.verifyAndRecoverPassword(`  ${rawKey.toLowerCase()}  `, deps);
    assert.deepStrictEqual(res, { ok: true, password: masterPw });

    // Derived key from decryption must also be zeroized in finally
    assert.strictEqual(derivedBuffers.length, 2);
    assert.ok(derivedBuffers[1].every((b) => b === 0), 'Derived key buffer must be zeroized after decryption');
  });

  // ── 3. Tampered ciphertext, tampered auth tag, wrong key, and empty store ──
  await test('3. verifyAndRecoverPassword rejects wrong keys, tampered ciphertext/tag, and reports missing key', async () => {
    const emptyStore = createMockSecureStore();
    const emptyDeps = {
      crypto,
      Buffer,
      secureStore: emptyStore,
      deriveLocalKey: createMockDeriveLocalKey(),
    };
    assert.strictEqual(await recoveryService.hasStoredRecoveryKey(emptyDeps), false);
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222', emptyDeps),
      { ok: false, reason: 'none' }
    );

    const store = createMockSecureStore();
    const deps = {
      crypto,
      Buffer,
      secureStore: store,
      deriveLocalKey: createMockDeriveLocalKey(),
    };
    const rawKey = await recoveryService.createAndStoreRecoveryKey('CorrectHorseBatteryStaple!', deps);

    // Wrong recovery key
    const wrongKey = 'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF';
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword(wrongKey === rawKey ? '0000-0000-0000-0000-0000-0000-0000-0000' : wrongKey, deps),
      { ok: false, reason: 'invalid' }
    );

    // Empty input
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword('   ', deps),
      { ok: false, reason: 'invalid' }
    );

    // Tampered ciphertext byte (offset >= 60)
    const origData = store.map.get('fuin-recovery-data');
    const tamperedCipherBuf = Buffer.from(origData, 'base64');
    tamperedCipherBuf[60] ^= 0xff;
    store.map.set('fuin-recovery-data', tamperedCipherBuf.toString('base64'));
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword(rawKey, deps),
      { ok: false, reason: 'invalid' }
    );

    // Tampered GCM auth tag byte (offset 44..59)
    const tamperedTagBuf = Buffer.from(origData, 'base64');
    tamperedTagBuf[44] ^= 0x01;
    store.map.set('fuin-recovery-data', tamperedTagBuf.toString('base64'));
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword(rawKey, deps),
      { ok: false, reason: 'invalid' }
    );

    // Restoring original ciphertext succeeds again
    store.map.set('fuin-recovery-data', origData);
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword(rawKey, deps),
      { ok: true, password: 'CorrectHorseBatteryStaple!' }
    );
  });

  // ── 4. Legacy plaintext fallback & cleanup ─────────────────────────────────
  await test('4. verifyAndRecoverPassword supports legacy plaintext fallback and deletes legacy keys on match', async () => {
    const store = createMockSecureStore({
      'fuin-recovery-code': 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890',
      'fuin-recovery-pass': 'LegacyVaultPassword#99',
    });
    const deps = {
      crypto,
      Buffer,
      secureStore: store,
      deriveLocalKey: createMockDeriveLocalKey(),
    };

    assert.strictEqual(await recoveryService.hasStoredRecoveryKey(deps), true);

    // Wrong legacy key does not delete stored keys
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword('0000-0000-0000-0000-0000-0000-0000-0000', deps),
      { ok: false, reason: 'invalid' }
    );
    assert.strictEqual(store.map.has('fuin-recovery-code'), true);
    assert.strictEqual(store.map.has('fuin-recovery-pass'), true);

    // Matching legacy key recovers password and purges both legacy plaintext entries
    assert.deepStrictEqual(
      await recoveryService.verifyAndRecoverPassword('abcd-1234-ef56-7890-abcd-1234-ef56-7890', deps),
      { ok: true, password: 'LegacyVaultPassword#99' }
    );
    assert.strictEqual(store.map.has('fuin-recovery-code'), false);
    assert.strictEqual(store.map.has('fuin-recovery-pass'), false);
    assert.strictEqual(await recoveryService.hasStoredRecoveryKey(deps), false);
  });

  // ── 5. Static wiring checks across App.js, LockScreen.js, VaultScreen.js ───
  await test('5. App.js wires createAndStoreRecoveryKey in handleCreateVault, finalizeV2Import, and Settings regeneration', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');

    assert.ok(appSrc.includes("from './src/services/recoveryService'"), 'App.js must import recoveryService');
    assert.ok(appSrc.includes('copySecure(masterKeyData, 45000)'), 'App.js must copy recovery key via copySecure(masterKeyData, 45000)');
    assert.ok(appSrc.includes('onRegenerateRecoveryKey={handleRegenerateRecoveryKey}'), 'App.js must pass onRegenerateRecoveryKey to VaultScreen');

    // Verify finalizeV2Import checks !hasLocalVault + hasStoredRecoveryKey + createAndStoreRecoveryKey
    const finalizeStart = appSrc.indexOf('const finalizeV2Import = async');
    const createStart = appSrc.indexOf('const handleCreateVault = async');
    assert.ok(finalizeStart > 0 && createStart > finalizeStart, 'Expected finalizeV2Import and handleCreateVault in App.js');

    const finalizeBlock = appSrc.slice(finalizeStart, createStart);
    assert.ok(finalizeBlock.includes('!hasLocalVault'), 'finalizeV2Import must check !hasLocalVault');
    assert.ok(finalizeBlock.includes('hasStoredRecoveryKey()'), 'finalizeV2Import must check hasStoredRecoveryKey()');
    assert.ok(finalizeBlock.includes('createAndStoreRecoveryKey(targetMasterPassword)'), 'finalizeV2Import must call createAndStoreRecoveryKey(targetMasterPassword)');

    const regenStart = appSrc.indexOf('const handleRegenerateRecoveryKey = async');
    const createBlock = appSrc.slice(createStart, regenStart);
    assert.ok(createBlock.includes('createAndStoreRecoveryKey(newPassword)'), 'handleCreateVault must call createAndStoreRecoveryKey(newPassword)');
    assert.strictEqual(createBlock.includes("createCipheriv('aes-256-gcm'"), false, 'handleCreateVault must not duplicate inline recovery AES crypto');
  });

  await test('6. LockScreen.js delegates recovery to verifyAndRecoverPassword while retaining backoff lockout', () => {
    const lockSrc = fs.readFileSync(path.join(ROOT, 'src/screens/LockScreen.js'), 'utf8');

    assert.ok(lockSrc.includes("from '../services/recoveryService'"), 'LockScreen.js must import recoveryService');
    assert.ok(lockSrc.includes('verifyAndRecoverPassword(recoveryInput)'), 'LockScreen.js must call verifyAndRecoverPassword(recoveryInput)');
    assert.ok(lockSrc.includes('recoveryLockUntil'), 'LockScreen.js must retain exponential backoff lockout');
    assert.strictEqual(lockSrc.includes("createDecipheriv('aes-256-gcm'"), false, 'LockScreen.js must not duplicate inline recovery decryption');
  });

  await test('7. VaultScreen.js renders Settings Recovery Key card using Warm Dark/Paper tokens (never theme.surface)', () => {
    const vaultSrc = fs.readFileSync(path.join(ROOT, 'src/screens/VaultScreen.js'), 'utf8');

    assert.ok(vaultSrc.includes("from '../services/recoveryService'"), 'VaultScreen.js must import hasStoredRecoveryKey from recoveryService');
    assert.ok(vaultSrc.includes('hasStoredRecoveryKey()'), 'VaultScreen.js must query hasStoredRecoveryKey()');
    assert.ok(vaultSrc.includes("t('recoveryKeySectionTitle')"), 'VaultScreen.js must render Recovery Key Settings section');
    assert.ok(vaultSrc.includes("t('recoveryKeyStatusActive')"), 'VaultScreen.js must render Active status pill');
    assert.ok(vaultSrc.includes("t('recoveryKeyStatusMissing')"), 'VaultScreen.js must render Not Set status pill');
    assert.ok(vaultSrc.includes('onRegenerateRecoveryKey'), 'VaultScreen.js must invoke onRegenerateRecoveryKey');
    assert.ok(vaultSrc.includes('theme.paper'), 'VaultScreen.js must use theme.paper');
    assert.ok(vaultSrc.includes('theme.card'), 'VaultScreen.js must use theme.card');
    assert.strictEqual(vaultSrc.includes('theme.surface'), false, 'VaultScreen.js must NEVER reference theme.surface');
  });

  await test('8. CustomAlert.js matches both TR and EN success/error titles via i18n with zero hardcoded Turkish strings', () => {
    const alertSrc = fs.readFileSync(path.join(ROOT, 'src/components/CustomAlert.js'), 'utf8');

    assert.ok(alertSrc.includes("from '../i18n'"), 'CustomAlert.js must use i18n');
    assert.ok(alertSrc.includes("t('alertSuccess')"), 'CustomAlert.js must match t("alertSuccess")');
    assert.ok(alertSrc.includes("t('alertCopied')"), 'CustomAlert.js must match t("alertCopied")');
    assert.ok(alertSrc.includes("'Success'"), 'CustomAlert.js must match English "Success"');
    assert.ok(alertSrc.includes("'Copied'"), 'CustomAlert.js must match English "Copied"');
    assert.strictEqual(findNonCanonicalTurkishStrings('src/components/CustomAlert.js').length, 0);
  });

  // ── 9. Surgical i18n parity & hardcoded Turkish UI string check ────────────
  await test('9. src/i18n.js has 1:1 TR/EN key parity, placeholder parity, and all new recovery/UI keys', () => {
    const dict = parseMobileI18nDictionaries();
    const trKeys = Object.keys(dict.tr);
    const enKeys = Object.keys(dict.en);

    const missingInEn = trKeys.filter((k) => !Object.prototype.hasOwnProperty.call(dict.en, k));
    const missingInTr = enKeys.filter((k) => !Object.prototype.hasOwnProperty.call(dict.tr, k));
    assert.deepStrictEqual(missingInEn, [], `Keys missing in EN: ${missingInEn.join(', ')}`);
    assert.deepStrictEqual(missingInTr, [], `Keys missing in TR: ${missingInTr.join(', ')}`);

    const turkishCharRe = /[çğıöşüÇĞİÖŞÜ]/;
    for (const k of trKeys) {
      assert.ok(typeof dict.tr[k] === 'string' && dict.tr[k].length > 0, `Empty TR value for ${k}`);
      assert.ok(typeof dict.en[k] === 'string' && dict.en[k].length > 0, `Empty EN value for ${k}`);
      assert.deepStrictEqual(
        extractPlaceholders(dict.tr[k]),
        extractPlaceholders(dict.en[k]),
        `Placeholder mismatch for key "${k}"`
      );
      assert.strictEqual(
        turkishCharRe.test(dict.en[k]),
        false,
        `Turkish character found in EN value for key "${k}": ${dict.en[k]}`
      );
    }

    const requiredNewKeys = [
      'lockWaitSeconds',
      'syncReplayDetected',
      'cameraUnavailable',
      'ioFileReadError',
      'invalidUrlError',
      'whatsNewLatestTag',
      'recoveryKeySectionTitle',
      'recoveryKeyCardTitle',
      'recoveryKeyCardDesc',
      'recoveryKeyStatusActive',
      'recoveryKeyStatusMissing',
      'recoveryKeyBtnCreate',
      'recoveryKeyBtnRegenerate',
      'recoveryKeyCreateConfirm',
      'recoveryKeyRegenerateConfirm',
      'recoveryKeyCreateAction',
      'recoveryKeyRegenerateAction',
      'recoveryRegeneratedTitle',
      'recoveryGenerateFailed',
      'settingsGroupVaultSecurity',
      'settingsGroupSyncBackups',
      'settingsGroupAppearanceSystem',
      'settingsBackupCardTitle',
      'settingsBackupCardSub',
      'btnOpenBackupHistory',
      'btnPortableFuinBackup',
      'settingChangePwTitle',
      'settingChangePwSub',
      'btnChangeMasterPw',
      'changePwModalTitle',
      'changePwModalDesc',
      'changePwCurrentLabel',
      'changePwCurrentPh',
      'changePwNewLabel',
      'changePwNewPh',
      'changePwConfirmLabel',
      'changePwConfirmPh',
      'btnSaveNewMasterPw',
      'changePwSaving',
      'changePwWrongCurrent',
      'changePwMismatch',
      'changePwSameAsOld',
      'changePwMax128Chars',
      'changePwFailed',
      'toastMasterPwChanged',
      'changePwBiometricResetNotice',
      'pairingConfirmTitle',
      'pairingConfirmBody',
      'pairingConfirmSetupBody',
      'btnPairAndSync',
      'pairingInvalidLanQr',
      'repromptModalTitle',
      'repromptModalDesc',
      'repromptPasswordPh',
      'repromptWrongPassword',
      'btnVerify',
    ];
    for (const k of requiredNewKeys) {
      assert.ok(dict.tr[k], `Missing TR key: ${k}`);
      assert.ok(dict.en[k], `Missing EN key: ${k}`);
    }
  });

  await test('10. Target mobile UI files contain zero non-canonical hardcoded Turkish strings', () => {
    const canonicalOnly = new Set(['Diğer']);
    const targets = [
      ['App.js', canonicalOnly],
      ['src/screens/VaultScreen.js', canonicalOnly],
      ['src/screens/LockScreen.js', new Set()],
      ['src/screens/WhatsNewModal.js', new Set()],
      ['src/hooks/useAppUpdater.js', new Set()],
      ['src/components/CustomAlert.js', new Set()],
    ];

    for (const [relPath, allowed] of targets) {
      const hits = findNonCanonicalTurkishStrings(relPath, allowed);
      assert.deepStrictEqual(
        hits,
        [],
        `Found hardcoded Turkish UI strings in ${relPath}: ${JSON.stringify(hits)}`
      );
    }
  });

  // ── 11. Change Master Password wiring in App.js ────────────────────────────
  await test('11. App.js handleChangeMasterPassword enforces constant-time check, disk decrypt, backup, biometric sync, and recovery rotation', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');

    assert.ok(appSrc.includes("import crypto from 'react-native-quick-crypto'"), 'App.js must import react-native-quick-crypto');
    assert.ok(appSrc.includes('onChangeMasterPassword={handleChangeMasterPassword}'), 'App.js must pass onChangeMasterPassword to VaultScreen');

    const startIdx = appSrc.indexOf('const handleChangeMasterPassword = async');
    const endIdx = appSrc.indexOf('const handleVaultErased =');
    assert.ok(startIdx > 0 && endIdx > startIdx, 'Expected handleChangeMasterPassword block before handleVaultErased in App.js');
    const fnBlock = appSrc.slice(startIdx, endIdx);

    // Constant-time SHA-256 verification against active password
    assert.ok(fnBlock.includes("createHash('sha256')"), 'Must hash passwords with SHA-256 before timingSafeEqual');
    assert.ok(fnBlock.includes('crypto.timingSafeEqual('), 'Must compare password digests with crypto.timingSafeEqual');

    // Policy validation
    assert.ok(fnBlock.includes('newPw.length < 8'), 'Must enforce minimum 8-char password policy');
    assert.ok(fnBlock.includes('newPw === currentPw'), 'Must reject newPw identical to currentPw');

    // Disk decrypt verification strictly before backup & overwrite
    const decryptIdx = fnBlock.indexOf('await decryptLocalVault(existingVaultEnc, currentPw)');
    const preBackupIdx = fnBlock.indexOf('await saveVaultBackup(existingVaultEnc)');
    const encryptIdx = fnBlock.indexOf('await encryptLocalVault(plainJson, newPw)');
    const saveIdx = fnBlock.indexOf('await saveVault(newEnc, false)');
    const postBackupIdx = fnBlock.indexOf('await saveVaultBackup(newEnc)');

    assert.ok(fnBlock.includes('await loadVault()'), 'Must load current on-disk vault');
    assert.ok(decryptIdx > 0, 'Must verify on-disk vault decrypts with currentPw');
    assert.ok(preBackupIdx > decryptIdx, 'Protective pre-change backup must happen after disk verification');
    assert.ok(fnBlock.includes('unprotectEntries(parsed.entries)'), 'Must unprotect in-memory entries before serialization');
    assert.ok(encryptIdx > preBackupIdx, 'Re-encryption must happen after pre-change backup');
    assert.ok(saveIdx > encryptIdx, 'saveVault(newEnc, false) must atomically persist re-encrypted vault');
    assert.ok(postBackupIdx > saveIdx, 'saveVaultBackup(newEnc) must back up new encrypted vault');

    // Active password update, biometric Keystore update, and Recovery Key rotation + stale cleanup
    assert.ok(fnBlock.includes('setPassword(newPw)'), 'Must update active password state');
    assert.ok(fnBlock.includes("SecureStore.getItemAsync('fuin-biometric-enabled')"), 'Must check fuin-biometric-enabled');
    assert.ok(fnBlock.includes("SecureStore.setItemAsync('fuin-biometric-key', newPw"), 'Must update fuin-biometric-key to newPw when biometric enabled');
    assert.ok(fnBlock.includes('const newRecKey = await createAndStoreRecoveryKey(newPw)'), 'Must rotate Recovery Key with newPw');
    assert.ok(fnBlock.includes('setMasterKeyData(newRecKey)'), 'Must open masterKeyData modal with rotated recovery key');
    assert.ok(fnBlock.includes("SecureStore.deleteItemAsync('fuin-recovery-code-hash')"), 'Must delete stale recovery hash on rotation failure');
    assert.ok(fnBlock.includes("SecureStore.deleteItemAsync('fuin-recovery-data')"), 'Must delete stale recovery data on rotation failure');
  });

  // ── 12. VaultScreen.js Change Master Password modal, cleanup & calm Settings ─
  await test('12. VaultScreen.js renders Change Master Password modal, clears all 3 inputs, groups Settings calmly, and obeys theme tokens', () => {
    const vaultSrc = fs.readFileSync(path.join(ROOT, 'src/screens/VaultScreen.js'), 'utf8');

    // Prop and modal wiring
    assert.ok(vaultSrc.includes('onChangeMasterPassword'), 'VaultScreen.js must accept and call onChangeMasterPassword');
    assert.ok(vaultSrc.includes('changePwModalVisible'), 'VaultScreen.js must control Change Master Password modal visibility');
    assert.ok(vaultSrc.includes("t('changePwModalTitle')"), 'Modal must render localized title');
    assert.ok(vaultSrc.includes("t('changePwCurrentLabel')"), 'Modal must render Current Master Password input');
    assert.ok(vaultSrc.includes("t('changePwNewLabel')"), 'Modal must render New Master Password input');
    assert.ok(vaultSrc.includes("t('changePwConfirmLabel')"), 'Modal must render Confirm New Master Password input');
    assert.ok(vaultSrc.includes('showCurMasterPw') && vaultSrc.includes('showNewMasterPw') && vaultSrc.includes('showConfirmMasterPw'), 'All 3 password inputs must support eye visibility toggles');
    assert.ok(vaultSrc.includes('changePwError'), 'Modal must render inline validation error feedback');

    // Immediate cleanup of all 3 password input states on close, success, and unmount
    const resetIdx = vaultSrc.indexOf('const resetChangePwForm = useCallback');
    const openIdx = vaultSrc.indexOf('const openChangePwModal = useCallback');
    assert.ok(resetIdx > 0 && openIdx > resetIdx, 'resetChangePwForm helper must exist');
    const resetBlock = vaultSrc.slice(resetIdx, openIdx);
    assert.ok(resetBlock.includes("setCurMasterPw('')"), 'resetChangePwForm must clear curMasterPw');
    assert.ok(resetBlock.includes("setNewMasterPw('')"), 'resetChangePwForm must clear newMasterPw');
    assert.ok(resetBlock.includes("setConfirmMasterPw('')"), 'resetChangePwForm must clear confirmMasterPw');

    const closeIdx = vaultSrc.indexOf('const closeChangePwModal = useCallback');
    const submitIdx = vaultSrc.indexOf('const handleSubmitChangePw = useCallback');
    const backupFnIdx = vaultSrc.indexOf('const handleOpenBackupHistory = useCallback');
    assert.ok(vaultSrc.slice(closeIdx, submitIdx).includes('resetChangePwForm()'), 'closeChangePwModal must call resetChangePwForm()');
    assert.ok(vaultSrc.slice(submitIdx, backupFnIdx).includes('resetChangePwForm()'), 'handleSubmitChangePw must call resetChangePwForm() on success');

    // Calm 3-group Quietly Secure Settings ordering
    const g1Idx = vaultSrc.indexOf("t('settingsGroupVaultSecurity')");
    const g2Idx = vaultSrc.indexOf("t('settingsGroupSyncBackups')");
    const g3Idx = vaultSrc.indexOf("t('settingsGroupAppearanceSystem')");
    assert.ok(g1Idx > 0 && g2Idx > g1Idx && g3Idx > g2Idx, 'Settings must be grouped in order: Vault & Security -> Sync & Backups -> Appearance, Language & System');

    const changePwCardIdx = vaultSrc.indexOf("t('settingChangePwTitle')");
    const recoveryCardIdx = vaultSrc.indexOf("t('recoveryKeySectionTitle')");
    const backupCardIdx = vaultSrc.indexOf("t('settingsBackupCardTitle')");
    assert.ok(changePwCardIdx > g1Idx && changePwCardIdx < g2Idx, 'Change Master Password card must be inside Vault & Security group');
    assert.ok(recoveryCardIdx > changePwCardIdx && recoveryCardIdx < g2Idx, 'Recovery Key card must sit alongside Change Master Password in Vault & Security group');
    assert.ok(backupCardIdx > g2Idx && backupCardIdx < g3Idx, 'Backups & Portable .fuin card must be inside Sync & Backups group');

    // Design tokens & touch responsiveness invariants
    assert.strictEqual(vaultSrc.includes('theme.surface'), false, 'VaultScreen.js must NEVER use theme.surface');
    assert.strictEqual(/\|\|\s*['"]#222019['"]/.test(vaultSrc), false, 'VaultScreen.js must never use dark hex fallback #222019');

    const modalStart = vaultSrc.indexOf('{/* Change Master Password Modal */}');
    const modalEnd = vaultSrc.indexOf('</SafeAreaView>', modalStart);
    assert.ok(modalStart > 0 && modalEnd > modalStart, 'Change Master Password Modal JSX block must exist');
    const modalBlock = vaultSrc.slice(modalStart, modalEnd);
    const touchableMatches = modalBlock.match(/<TouchableOpacity[\s\S]*?>/g) || [];
    assert.ok(touchableMatches.length >= 6, 'Change Master Password modal must render close, 3 eye toggles, cancel, and save touchables');
    for (const tag of touchableMatches) {
      assert.ok(tag.includes('delayPressIn={0}'), `TouchableOpacity missing delayPressIn={0}: ${tag}`);
      assert.ok(tag.includes('activeOpacity={0.7}'), `TouchableOpacity missing activeOpacity={0.7}: ${tag}`);
    }
  });

  // ── 13. Recovery key rotation on Master Password change (runtime roundtrip) ─
  await test('13. Rotating recovery key on Master Password change invalidates old key and recovers new password', async () => {
    const store = createMockSecureStore();
    const deps = {
      crypto,
      Buffer,
      secureStore: store,
      deriveLocalKey: createMockDeriveLocalKey(),
    };

    const oldPw = 'OldMobileMaster#2026';
    const newPw = 'NewMobileMaster#2026!';
    const oldRecKey = await recoveryService.createAndStoreRecoveryKey(oldPw, deps);
    assert.deepStrictEqual(await recoveryService.verifyAndRecoverPassword(oldRecKey, deps), {
      ok: true,
      password: oldPw,
    });

    const newRecKey = await recoveryService.createAndStoreRecoveryKey(newPw, deps);
    assert.notStrictEqual(newRecKey, oldRecKey, 'Rotated recovery key must be freshly generated');
    assert.deepStrictEqual(await recoveryService.verifyAndRecoverPassword(oldRecKey, deps), {
      ok: false,
      reason: 'invalid',
    });
    assert.deepStrictEqual(await recoveryService.verifyAndRecoverPassword(newRecKey, deps), {
      ok: true,
      password: newPw,
    });
  });

  // ── 14. SYNC-01, SYNC-02, SYNC-05, SYNC-06 runtime tests (sync-lan-mobile.js) ─
  await test('14. sync-lan-mobile.js enforces strict IPv4 RFC1918, URL/port validation, no redirects, /pair proof & 401 safety', async () => {
    const rawSrc = fs.readFileSync(path.join(ROOT, 'src', 'sync-lan-mobile.js'), 'utf8');
    const exportedNames = [];
    let cjsSrc = rawSrc
      .replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
      .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const {$1} = require('$2');")
      .replace(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
      .replace(/export\s+const\s+(\w+)\s*=/g, (_, name) => {
        exportedNames.push(name);
        return `const ${name} =`;
      })
      .replace(/export\s+async\s+function\s+(\w+)\s*\(/g, (_, name) => {
        exportedNames.push(name);
        return `async function ${name}(`;
      })
      .replace(/export\s+function\s+(\w+)\s*\(/g, (_, name) => {
        exportedNames.push(name);
        return `function ${name}(`;
      });
    cjsSrc += `\nmodule.exports = { ${exportedNames.join(', ')} };\n`;

    const secureStore = createMockSecureStore();
    const fetchCalls = [];
    let fetchHandler = async () => ({ ok: false, status: 500, redirected: false, async json() { return {}; } });

    const { XChaCha20Poly1305 } = require('@stablelib/xchacha20poly1305');
    const mocks = {
      '@craftzdog/react-native-buffer': { Buffer },
      '@stablelib/xchacha20poly1305': { XChaCha20Poly1305 },
      'expo-secure-store': secureStore,
      'react-native-quick-crypto': crypto,
    };

    const modObj = { exports: {} };
    vm.runInNewContext(cjsSrc, {
      module: modObj,
      exports: modObj.exports,
      Buffer,
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      Date,
      console,
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        return fetchHandler(url, opts);
      },
      require(id) {
        if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
        throw new Error(`Unexpected require in sync-lan-mobile.js: ${id}`);
      },
    }, { filename: 'src/sync-lan-mobile.js' });

    const lan = modObj.exports;

    // Valid RFC1918 / loopback IPv4
    for (const okIp of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.43.1', '127.0.0.1']) {
      assert.strictEqual(lan.isRFC1918OrLoopback(okIp), true, `Expected valid LAN IPv4: ${okIp}`);
    }

    // Rejected SSRF / leading-zero / IPv6 / userinfo / public / link-local
    for (const badIp of [
      '010.8.8.8', '192.168.01.1', '127.0.0.01', '0172.16.0.1',
      'fc:x@attacker.example', 'fd:x@attacker.example', 'fe80:x@attacker.example',
      'fe80::1', 'fc00::1', 'fd12::1', '::1', '::ffff:192.168.1.1', 'localhost',
      '169.254.169.254', '8.8.8.8', '172.15.255.255', '172.32.0.1', '192.169.1.1',
      '192.168.1.1@evil.com', '192.168.1.256', ' 192.168.1.1 ', '', null,
    ]) {
      assert.strictEqual(lan.isRFC1918OrLoopback(badIp), false, `Expected rejected IP: ${String(badIp)}`);
    }

    // buildLanTargetUrl checks
    assert.strictEqual(lan.buildLanTargetUrl('192.168.1.50', 8765, '/sync'), 'http://192.168.1.50:8765/sync');
    assert.strictEqual(lan.buildLanTargetUrl('10.0.0.5', 9000, '/pair'), 'http://10.0.0.5:9000/pair');
    assert.throws(() => lan.buildLanTargetUrl('192.168.1.50', 80, '/sync'));
    assert.throws(() => lan.buildLanTargetUrl('192.168.1.50', 1023, '/sync'));
    assert.throws(() => lan.buildLanTargetUrl('192.168.1.50', 65536, '/sync'));
    assert.throws(() => lan.buildLanTargetUrl('192.168.1.50', 8765, '/evil'));
    assert.throws(() => lan.buildLanTargetUrl('fc:x@attacker.example', 8765, '/sync'));

    // savePairingInfo rejects privileged ports & non-RFC1918 addresses
    const pairKeyHex = crypto.randomBytes(32).toString('hex');
    await assert.rejects(() => lan.savePairingInfo({ deviceId: 'desk-1', pairKey: pairKeyHex, port: 80, addresses: ['192.168.1.10'] }));
    await assert.rejects(() => lan.savePairingInfo({ deviceId: 'desk-1', pairKey: pairKeyHex, port: 8765, addresses: ['fc:x@attacker.example'] }));
    await lan.savePairingInfo({ deviceId: 'desk-1', pairKey: pairKeyHex, port: 8765, addresses: ['192.168.1.10'] });

    // sendPairRequest passes redirect:'error', rejects 307 redirect, and encrypts action:'pair' + direction:'request' + deviceId
    fetchCalls.length = 0;
    fetchHandler = async () => ({ ok: false, status: 307, redirected: true, async json() { return { success: true }; } });
    const redirPair = await lan.sendPairRequest({ deviceId: 'desk-1', pairKey: pairKeyHex, port: 8765, addresses: ['192.168.1.10'] });
    assert.strictEqual(redirPair, null, 'sendPairRequest must reject redirected responses');
    assert.strictEqual(fetchCalls[0].opts.redirect, 'error', 'sendPairRequest must pass redirect:error');
    const pairBody = JSON.parse(fetchCalls[0].opts.body);
    const decryptedProof = lan.decryptLanPayload({ nonce: pairBody.nonce, ciphertext: pairBody.ciphertext }, Buffer.from(pairKeyHex, 'hex'));
    assert.strictEqual(decryptedProof.action, 'pair');
    assert.strictEqual(decryptedProof.direction, 'request');
    assert.ok(typeof decryptedProof.deviceId === 'string' && decryptedProof.deviceId.startsWith('mobile-'));

    // performLanSync passes redirect:'error' and rejects 307 redirect
    fetchCalls.length = 0;
    fetchHandler = async () => ({ ok: true, status: 200, redirected: true, async json() { return {}; } });
    await assert.rejects(() => lan.performLanSync({ entries: [] }), /yönlendirme/i);
    assert.strictEqual(fetchCalls[0].opts.redirect, 'error', 'performLanSync must pass redirect:error');

    // performLanSync handles HTTP 401 cleanly without deleting pairKey
    fetchCalls.length = 0;
    fetchHandler = async () => ({ ok: false, status: 401, redirected: false, async json() { return { error: 'Unauthorized' }; } });
    await assert.rejects(() => lan.performLanSync({ entries: [] }));
    assert.strictEqual(secureStore.map.get('fuin_lan_pair_key'), pairKeyHex, '401 must never auto-delete local pairKey');
  });

  // ── 15. MOB-03 & SYNC-01 UI/Controller Guards (App.js + LockScreen.js) ────
  await test('15. App.js and LockScreen.js enforce lock-screen sync block (MOB-03) and QR pairing confirmation (SYNC-01)', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
    const lockSrc = fs.readFileSync(path.join(ROOT, 'src/screens/LockScreen.js'), 'utf8');

    // LockScreen hides LAN Sync button when hasVault is true
    assert.ok(/\{!hasVault\s*&&\s*\([\s\S]*?t\('lockLanSyncBtn'\)/.test(lockSrc), 'LockScreen.js must hide LAN Sync button when hasVault is true');

    // App.js guards startCameraSync, handleSyncButton, handleBarcodeScanned, handlePerformLanSync
    for (const fnName of ['const handlePerformLanSync =', 'const startCameraSync =', 'const handleSyncButton =', 'const handleBarcodeScanned =']) {
      const idx = appSrc.indexOf(fnName);
      assert.ok(idx > 0, `Expected ${fnName} in App.js`);
      const snippet = appSrc.slice(idx, idx + 320);
      assert.ok(snippet.includes('if (hasLocalVault && !vaultData)'), `${fnName} must guard against locked local vault`);
      assert.ok(snippet.includes("t('syncVaultLockedMsg')"), `${fnName} must alert syncVaultLockedMsg when locked`);
    }

    // App.js QR pairing requires explicit confirmation dialog before overwriting pairing/syncing
    const scanIdx = appSrc.indexOf('const handleBarcodeScanned =');
    const scanEnd = appSrc.indexOf("if (!data.startsWith('FUIN|2|'))", scanIdx);
    const scanBlock = appSrc.slice(scanIdx, scanEnd);
    assert.ok(scanBlock.includes('isRFC1918OrLoopback'), 'handleBarcodeScanned must validate QR IPs via isRFC1918OrLoopback');
    assert.ok(scanBlock.includes("t('pairingConfirmTitle')"), 'handleBarcodeScanned must prompt user confirmation before pairing');
    assert.ok(scanBlock.includes('executeConfirmedQrPairing(sanitizedPairing)'), 'handleBarcodeScanned must execute pairing only on confirmation');
  });

  // ── 16. MOB-01 JS Slice (useAutofillSync.js) ──────────────────────────────
  await test('16. useAutofillSync.js gates syncVault on isEnabled() and clears cache on lock without biometric opt-in', () => {
    const hookSrc = fs.readFileSync(path.join(ROOT, 'src/hooks/useAutofillSync.js'), 'utf8');
    const isEnabledIdx = hookSrc.indexOf('await autofillService.isEnabled()');
    const syncVaultIdx = hookSrc.indexOf('await autofillService.syncVault(');
    assert.ok(isEnabledIdx > 0 && syncVaultIdx > isEnabledIdx, 'useAutofillSync must check autofillService.isEnabled() before syncVault()');
    assert.ok(hookSrc.includes('!cancelled && isAutofillEnabled'), 'syncVault must be gated by isAutofillEnabled');

    const lockBranchIdx = hookSrc.indexOf("else if (mode === 'lock')");
    assert.ok(lockBranchIdx > 0, 'Expected mode === lock branch');
    const lockBlock = hookSrc.slice(lockBranchIdx);
    assert.ok(lockBlock.includes("SecureStore.getItemAsync('fuin-biometric-enabled')"), 'Lock branch must inspect fuin-biometric-enabled');
    assert.ok(lockBlock.includes("bioEnabled !== 'true'"), 'Lock branch must check biometric opt-in strictly');
    assert.ok(lockBlock.includes('autofillService.clearAll()'), 'Lock branch must call autofillService.clearAll() when biometric is not enabled');
  });

  // ── 17. MOB-04 JS Slice (autofillMerge.js runtime) ────────────────────────
  await test('17. autofillMerge.js enforces exact IPv4/IPv6 match, compound ccTLDs, and expanded multi-tenant suffixes', () => {
    const afMerge = require('./src/services/autofillMerge');

    // IPv4 exact matching
    assert.strictEqual(afMerge.getRegistrableDomain('192.168.1.1'), '192.168.1.1');
    assert.strictEqual(afMerge.areDomainsEquivalent('192.168.1.1', '45.33.1.1'), false);
    assert.strictEqual(afMerge.areDomainsEquivalent('http://192.168.1.1:8080/a', 'https://192.168.1.1/b'), true);

    // IPv6 exact matching
    assert.strictEqual(afMerge.areDomainsEquivalent('http://[2001:db8::1]:8080/login', 'https://[2001:db8::1]/auth'), true);
    assert.strictEqual(afMerge.areDomainsEquivalent('http://[2001:db8::1]/login', 'http://[2001:db8::2]/login'), false);

    // Compound ccTLDs (*.<SLD>.<2-char-ccTLD>)
    assert.strictEqual(afMerge.getRegistrableDomain('co.kr'), null);
    assert.strictEqual(afMerge.getRegistrableDomain('bank.co.kr'), 'bank.co.kr');
    assert.strictEqual(afMerge.areDomainsEquivalent('evil.co.kr', 'bank.co.kr'), false);
    assert.strictEqual(afMerge.areDomainsEquivalent('login.bank.co.kr', 'bank.co.kr'), true);
    assert.strictEqual(afMerge.areDomainsEquivalent('evil.com.sg', 'bank.com.sg'), false);
    assert.strictEqual(afMerge.areDomainsEquivalent('evil.gob.mx', 'agency.gob.mx'), false);
    assert.strictEqual(afMerge.areDomainsEquivalent('evil.ac.jp', 'univ.ac.jp'), false);

    // Expanded multi-tenant suffixes
    for (const mt of [
      'wordpress.com', 'blogspot.com', 'tumblr.com', 'azurewebsites.net',
      'appspot.com', 'cloudfront.net', 'run.app', 'replit.app',
      'hf.space', 'webflow.io', 'notion.site', 'itch.io',
    ]) {
      assert.strictEqual(afMerge.areDomainsEquivalent(`alice.${mt}`, `bob.${mt}`), false, `Tenants must be isolated on ${mt}`);
      assert.strictEqual(afMerge.areDomainsEquivalent(`alice.${mt}`, mt), false, `Tenant must not match apex ${mt}`);
      assert.strictEqual(afMerge.areDomainsEquivalent(`app.alice.${mt}`, `alice.${mt}`), true, `Subdomain of same tenant on ${mt} should match`);
    }
  });

  // ── 18. CRYPTO-01 Mobile Merge Slice (sync-merge.js runtime) ──────────────
  await test('18. sync-merge.js coerces non-string site to empty string and allowlists cardBrand', () => {
    const { mergeVaultEntries } = require('./src/sync-merge');
    const res = mergeVaultEntries(
      [],
      [
        { id: 'bad-site-1', site: null, username: 'u', password: 'p', updatedAt: 1000 },
        { id: 'bad-site-2', site: { toString: () => 'x' }, username: 'u2', password: 'p2', updatedAt: 1000 },
        { id: 'bad-brand', type: 'card', site: 'Bank', cardBrand: '<button data-action="perm-del-pw">', updatedAt: 1000 },
        { id: 'good-brand', type: 'card', site: 'Troy Bank', cardBrand: '  TROY ', updatedAt: 1000 },
      ]
    );
    const byId = Object.fromEntries(res.mergedEntries.map((e) => [e.id, e]));
    assert.strictEqual(byId['bad-site-1'].site, '');
    assert.strictEqual(byId['bad-site-2'].site, '');
    assert.strictEqual(byId['bad-brand'].cardBrand, '');
    assert.strictEqual(byId['good-brand'].cardBrand, 'troy');
  });

  // ── 19. CRYPTO-03 Fail-Closed Reprompt (VaultScreen.js) ───────────────────
  await test('19. VaultScreen.js verifyReprompt never silently returns true without biometrics and uses constant-time modal fallback', () => {
    const vaultSrc = fs.readFileSync(path.join(ROOT, 'src/screens/VaultScreen.js'), 'utf8');
    const verifyStart = vaultSrc.indexOf('const verifyReprompt = useCallback');
    const verifyEnd = vaultSrc.indexOf('const handleCopy = useCallback', verifyStart);
    assert.ok(verifyStart > 0 && verifyEnd > verifyStart, 'Expected verifyReprompt before handleCopy');
    const verifyBlock = vaultSrc.slice(verifyStart, verifyEnd);

    assert.ok(verifyBlock.includes('return await requestMasterPasswordReprompt()'), 'verifyReprompt must fall back to Master Password modal');
    assert.strictEqual(/if\s*\(hasHw\s*&&\s*isEnrolled\)[\s\S]*?return\s+true\s*;/.test(verifyBlock), false, 'verifyReprompt must NEVER return true when biometrics are unavailable');

    assert.ok(vaultSrc.includes('quickCrypto.timingSafeEqual('), 'VaultScreen.js must verify reprompt password in constant time');
    assert.ok(vaultSrc.includes("t('repromptModalTitle')"), 'VaultScreen.js must render Master Password Reprompt modal');
    assert.ok(vaultSrc.includes('closeRepromptModal(false)'), 'Reprompt modal must fail closed on cancel/close');

    const repromptModalStart = vaultSrc.indexOf('{/* Master Password Reprompt Modal');
    const repromptModalEnd = vaultSrc.indexOf('{/* Change Master Password Modal */}', repromptModalStart);
    assert.ok(repromptModalStart > 0 && repromptModalEnd > repromptModalStart);
    const repromptModalBlock = vaultSrc.slice(repromptModalStart, repromptModalEnd);
    const touchables = repromptModalBlock.match(/<TouchableOpacity[\s\S]*?>/g) || [];
    assert.ok(touchables.length >= 4, 'Reprompt modal must have close, eye toggle, cancel, and verify buttons');
    for (const tag of touchables) {
      assert.ok(tag.includes('delayPressIn={0}'), `Reprompt modal TouchableOpacity missing delayPressIn={0}: ${tag}`);
      assert.ok(tag.includes('activeOpacity={0.7}'), `Reprompt modal TouchableOpacity missing activeOpacity={0.7}: ${tag}`);
    }
  });

  // ── 20. CRYPTO-04 Full Wipe in clearVault() (storage.js runtime) ──────────
  await test('20. storage.js clearVault() wipes fuin.enc, .bak, backups/, sync state, recovery keys, and lockout keys', async () => {
    const rawSrc = fs.readFileSync(path.join(ROOT, 'src', 'storage.js'), 'utf8');
    const exportedNames = [];
    let cjsSrc = rawSrc
      .replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
      .replace(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, "const $1 = require('$2');")
      .replace(/export\s+async\s+function\s+(\w+)\s*\(/g, (_, name) => {
        exportedNames.push(name);
        return `async function ${name}(`;
      });
    cjsSrc += `\nmodule.exports = { ${exportedNames.join(', ')} };\n`;

    const deletedPaths = [];
    const removedAsyncKeys = [];
    const secureStore = createMockSecureStore({
      'fuin_master_salt': 'salt',
      'fuin-recovery-code-hash': 'hash',
      'fuin-recovery-data': 'enc',
      'fuin-recovery-code': 'legacy-code',
      'fuin-recovery-pass': 'legacy-pass',
      'fuin_fail_count': '5',
      'fuin_lock_until': '999999999',
      'fuin-biometric-key': 'bio',
    });
    // Force one deletion to throw so we verify subsequent keys are still wiped
    const origDel = secureStore.deleteItemAsync.bind(secureStore);
    secureStore.deleteItemAsync = async (k) => {
      if (k === 'fuin_clip_val') throw new Error('Simulated Keystore error');
      return origDel(k);
    };

    const mocks = {
      'expo-secure-store': secureStore,
      'expo-file-system/legacy': {
        documentDirectory: 'file:///app/',
        EncodingType: { UTF8: 'utf8' },
        async getInfoAsync() { return { exists: true, size: 100 }; },
        async deleteAsync(p) { deletedPaths.push(p); },
      },
      '@react-native-async-storage/async-storage': {
        async removeItem(k) { removedAsyncKeys.push(k); },
      },
    };

    const modObj = { exports: {} };
    vm.runInNewContext(cjsSrc, {
      module: modObj,
      exports: modObj.exports,
      console,
      Date,
      require(id) {
        if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
        throw new Error(`Unexpected require in storage.js: ${id}`);
      },
    }, { filename: 'src/storage.js' });

    await modObj.exports.clearVault();

    assert.ok(deletedPaths.includes('file:///app/fuin.enc'), 'clearVault must delete fuin.enc');
    assert.ok(deletedPaths.includes('file:///app/fuin.enc.bak'), 'clearVault must delete fuin.enc.bak');
    assert.ok(deletedPaths.includes('file:///app/backups/'), 'clearVault must delete backups/');
    assert.ok(removedAsyncKeys.includes('fuin_sync_state'), 'clearVault must remove fuin_sync_state');

    for (const k of [
      'fuin_master_salt', 'fuin-recovery-code-hash', 'fuin-recovery-data',
      'fuin-recovery-code', 'fuin-recovery-pass', 'fuin_fail_count', 'fuin_lock_until',
      'fuin-biometric-key',
    ]) {
      assert.strictEqual(secureStore.map.has(k), false, `clearVault must wipe SecureStore key "${k}"`);
    }
  });

  // ── 21. CRYPTO-08 Lock Clipboard Wipe, Resume Guard & Lazy Card Decrypt ───
  await test('21. App.js lockApp(), useVaultLifecycle.js resume check, and VaultCardItem.js lazy decryption enforce CRYPTO-08', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
    const lockFnStart = appSrc.indexOf('const lockApp = () =>');
    const lockFnEnd = appSrc.indexOf('const [permission, requestPermission]', lockFnStart);
    assert.ok(lockFnStart > 0 && lockFnEnd > lockFnStart);
    const lockBlock = appSrc.slice(lockFnStart, lockFnEnd);
    assert.ok(lockBlock.includes('clearClipboardNow().catch'), 'lockApp must immediately call clearClipboardNow()');
    assert.ok(lockBlock.includes("setMode('lock')"), 'lockApp must call setMode("lock") synchronously');
    assert.strictEqual(lockBlock.includes("changeModeSmooth('lock')"), false, 'lockApp must not delay locking behind changeModeSmooth animation');

    const lifecycleSrc = fs.readFileSync(path.join(ROOT, 'src/hooks/useVaultLifecycle.js'), 'utf8');
    const timeoutReadIdx = lifecycleSrc.indexOf("SecureStore.getItemAsync('fuin-bg-timeout')");
    const setActiveTrueIdx = lifecycleSrc.indexOf('setIsAppActive(true)');
    assert.ok(timeoutReadIdx > 0 && setActiveTrueIdx > timeoutReadIdx, 'useVaultLifecycle must await fuin-bg-timeout check BEFORE calling setIsAppActive(true)');
    assert.strictEqual(lifecycleSrc.includes("setIsAppActive(nextAppState === 'active')"), false, 'Must not set isAppActive=true synchronously before timeout verification');

    const cardItemSrc = fs.readFileSync(path.join(ROOT, 'src/components/VaultCardItem.js'), 'utf8');
    assert.ok(cardItemSrc.includes('isCard && isPwVisible ? resolveSecretDisplay(item.cardNumber)'), 'VaultCardItem must decrypt cardNumber lazily only when revealed');
    assert.ok(cardItemSrc.includes('isNote && isPwVisible ? resolveSecretDisplay(item.secureNote)'), 'VaultCardItem must decrypt secureNote lazily only when revealed');
    assert.ok(cardItemSrc.includes("onCopy(item.cardNumber, t('fieldCardNumber')"), 'VaultCardItem must pass encrypted cardNumber directly to onCopy');
    assert.ok(cardItemSrc.includes("onCopy(item.secureNote, t('fieldNote')"), 'VaultCardItem must pass encrypted secureNote directly to onCopy');
  });

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`MOBILE RECOVERY & I18N TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

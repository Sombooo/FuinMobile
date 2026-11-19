'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sessionSecurity = require('./src/services/sessionSecurity');
const cardFormatter = require('./src/services/cardFormatter');
const { mergeVaultEntries } = require('./src/sync-merge');

console.log('═'.repeat(75));
console.log('FUIN MOBILE TEST: CREDIT CARDS & SECURE NOTES FULL INTEGRATION');
console.log('═'.repeat(75));

let passes = 0;
let failures = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${desc}`);
    passes++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${desc}`);
    console.error(`    ${err.stack || err.message}`);
    failures++;
  }
}

// ── 1. Card Formatter & Brand Detection ───────────────────────────
test('1. Card brand detection covers Troy, Visa, Mastercard, Amex', () => {
  assert.strictEqual(cardFormatter.detectCardBrand('9792123456781234').name, 'TROY');
  assert.strictEqual(cardFormatter.detectCardBrand('4123456789012345').name, 'VISA');
  assert.strictEqual(cardFormatter.detectCardBrand('5523456789012345').name, 'MASTERCARD');
  assert.strictEqual(cardFormatter.detectCardBrand('378282246310005').name, 'AMEX');
});

test('2. Card number formatting correctly formats standard and Amex cards', () => {
  const visa = cardFormatter.formatCardNumber('4123456789012345');
  assert.strictEqual(visa.formatted, '4123 4567 8901 2345');

  const amex = cardFormatter.formatCardNumber('378282246310005');
  assert.strictEqual(amex.formatted, '3782 822463 10005');
});

test('3. Card expiry formatting handles single digit and boundary checks', () => {
  assert.strictEqual(cardFormatter.formatCardExpiry('1'), '1');
  assert.strictEqual(cardFormatter.formatCardExpiry('5'), '05/');
  assert.strictEqual(cardFormatter.formatCardExpiry('1228'), '12/28');
});

// ── 2. Session Security Memory Protection ────────────────────────
test('4. Session security encrypts card and note secrets in RAM', () => {
  sessionSecurity.initSessionKey();

  const entries = [
    {
      id: 'c1',
      type: 'card',
      site: 'İş Bankası Maximum',
      cardholderName: 'Ahmet Yılmaz',
      cardNumber: '4543 9876 5432 1098',
      cardCvv: '432',
      cardPin: '9876'
    },
    {
      id: 'n1',
      type: 'note',
      site: 'Wi-Fi Guest Access',
      secureNote: 'Pre-Shared-Key-Secret-Value-2026'
    }
  ];

  const protectedEntries = sessionSecurity.protectEntries(entries);
  assert.strictEqual(typeof protectedEntries[0].cardNumber, 'object');
  assert.strictEqual(typeof protectedEntries[0].cardCvv, 'object');
  assert.strictEqual(typeof protectedEntries[0].cardPin, 'object');
  assert.strictEqual(typeof protectedEntries[1].secureNote, 'object');

  // Verify memory does not leak raw plaintext
  const jsonStr = JSON.stringify(protectedEntries);
  assert.strictEqual(jsonStr.includes('4543 9876 5432 1098'), false);
  assert.strictEqual(jsonStr.includes('Pre-Shared-Key-Secret-Value-2026'), false);

  const unprotected = sessionSecurity.unprotectEntries(protectedEntries);
  assert.strictEqual(unprotected[0].cardNumber, '4543 9876 5432 1098');
  assert.strictEqual(unprotected[0].cardCvv, '432');
  assert.strictEqual(unprotected[0].cardPin, '9876');
  assert.strictEqual(unprotected[1].secureNote, 'Pre-Shared-Key-Secret-Value-2026');
});

// ── 3. LAN P2P Two-Way Sync Deterministic Merge ──────────────────
test('5. Sync merge preserves card and note entries across devices', () => {
  const localVault = {
    type: 'fuin/vault',
    categories: ['Finans'],
    entries: [
      {
        id: 'c1',
        type: 'card',
        site: 'Garanti BBVA',
        cardholderName: 'Kadir Sombo',
        cardNumber: '9792 1234 5678 9012',
        cardLastFour: '9012',
        cardBrand: 'troy',
        cardExpiry: '06/29',
        cardCvv: '999',
        updatedAt: 1000
      }
    ]
  };

  const remoteVault = {
    type: 'fuin/vault',
    categories: ['Diğer'],
    entries: [
      {
        id: 'n1',
        type: 'note',
        site: 'Bina Giriş Şifresi',
        secureNote: 'Kapı Kodu: *1453#',
        updatedAt: 2000
      }
    ]
  };

  const res = mergeVaultEntries(localVault.entries, remoteVault.entries);
  const mergedEntries = res.mergedEntries;
  assert.strictEqual(mergedEntries.length, 2);

  const cardEntry = mergedEntries.find(e => e.id === 'c1');
  const noteEntry = mergedEntries.find(e => e.id === 'n1');

  assert.ok(cardEntry, 'Card entry must exist in merged vault');
  assert.strictEqual(cardEntry.type, 'card');
  assert.strictEqual(cardEntry.cardNumber, '9792 1234 5678 9012');
  assert.strictEqual(cardEntry.cardBrand, 'troy');

  assert.ok(noteEntry, 'Note entry must exist in merged vault');
  assert.strictEqual(noteEntry.type, 'note');
  assert.strictEqual(noteEntry.secureNote, 'Kapı Kodu: *1453#');

  // Two distinct cards sharing bank name and cardholder name must not collide
  const twoCardsRes = mergeVaultEntries(
    [{ id: 'card-1', type: 'card', site: 'Garanti BBVA', username: 'Kadir', cardholderName: 'Kadir', cardLastFour: '1111', updatedAt: 1000 }],
    [{ id: 'card-2', type: 'card', site: 'Garanti BBVA', username: 'Kadir', cardholderName: 'Kadir', cardLastFour: '2222', updatedAt: 2000 }]
  );
  assert.strictEqual(twoCardsRes.mergedEntries.length, 2, 'Two separate cards with same site/cardholder must not collide');
});

// ── 4. i18n Translation Parity ───────────────────────────────────
test('6. i18n dictionary has 1:1 TR and EN parity for all card & note keys', () => {
  const i18nSource = fs.readFileSync(path.join(__dirname, 'src', 'i18n.js'), 'utf8');

  const requiredKeys = [
    'typeLogin',
    'typeCard',
    'typeNote',
    'navLogins',
    'navCards',
    'navNotes',
    'fieldCardTitle',
    'fieldCardTitlePh',
    'fieldCardholder',
    'fieldCardholderPh',
    'fieldCardNumber',
    'fieldCardNumberPh',
    'fieldCardExpiry',
    'fieldCardExpiryPh',
    'fieldCardCvv',
    'fieldCardCvvPh',
    'fieldCardPin',
    'fieldCardPinPh',
    'fieldNoteTitle',
    'fieldNoteTitlePh',
    'fieldSecureNoteContent',
    'fieldSecureNoteContentPh',
    'toastCardCopied',
    'toastCvvCopied',
    'toastNoteCopied',
    'toastCardSaved',
    'toastNoteSaved',
    'btnCopyCardNum',
    'btnCopyCvv',
    'btnCopyNote'
  ];

  for (const k of requiredKeys) {
    const regex = new RegExp(`\\b${k}\\s*:`, 'g');
    const matches = i18nSource.match(regex);
    assert.ok(matches && matches.length >= 2, `Key '${k}' must exist in both TR and EN sections (found ${matches ? matches.length : 0})`);
  }
});

// ── 5. Component Integrations ────────────────────────────────────
test('7. EditModal supports type switching and renders card/note fields', () => {
  const modalSource = fs.readFileSync(path.join(__dirname, 'src', 'screens', 'EditModal.js'), 'utf8');

  assert.ok(modalSource.includes("entryType === 'card'"), 'Must handle card type in EditModal');
  assert.ok(modalSource.includes("entryType === 'note'"), 'Must handle note type in EditModal');
  assert.ok(modalSource.includes('detectCardBrand'), 'Must use detectCardBrand');
  assert.ok(modalSource.includes('formatCardNumber'), 'Must use formatCardNumber');
  assert.ok(modalSource.includes('formatCardExpiry'), 'Must use formatCardExpiry');
  assert.ok(modalSource.includes('typeSelector'), 'Must render type selector');
});

test('8. VaultCardItem renders distinct UI for cards, notes, and logins + 2FA pill', () => {
  const cardItemSource = fs.readFileSync(path.join(__dirname, 'src', 'components', 'VaultCardItem.js'), 'utf8');

  assert.ok(cardItemSource.includes("item.type === 'card'"), 'Must check item.type === card');
  assert.ok(cardItemSource.includes("item.type === 'note'"), 'Must check item.type === note');
  assert.ok(cardItemSource.includes('name="credit-card"'), 'Must render credit-card Feather icon');
  assert.ok(cardItemSource.includes('name="file-text"'), 'Must render file-text Feather icon');
  assert.ok(cardItemSource.includes('btnCopyCvv'), 'Must provide CVV copy button');
  assert.ok(cardItemSource.includes('btnCopyNote'), 'Must provide Note copy button');
  assert.ok(cardItemSource.includes('onOpenTotp'), 'Must support 2FA live TOTP trigger');
});

test('9. Mobile JSON & Chrome CSV importers preserve cards/notes and support Excel ; delimiter', () => {
  const FuinImporters = require('./src/services/importers');
  const jsonRes = FuinImporters.importJSON(JSON.stringify({
    type: 'fuin/vault',
    entries: [
      { id: 'c1234567890', type: 'card', site: 'İş Bankası', cardNumber: '4543 1111 2222 3333', cardCvv: '123' },
      { id: 'n1234567890', type: 'note', site: 'Kurtarma Notu', secureNote: 'gizli metin' }
    ]
  }));
  assert.strictEqual(jsonRes.count, 2);
  assert.strictEqual(jsonRes.entries[0].type, 'card');
  assert.strictEqual(jsonRes.entries[1].type, 'note');

  const csvRes = FuinImporters.importCSV('name;url;username;password;note\n;android://x/y+z==@com.spotify.music/;ali;spPass9!;Müzik');
  assert.strictEqual(csvRes.format, 'chrome');
  assert.strictEqual(csvRes.count, 1);
  assert.strictEqual(csvRes.entries[0].site, 'com.spotify.music');
});

test('10. Autofill service excludes non-login items and TotpEngine supports custom provider', () => {
  const afSrc = fs.readFileSync(path.join(__dirname, 'src', 'services', 'autofillService.js'), 'utf8');
  assert.ok(afSrc.includes("!e.type || e.type === 'login'"), 'Autofill syncVault must exclude non-login entries');

  const totp = require('./src/services/totpEngine');
  const nodeCrypto = require('crypto');
  totp.setCryptoProvider(nodeCrypto, Buffer);
  const code = totp.generateTOTPSync('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { timestamp: 59, digits: 8 });
  totp.setCryptoProvider(null, null);
  assert.strictEqual(code, '94287082');
});

test('11. New Mobile 2FA, QR scanner, and .fuin backup i18n keys have 1:1 TR/EN parity', () => {
  const i18nSource = fs.readFileSync(path.join(__dirname, 'src', 'i18n.js'), 'utf8');
  for (const k of [
    'btnShow2FA', 'totpModalTitle', 'toastTotpCopied',
    'btnScanTotpQR', 'totpScannerTitle', 'totpScannerSub', 'totpInvalidQr', 'totpScannedMsg',
    'ioExportEncBtn', 'ioImportEncBtn', 'ioAllDuplicatesOrSkipped', 'alertInfo', 'btnClose'
  ]) {
    const matches = i18nSource.match(new RegExp(`\\b${k}\\s*:`, 'g'));
    assert.ok(matches && matches.length >= 2, `Key '${k}' missing TR/EN parity`);
  }
});

test('12. Mobile parseOtpAuthUri extracts otpauth://totp parameters and EditModal wires QR scanner', () => {
  const totp = require('./src/services/totpEngine');
  const parsed = totp.parseOtpAuthUri('otpauth://totp/Proton:alice@pm.me?secret=JBSWY3DPEHPK3PXP&issuer=Proton');
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.secret, 'JBSWY3DPEHPK3PXP');
  assert.strictEqual(parsed.issuer, 'Proton');
  assert.strictEqual(parsed.account, 'alice@pm.me');
  assert.strictEqual(totp.parseOtpAuthUri('https://evil.example/qr').valid, false);

  const editModalSrc = fs.readFileSync(path.join(__dirname, 'src', 'screens', 'EditModal.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
  assert.ok(editModalSrc.includes('CameraView'), 'EditModal should support CameraView fallback');
  assert.ok(editModalSrc.includes('parseOtpAuthUri'), 'EditModal should parse scanned 2FA QR codes');
  assert.ok(editModalSrc.includes('visible={visible && !qrScannerVisible}'), 'EditModal must hide Modal while camera is active on Android');
  assert.ok(appSrc.includes('totpScannerVisible') && appSrc.includes('onOpenTotpScanner'), 'App.js must mount root non-Modal 2FA CameraView overlay');
  assert.ok(!/transform:\s*[^;\n]*(undefined|null)/.test(appSrc), 'Animated transform must never pass undefined/null (processTransform.forEach crash)');
  assert.ok(appSrc.includes('renderFullScreenQrScanner') && /<CameraView[\s\S]*?style=\{\{\s*flex:\s*1\s*\}\}/.test(appSrc), 'CameraView must use direct flex: 1 layout on Android');
  assert.ok(appSrc.includes('isScannerOpen') && !/\{isSyncCameraActive\s*&&\s*\(\s*<View\s+style=\{StyleSheet\.absoluteFill\}/.test(appSrc), 'Scanner must not be nested inside StyleSheet.absoluteFill overlay');
});

// ── 7. Category Normalization & TR/EN Display Parity ─────────────
test('13. Category helper translates Desktop/Mobile aliases to active UI language and preserves canonical storage', () => {
  const catHelper = require('./src/services/categoryHelper');
  const i18nSrc = fs.readFileSync(path.join(__dirname, 'src', 'i18n.js'), 'utf8');
  const dictMatch = /const TRANSLATIONS\s*=\s*\{[\s\S]*?\n\};/.exec(i18nSrc);
  assert.ok(dictMatch, 'src/i18n.js must declare TRANSLATIONS');
  const TRANSLATIONS = new Function(`${dictMatch[0]}; return TRANSLATIONS;`)();

  const tEn = (k) => TRANSLATIONS.en[k] || k;
  const tTr = (k) => TRANSLATIONS.tr[k] || k;

  // All Desktop canonical Turkish categories must display in English when app language is EN
  assert.strictEqual(catHelper.getCategoryLabel('Finans', tEn), 'Finance');
  assert.strictEqual(catHelper.getCategoryLabel('Diğer', tEn), 'Other');
  assert.strictEqual(catHelper.getCategoryLabel('Sosyal Medya', tEn), 'Social');
  assert.strictEqual(catHelper.getCategoryLabel('E-posta', tEn), 'Email');
  assert.strictEqual(catHelper.getCategoryLabel('Alışveriş', tEn), 'Shopping');
  assert.strictEqual(catHelper.getCategoryLabel('İş / Kurumsal', tEn), 'Work');
  assert.strictEqual(catHelper.getCategoryLabel('Oyun', tEn), 'Gaming');
  assert.strictEqual(catHelper.getCategoryLabel('Geliştirici / Araçlar', tEn), 'Developer');
  assert.strictEqual(catHelper.getCategoryLabel('Eğitim', tEn), 'Education');

  // Mobile TR / EN aliases also resolve bidirectionally to active UI language
  assert.strictEqual(catHelper.getCategoryLabel('Finance', tTr), 'Finans');
  assert.strictEqual(catHelper.getCategoryLabel('Social', tTr), 'Sosyal');
  assert.strictEqual(catHelper.getCategoryLabel('Other', tTr), 'Diğer');
  assert.strictEqual(catHelper.getCategoryLabel('Developer', tTr), 'Geliştirici');
  assert.strictEqual(catHelper.getCategoryLabel('İş', tEn), 'Work');
  assert.strictEqual(catHelper.getCategoryLabel('İŞ', tEn), 'Work');
  assert.strictEqual(catHelper.getCategoryLabel('E-Ticaret', tEn), 'Shopping');

  // Filtering and modal comparisons match equivalent categories across languages
  assert.ok(catHelper.isSameCategory('Finans', 'Finance'));
  assert.ok(catHelper.isSameCategory('Sosyal Medya', 'Social'));
  assert.ok(catHelper.isSameCategory('İş / Kurumsal', 'Work'));
  assert.ok(catHelper.isSameCategory('Diğer', 'Other'));
  assert.ok(!catHelper.isSameCategory('Finans', 'Shopping'));

  // Saving normalizes standard categories to canonical Turkish keys while preserving custom names
  assert.strictEqual(catHelper.canonicalizeCategory('Finance'), 'Finans');
  assert.strictEqual(catHelper.canonicalizeCategory('Social'), 'Sosyal Medya');
  assert.strictEqual(catHelper.canonicalizeCategory('Shopping'), 'Alışveriş');
  assert.strictEqual(catHelper.canonicalizeCategory('Developer'), 'Geliştirici / Araçlar');
  assert.strictEqual(catHelper.canonicalizeCategory('CustomCrypto'), 'CustomCrypto');
  assert.strictEqual(catHelper.getCategoryLabel('CustomCrypto', tEn), 'CustomCrypto');
  assert.strictEqual(catHelper.isSameCategory('IS', 'Work'), false, 'Custom acronym IS should not collide with Turkish İş');

  // Stale special filter labels saved in vault.categories translate to current language pill labels
  assert.strictEqual(catHelper.resolveCategoryPillLabel('Girişler', tEn), 'Logins');
  assert.strictEqual(catHelper.resolveCategoryPillLabel('Cards', tTr), 'Kartlar');

  // Verify 1:1 TR/EN keys and integration in VaultCardItem, EditModal, and useVaultSearch
  for (const k of catHelper.STANDARD_CATEGORY_KEYS) {
    assert.ok(TRANSLATIONS.tr[k] && TRANSLATIONS.en[k], `Mobile i18n missing TR or EN for ${k}`);
  }
  const cardItemSrc = fs.readFileSync(path.join(__dirname, 'src', 'components', 'VaultCardItem.js'), 'utf8');
  const editModalSrc = fs.readFileSync(path.join(__dirname, 'src', 'screens', 'EditModal.js'), 'utf8');
  const searchHookSrc = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useVaultSearch.js'), 'utf8');
  assert.ok(cardItemSrc.includes('getCategoryLabel('), 'VaultCardItem must translate category badges with getCategoryLabel');
  assert.ok(editModalSrc.includes('canonicalizeCategory(') && editModalSrc.includes('getCategoryLabel('), 'EditModal must display localized label and store canonical category');
  assert.ok(searchHookSrc.includes('isSameCategory(') && searchHookSrc.includes('resolveCategoryPillLabel('), 'useVaultSearch must filter and deduplicate categories across languages');
});

test('14. Mobile JSON importer prevents ID collisions and stays byte-for-byte mirrored with Desktop services', () => {
  const Importers = require('./src/services/importers');
  const collidingVault = JSON.stringify({
    type: 'fuin/vault',
    entries: [
      { id: 'collision-id-999999', type: 'login', site: 'bank.example', username: 'kadir', password: 'pw-updated' },
      { id: 'collision-id-999999', type: 'login', site: 'mail.example', username: 'kadir', password: 'pw-mail' }
    ]
  });
  const imported = Importers.importJSON(collidingVault, {
    existingEntries: [{ id: 'collision-id-999999', type: 'login', site: 'bank.example', username: 'kadir', password: 'pw-old' }]
  });
  assert.strictEqual(imported.entries.length, 2);
  assert.notStrictEqual(imported.entries[0].id, 'collision-id-999999', 'Existing vault ID collision must be re-keyed');
  assert.notStrictEqual(imported.entries[1].id, imported.entries[0].id, 'Batch ID collision must be re-keyed');

  const siblingDesktopServices = path.resolve(__dirname, '..', 'Fuin', 'services');
  if (fs.existsSync(siblingDesktopServices)) {
    for (const rel of ['totpEngine.js', 'importers/detector.js', 'importers/csvImporter.js', 'importers/jsonImporter.js', 'importers/index.js']) {
      const mobileBuf = fs.readFileSync(path.join(__dirname, 'src', 'services', rel));
      const desktopBuf = fs.readFileSync(path.join(siblingDesktopServices, rel));
      assert.ok(mobileBuf.equals(desktopBuf), `Shared service ${rel} must stay mirrored byte-for-byte with Desktop`);
    }
  }
});

console.log('═'.repeat(75));
console.log(`TOTAL PASSES: ${passes}`);
console.log(`TOTAL FAILURES: ${failures}`);
console.log('═'.repeat(75));

if (failures > 0) process.exit(1);

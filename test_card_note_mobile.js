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

test('8. VaultCardItem renders distinct UI for cards, notes, and logins', () => {
  const cardItemSource = fs.readFileSync(path.join(__dirname, 'src', 'components', 'VaultCardItem.js'), 'utf8');

  assert.ok(cardItemSource.includes("item.type === 'card'"), 'Must check item.type === card');
  assert.ok(cardItemSource.includes("item.type === 'note'"), 'Must check item.type === note');
  assert.ok(cardItemSource.includes('name="credit-card"'), 'Must render credit-card Feather icon');
  assert.ok(cardItemSource.includes('name="file-text"'), 'Must render file-text Feather icon');
  assert.ok(cardItemSource.includes('btnCopyCvv'), 'Must provide CVV copy button');
  assert.ok(cardItemSource.includes('btnCopyNote'), 'Must provide Note copy button');
});

console.log('═'.repeat(75));
console.log(`TOTAL PASSES: ${passes}`);
console.log(`TOTAL FAILURES: ${failures}`);
console.log('═'.repeat(75));

if (failures > 0) process.exit(1);

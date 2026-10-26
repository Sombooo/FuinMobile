'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('═'.repeat(75));
console.log('FUIN MOBILE TEST: BITWARDEN-GRADE SECURITY FEATURES');
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
    console.error(`    ${err.message}`);
    failures++;
  }
}

// ── 1. Translation Keys Check ──────────────────────────────────────
test('1. Mobile i18n contains all required Bitwarden-grade security strings', () => {
  const i18nContent = fs.readFileSync(path.join(__dirname, 'src', 'i18n.js'), 'utf8');
  const requiredKeys = [
    'toggleRepromptLabel',
    'toggleRepromptSub',
    'badgeReprompt',
    'warnInsecureHttp',
    'btnPwHistory',
    'pwHistoryTitle',
    'pwHistoryEmpty',
    'pwHistoryCopied',
    'repromptBioPrompt'
  ];

  for (const k of requiredKeys) {
    assert.ok(i18nContent.includes(k), `Missing key in i18n: ${k}`);
  }
});

// ── 2. VaultCardItem Component Analysis ────────────────────────────
test('2. VaultCardItem renders reprompt shield icon and HTTP warning badge', () => {
  const cardItemContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'VaultCardItem.js'), 'utf8');

  assert.ok(cardItemContent.includes('item.reprompt'), 'Must check item.reprompt');
  assert.ok(cardItemContent.includes('name="shield"'), 'Must render Feather shield icon');
  assert.ok(cardItemContent.includes('^http:\\/\\/'), 'Must test http URL regex');
  assert.ok(cardItemContent.includes('HTTP'), 'Must render HTTP badge');
});

// ── 3. EditModal Schema & History Verification ─────────────────────
test('3. EditModal correctly saves reprompt flag and records previous passwords', () => {
  const editModalContent = fs.readFileSync(path.join(__dirname, 'src', 'screens', 'EditModal.js'), 'utf8');

  assert.ok(editModalContent.includes('reprompt: !!reprompt'), 'handleSave must persist reprompt flag');
  assert.ok(editModalContent.includes('history.unshift'), 'handleSave must push old password to history');
  assert.ok(editModalContent.includes('history.slice(0, 5)'), 'handleSave must limit history to 5 entries');
  assert.ok(editModalContent.includes('historyVisible'), 'Must manage history modal state');
});

// ── 4. VaultScreen Reprompt Guard Verification ────────────────────
test('4. VaultScreen guards reveal, copy, and edit behind verifyReprompt', () => {
  const vaultScreenContent = fs.readFileSync(path.join(__dirname, 'src', 'screens', 'VaultScreen.js'), 'utf8');

  assert.ok(vaultScreenContent.includes('verifyReprompt'), 'verifyReprompt helper must be defined');
  assert.ok(vaultScreenContent.includes('LocalAuthentication.authenticateAsync'), 'Must invoke biometric authentication');
  assert.ok(vaultScreenContent.includes('repromptBioPrompt'), 'Must use reprompt prompt message');
});

console.log('═'.repeat(75));
console.log(`TOTAL PASSES: ${passes}`);
console.log(`TOTAL FAILURES: ${failures}`);
console.log('═'.repeat(75));

if (failures > 0) process.exit(1);

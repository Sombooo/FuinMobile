'use strict';

const assert = require('assert');
const sessionSecurity = require('./src/services/sessionSecurity');

console.log('═'.repeat(75));
console.log('FUIN MOBILE TEST: IN-MEMORY SESSION SECURITY & RAM PROTECTION');
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

test('1. Session key initialization & state tracking', () => {
  sessionSecurity.clearSessionKey();
  assert.strictEqual(sessionSecurity.isSessionActive(), false);

  sessionSecurity.initSessionKey();
  assert.strictEqual(sessionSecurity.isSessionActive(), true);
});

test('2. Encrypted payload structure (never leaks plaintext)', () => {
  const secret = 'MySuperSecretP@ssw0rd!2026';
  const enc = sessionSecurity.memEncrypt(secret);

  assert.strictEqual(typeof enc, 'object');
  assert.strictEqual(typeof enc.iv, 'string');
  assert.strictEqual(typeof enc.tag, 'string');
  assert.strictEqual(typeof enc.data, 'string');
  assert.strictEqual(enc.iv.length, 24); // 12 bytes = 24 hex chars
  assert.strictEqual(enc.tag.length, 32); // 16 bytes = 32 hex chars
  assert.strictEqual(JSON.stringify(enc).includes(secret), false, 'Plaintext must never appear in encrypted blob');
});

test('3. Decryption restores exact plaintext', () => {
  const secret = 'K4d1r-Fuin-P@ss!#$*';
  const enc = sessionSecurity.memEncrypt(secret);
  const dec = sessionSecurity.memDecrypt(enc);
  assert.strictEqual(dec, secret);
});

test('4. Ciphertext integrity & AEAD authentication (tamper resistance)', () => {
  const enc = sessionSecurity.memEncrypt('CorrectCredentials');
  
  // Mutate data
  const tamperedData = { ...enc, data: '00' + enc.data.slice(2) };
  assert.strictEqual(sessionSecurity.memDecrypt(tamperedData), '');

  // Mutate tag
  const tamperedTag = { ...enc, tag: 'ff' + enc.tag.slice(2) };
  assert.strictEqual(sessionSecurity.memDecrypt(tamperedTag), '');
});

test('5. Session clearance zeroizes key and locks down memory', () => {
  const secret = 'UltraSensitiveToken_12345';
  const enc = sessionSecurity.memEncrypt(secret);

  assert.strictEqual(sessionSecurity.memDecrypt(enc), secret);

  // User locks vault or background timeout occurs
  sessionSecurity.clearSessionKey();
  assert.strictEqual(sessionSecurity.isSessionActive(), false);

  // Decryption must now fail and return empty string
  const afterLock = sessionSecurity.memDecrypt(enc);
  assert.strictEqual(afterLock, '', 'Zeroized session key must refuse decryption');
});

test('6. Batch entry protection and unprotection round-trip', () => {
  sessionSecurity.initSessionKey();

  const rawEntries = [
    { id: '1', site: 'GitHub', username: 'kadir', password: 'gh-password-1', totp: 'JBSWY3DPEHPK3PXP' },
    { id: '2', site: 'Google', username: 'kadir@gmail.com', password: 'google-password-2', totp: '' }
  ];

  const protectedEntries = sessionSecurity.protectEntries(rawEntries);
  assert.strictEqual(typeof protectedEntries[0].password, 'object');
  assert.strictEqual(typeof protectedEntries[1].password, 'object');
  assert.strictEqual(typeof protectedEntries[0].totp, 'object');
  assert.strictEqual(protectedEntries[1].totp, '');

  const unprotected = sessionSecurity.unprotectEntries(protectedEntries);
  assert.strictEqual(unprotected[0].password, 'gh-password-1');
  assert.strictEqual(unprotected[1].password, 'google-password-2');
  assert.strictEqual(unprotected[0].totp, 'JBSWY3DPEHPK3PXP');
  assert.strictEqual(unprotected[1].totp, '');
});

test('7. Legacy plaintext backward compatibility', () => {
  assert.strictEqual(sessionSecurity.memDecrypt('legacyPlaintext'), 'legacyPlaintext');
  assert.strictEqual(sessionSecurity.memDecrypt(null), '');
  assert.strictEqual(sessionSecurity.memDecrypt(undefined), '');
});

test('8. Credit card and secure note fields RAM protection and round-trip', () => {
  sessionSecurity.initSessionKey();

  const rawEntries = [
    {
      id: 'card-1',
      type: 'card',
      site: 'Garanti BBVA',
      cardholderName: 'Kadir Sombo',
      cardNumber: '4543 1234 5678 9012',
      cardExpiry: '12/28',
      cardCvv: '789',
      cardPin: '1234'
    },
    {
      id: 'note-1',
      type: 'note',
      site: 'Wi-Fi Office Key',
      secureNote: 'Super-Secret-Wifi-Key-5GHz!'
    }
  ];

  const protectedEntries = sessionSecurity.protectEntries(rawEntries);
  assert.strictEqual(typeof protectedEntries[0].cardNumber, 'object');
  assert.strictEqual(typeof protectedEntries[0].cardCvv, 'object');
  assert.strictEqual(typeof protectedEntries[0].cardPin, 'object');
  assert.strictEqual(typeof protectedEntries[1].secureNote, 'object');

  // Verify memory does not leak raw plaintext in JSON representation
  const jsonBlob = JSON.stringify(protectedEntries);
  assert.strictEqual(jsonBlob.includes('4543 1234 5678 9012'), false);
  assert.strictEqual(jsonBlob.includes('Super-Secret-Wifi-Key-5GHz!'), false);

  const unprotected = sessionSecurity.unprotectEntries(protectedEntries);
  assert.strictEqual(unprotected[0].cardNumber, '4543 1234 5678 9012');
  assert.strictEqual(unprotected[0].cardCvv, '789');
  assert.strictEqual(unprotected[0].cardPin, '1234');
  assert.strictEqual(unprotected[1].secureNote, 'Super-Secret-Wifi-Key-5GHz!');
});

console.log('═'.repeat(75));
console.log(`TOTAL PASSES: ${passes}`);
console.log(`TOTAL FAILURES: ${failures}`);
console.log('═'.repeat(75));

if (failures > 0) process.exit(1);

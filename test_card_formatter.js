'use strict';

const assert = require('assert');
const cardFormatter = require('./src/services/cardFormatter');

console.log('═'.repeat(75));
console.log('FUIN MOBILE TEST: CARD FORMATTER & BRAND DETECTION');
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

test('1. Detects Troy card brand', () => {
  const info = cardFormatter.detectCardBrand('9792000012345678');
  assert.strictEqual(info.name, 'TROY');
  assert.strictEqual(info.brand, 'troy');
  assert.strictEqual(info.maxLen, 16);
});

test('2. Detects Visa card brand', () => {
  const info = cardFormatter.detectCardBrand('4543123456789012');
  assert.strictEqual(info.name, 'VISA');
  assert.strictEqual(info.brand, 'visa');
  assert.strictEqual(info.maxLen, 16);
});

test('3. Detects Mastercard card brand', () => {
  const info5 = cardFormatter.detectCardBrand('5412345678901234');
  assert.strictEqual(info5.name, 'MASTERCARD');
  assert.strictEqual(info5.brand, 'mastercard');

  const info2 = cardFormatter.detectCardBrand('2221000012345678');
  assert.strictEqual(info2.name, 'MASTERCARD');
  assert.strictEqual(info2.brand, 'mastercard');
});

test('4. Detects American Express and applies 4-6-5 formatting', () => {
  const info = cardFormatter.detectCardBrand('378282246310005');
  assert.strictEqual(info.name, 'AMEX');
  assert.strictEqual(info.brand, 'amex');
  assert.strictEqual(info.maxLen, 15);

  const res = cardFormatter.formatCardNumber('378282246310005');
  assert.strictEqual(res.formatted, '3782 822463 10005');
});

test('5. Standard 16-digit card formatting (4-4-4-4)', () => {
  const res = cardFormatter.formatCardNumber('4543123456789012');
  assert.strictEqual(res.formatted, '4543 1234 5678 9012');
  assert.strictEqual(res.brandInfo.name, 'VISA');
});

test('6. Expiry date formatting MM/YY with auto slash and range limits', () => {
  assert.strictEqual(cardFormatter.formatCardExpiry('5'), '05/');
  assert.strictEqual(cardFormatter.formatCardExpiry('12'), '12/');
  assert.strictEqual(cardFormatter.formatCardExpiry('1228'), '12/28');
  assert.strictEqual(cardFormatter.formatCardExpiry('9928'), '12/28');
  assert.strictEqual(cardFormatter.formatCardExpiry('0028'), '01/28');
});

console.log('═'.repeat(75));
console.log(`TOTAL PASSES: ${passes}`);
console.log(`TOTAL FAILURES: ${failures}`);
console.log('═'.repeat(75));

if (failures > 0) process.exit(1);

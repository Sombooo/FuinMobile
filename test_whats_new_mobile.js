#!/usr/bin/env node
'use strict';

/**
 * FUIN MOBILE WHAT'S NEW & CHANGELOG TEST SUITE
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${label}`);
    console.error(`    -> ${err.message}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log('FUIN MOBILE WHAT\'S NEW & CHANGELOG TEST SUITE');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Service Integrity
console.log('[1. Mobile Changelog Service Integrity]');
const changelog = require('./src/services/changelogData.js');

check('CHANGELOG_ENTRIES contains at least 3 releases', () => {
  assert.ok(Array.isArray(changelog.CHANGELOG_ENTRIES));
  assert.ok(changelog.CHANGELOG_ENTRIES.length >= 3);
});

check('Latest release is v1.0.0-beta.7 marked as current', () => {
  const latest = changelog.getLatestEntry();
  assert.strictEqual(latest.version, '1.0.0-beta.7');
  assert.strictEqual(latest.tag, 'v1.0.0-beta.7');
  assert.strictEqual(latest.isCurrent, true);
});

check('All changelog entries have valid titles, summaries, and highlights in TR and EN', () => {
  for (const entry of changelog.CHANGELOG_ENTRIES) {
    assert.ok(entry.version, 'Missing version');
    assert.ok(entry.title, `Missing title in ${entry.version}`);
    assert.ok(entry.titleEn, `Missing titleEn in ${entry.version}`);
    assert.ok(entry.summary, `Missing summary in ${entry.version}`);
    assert.ok(entry.summaryEn, `Missing summaryEn in ${entry.version}`);
    assert.ok(Array.isArray(entry.highlights) && entry.highlights.length >= 3, `Insufficient highlights in ${entry.version}`);
    for (const h of entry.highlights) {
      assert.ok(h.badge, 'Missing highlight badge');
      assert.ok(h.badgeText, 'Missing highlight badgeText');
      assert.ok(h.badgeTextEn, 'Missing highlight badgeTextEn');
      assert.ok(h.title, 'Missing highlight title');
      assert.ok(h.titleEn, 'Missing highlight titleEn');
      assert.ok(h.desc, 'Missing highlight desc');
      assert.ok(h.descEn, 'Missing highlight descEn');
    }
  }
});

// 2. Mobile i18n Dictionary
console.log('\n[2. Mobile i18n Translation Dictionary Keys]');
const i18nFile = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');

check('src/i18n.js includes all whatsNew translation keys in TR and EN', () => {
  const keys = ['whatsNewTitle', 'whatsNewModalTitle', 'whatsNewSub', 'whatsNewBtn', 'whatsNewGotIt', 'whatsNewOfflineFooter'];
  for (const k of keys) {
    assert.ok(i18nFile.includes(`${k}:`), `Missing key ${k} in src/i18n.js`);
  }
});

// 3. VaultScreen & WhatsNewModal Integration
console.log('\n[3. VaultScreen & WhatsNewModal Integration]');
const vaultScreen = fs.readFileSync(path.join(ROOT, 'src', 'screens', 'VaultScreen.js'), 'utf8');
const whatsNewModal = fs.readFileSync(path.join(ROOT, 'src', 'screens', 'WhatsNewModal.js'), 'utf8');

check('VaultScreen imports and renders WhatsNewModal with settings trigger', () => {
  assert.ok(vaultScreen.includes("import WhatsNewModal from './WhatsNewModal';"), 'Missing WhatsNewModal import');
  assert.ok(vaultScreen.includes('whatsNewModalVisible'), 'Missing whatsNewModalVisible state');
  assert.ok(vaultScreen.includes('<WhatsNewModal'), 'Missing <WhatsNewModal tag');
  assert.ok(vaultScreen.includes("t('whatsNewTitle')"), 'Missing whatsNewTitle button in settings');
});

check('WhatsNewModal uses useTheme, useI18n, and handles dismissal', () => {
  assert.ok(whatsNewModal.includes('useTheme()'), 'Missing useTheme in modal');
  assert.ok(whatsNewModal.includes('useI18n()'), 'Missing useI18n in modal');
  assert.ok(whatsNewModal.includes('fuin_last_seen_changelog'), 'Missing last seen changelog storage');
});

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`MOBILE CHANGELOG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failed > 0) process.exit(1);
process.exit(0);

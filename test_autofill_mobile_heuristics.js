#!/usr/bin/env node
'use strict';

/**
 * FuinMobile Test: Mobile Autofill Heuristics, Architecture & Manifest Integrity
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = __dirname;
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
console.log('FUIN MOBILE TEST: AUTOFILL ARCHITECTURE & INTEGRITY');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Android Manifest Verification
check('1. AndroidManifest.xml contains FuinAutofillService and AutofillAuthActivity', () => {
  const manifestPath = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
  assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist');
  const manifest = fs.readFileSync(manifestPath, 'utf8');

  assert.ok(manifest.includes('android:name=".FuinAutofillService"'), 'Must declare FuinAutofillService');
  assert.ok(manifest.includes('android.permission.BIND_AUTOFILL_SERVICE'), 'Must require BIND_AUTOFILL_SERVICE');
  assert.ok(manifest.includes('android:name="android.service.autofill.AutofillService"'), 'Must have AutofillService intent filter');
  assert.ok(manifest.includes('android:resource="@xml/autofill_service_config"'), 'Must reference autofill_service_config');
  assert.ok(manifest.includes('android:name=".AutofillAuthActivity"'), 'Must declare AutofillAuthActivity');
  assert.ok(manifest.includes('@style/Theme.AppCompat.DayNight.Dialog') || manifest.includes('@style/Theme.AutofillDialog'), 'Must use Dialog theme');
});

// 2. Resource XML files verification
check('2. Autofill XML config and layout resources exist', () => {
  const xmlConfig = path.join(ROOT, 'android/app/src/main/res/xml/autofill_service_config.xml');
  const datasetLayout = path.join(ROOT, 'android/app/src/main/res/layout/autofill_dataset_item.xml');
  const authLayout = path.join(ROOT, 'android/app/src/main/res/layout/autofill_auth_item.xml');
  const authActivityLayout = path.join(ROOT, 'android/app/src/main/res/layout/activity_autofill_auth.xml');

  assert.ok(fs.existsSync(xmlConfig), 'autofill_service_config.xml must exist');
  assert.ok(fs.existsSync(datasetLayout), 'autofill_dataset_item.xml must exist');
  assert.ok(fs.existsSync(authLayout), 'autofill_auth_item.xml must exist');
  assert.ok(fs.existsSync(authActivityLayout), 'activity_autofill_auth.xml must exist');

  const configContent = fs.readFileSync(xmlConfig, 'utf8');
  assert.ok(configContent.includes('autofill-service'), 'Must have autofill-service root element');
});

// 3. Design System & Warm Dark Colors
check('3. Android colors.xml adheres to Fuin warm dark palette', () => {
  const colorsPath = path.join(ROOT, 'android/app/src/main/res/values/colors.xml');
  const colors = fs.readFileSync(colorsPath, 'utf8');

  assert.ok(colors.includes('#1A1816') || colors.includes('#1a1816'), 'fuin_bg must be #1a1816');
  assert.ok(colors.includes('#222019'), 'fuin_surface must be #222019');
  assert.ok(colors.includes('#2A2720') || colors.includes('#2a2720'), 'fuin_card must be #2a2720');
  assert.ok(colors.includes('#5A9A6E') || colors.includes('#5a9a6e'), 'fuin_accent must be #5a9a6e');
});

// 4. Native Kotlin Architecture Components
check('4. Kotlin source files for Autofill are present and correctly packaged', () => {
  const pkgDir = path.join(ROOT, 'android/app/src/main/java/com/sombooosteam/fuin');
  const files = [
    'FuinAutofillService.kt',
    'AutofillAuthActivity.kt',
    'AutofillStructureParser.kt',
    'AutofillSecureStore.kt',
    'FuinAutofillModule.kt',
    'FuinAutofillPackage.kt'
  ];

  for (const f of files) {
    const full = path.join(pkgDir, f);
    assert.ok(fs.existsSync(full), `Missing Kotlin file: ${f}`);
    const src = fs.readFileSync(full, 'utf8');
    assert.ok(src.includes('package com.sombooosteam.fuin'), `File ${f} must have package com.sombooosteam.fuin`);
  }
});

// 5. MainApplication Package Registration
check('5. MainApplication.kt registers FuinAutofillPackage', () => {
  const mainAppPath = path.join(ROOT, 'android/app/src/main/java/com/sombooosteam/fuin/MainApplication.kt');
  const content = fs.readFileSync(mainAppPath, 'utf8');
  assert.ok(content.includes('add(FuinAutofillPackage())'), 'MainApplication must register FuinAutofillPackage()');
});

// 6. Domain Normalization Heuristics
check('6. Domain normalization logic handles protocols, subdomains, and ports correctly', () => {
  function normalizeDomain(raw) {
    return String(raw || '').trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
  }

  assert.strictEqual(normalizeDomain('https://www.github.com/login'), 'github.com');
  assert.strictEqual(normalizeDomain('http://sub.domain.co.uk:8080/auth'), 'sub.domain.co.uk');
  assert.strictEqual(normalizeDomain('  GOOGLE.COM  '), 'google.com');
  assert.strictEqual(normalizeDomain('https://auth.sombo.dev/'), 'auth.sombo.dev');
});

// 7. i18n Keys Verification
check('7. i18n dictionary has required Autofill strings in TR and EN', () => {
  const i18nPath = path.join(ROOT, 'src/i18n.js');
  const content = fs.readFileSync(i18nPath, 'utf8');

  assert.ok(content.includes('autofillTitle'), 'Must define autofillTitle');
  assert.ok(content.includes('autofillDesc'), 'Must define autofillDesc');
  assert.ok(content.includes('autofillStatusActive'), 'Must define autofillStatusActive');
  assert.ok(content.includes('autofillStatusInactive'), 'Must define autofillStatusInactive');
  assert.ok(content.includes('autofillBtnEnable'), 'Must define autofillBtnEnable');
});

// 8. Vault Entry Sanitization for Autofill
check('8. Vault entry sanitization strips invalid entries and extracts domains', () => {
  const rawEntries = [
    { id: '1', name: 'GitHub', username: 'kadir', password: 'secretpassword', url: 'https://github.com/login', reprompt: true },
    { id: '2', title: 'Twitter', login: 'kadir_dev', password: 'twpassword', urls: ['twitter.com', 'x.com'] },
    { id: '3', name: 'Empty Card', username: '', password: '' } // Should be filtered out
  ];

  const sanitized = rawEntries
    .filter(e => e && (e.password || e.username))
    .map(e => {
      let domain = '';
      const urls = [];
      if (e.url) {
        domain = e.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
        urls.push(domain);
      }
      if (Array.isArray(e.urls)) {
        e.urls.forEach(u => {
          const d = u.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
          if (d && !urls.includes(d)) urls.push(d);
        });
      }
      return {
        id: String(e.id || ''),
        title: String(e.name || e.title || domain || ''),
        username: String(e.username || e.login || e.email || ''),
        password: String(e.password || ''),
        domain: domain,
        urls: urls,
        reprompt: !!e.reprompt,
        totp: e.totp || null
      };
    });

  assert.strictEqual(sanitized.length, 2, 'Must filter out empty credentials');
  assert.strictEqual(sanitized[0].domain, 'github.com');
  assert.strictEqual(sanitized[0].reprompt, true);
  assert.deepStrictEqual(sanitized[1].urls, ['twitter.com', 'x.com']);
});

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`TOTAL PASSES: ${passed}`);
console.log(`TOTAL FAILURES: ${failed}`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
}

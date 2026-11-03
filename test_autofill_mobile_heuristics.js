#!/usr/bin/env node
'use strict';

/**
 * FuinMobile Test: Bitwarden-Grade Mobile Autofill Heuristics, Security & Clean Architecture
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  extractNormalizedDomain,
  areDomainsEquivalent,
  mergePendingAutofillSaves,
} = require('./src/services/autofillMerge');

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
console.log('FUIN MOBILE TEST: BITWARDEN-GRADE AUTOFILL HEURISTICS & SECURITY');
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
  assert.ok(manifest.includes('android:exported="false"'), 'AutofillAuthActivity must NOT be exported');
  assert.ok(manifest.includes('android:launchMode="standard"'), 'AutofillAuthActivity must use standard launchMode so setResult is never dropped');
  assert.ok(!manifest.includes('android:name=".AutofillAuthActivity"\n        android:theme="@style/Theme.AppCompat.DayNight.Dialog"\n        android:exported="false"\n        android:excludeFromRecents="true"\n        android:launchMode="singleTask"'), 'singleTask must be removed from AutofillAuthActivity');
  assert.ok(manifest.includes('android.intent.category.LAUNCHER'), 'Manifest <queries> must allow Android 11+ package visibility for APK cert checks');
});

// 2. Resource XML files verification
check('2. Autofill XML config and layout resources exist and block recursive self-autofill', () => {
  const xmlConfig = path.join(ROOT, 'android/app/src/main/res/xml/autofill_service_config.xml');
  const datasetLayout = path.join(ROOT, 'android/app/src/main/res/layout/autofill_dataset_item.xml');
  const authLayout = path.join(ROOT, 'android/app/src/main/res/layout/autofill_auth_item.xml');
  const authActivityLayout = path.join(ROOT, 'android/app/src/main/res/layout/activity_autofill_auth.xml');

  assert.ok(fs.existsSync(xmlConfig), 'autofill_service_config.xml must exist');
  assert.ok(fs.existsSync(datasetLayout), 'autofill_dataset_item.xml must exist');
  assert.ok(fs.existsSync(authLayout), 'autofill_auth_item.xml must exist');
  assert.ok(fs.existsSync(authActivityLayout), 'activity_autofill_auth.xml must exist');

  const authXml = fs.readFileSync(authActivityLayout, 'utf8');
  assert.ok(authXml.includes('noExcludeDescendants'), 'AutofillAuthActivity layout must exclude descendants from recursive autofill');
  assert.ok(!authXml.includes('auth_password_input'), 'Fake unverified password EditText must be removed');
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

// 4. Clean SRP Split & Sync Parity Across All 10 Kotlin Modules
check('4. All 10 Kotlin modules follow SRP and match byte-for-byte between plugins/ and android/', () => {
  const pluginDir = path.join(ROOT, 'plugins/android/java');
  const pkgDir = path.join(ROOT, 'android/app/src/main/java/com/sombooosteam/fuin');
  const files = [
    'FuinAutofillService.kt',
    'AutofillAuthActivity.kt',
    'AutofillStructureParser.kt',
    'AutofillSecureStore.kt',
    'AutofillDomainMatcher.kt',
    'AutofillTotpGenerator.kt',
    'FuinAutofillModule.kt',
    'FuinAutofillPackage.kt',
    'FuinAppUpdaterModule.kt',
    'FuinUpdateFileProvider.kt',
  ];

  for (const f of files) {
    const pluginFile = path.join(pluginDir, f);
    const appFile = path.join(pkgDir, f);
    assert.ok(fs.existsSync(pluginFile), `Missing plugin Kotlin file: ${f}`);
    assert.ok(fs.existsSync(appFile), `Missing app Kotlin file: ${f}`);
    const s1 = fs.readFileSync(pluginFile, 'utf8');
    const s2 = fs.readFileSync(appFile, 'utf8');
    assert.strictEqual(s1, s2, `Plugin and generated Android Kotlin file out of sync: ${f}`);
    assert.ok(s1.includes('package com.sombooosteam.fuin'), `File ${f} must have package com.sombooosteam.fuin`);
  }
});

// 5. Security Hardening Invariants (Keystore Envelope, Zero-Cloud noBackupFilesDir, Reprompt, Single Read, APK Cert Pinning)
check('5. Native Kotlin modules enforce Keystore envelope, noBackupFilesDir, APK cert pinning, and reprompt', () => {
  const parserSrc = fs.readFileSync(path.join(ROOT, 'plugins/android/java/AutofillStructureParser.kt'), 'utf8');
  const serviceSrc = fs.readFileSync(path.join(ROOT, 'plugins/android/java/FuinAutofillService.kt'), 'utf8');
  const authSrc = fs.readFileSync(path.join(ROOT, 'plugins/android/java/AutofillAuthActivity.kt'), 'utf8');
  const storeSrc = fs.readFileSync(path.join(ROOT, 'plugins/android/java/AutofillSecureStore.kt'), 'utf8');
  const matcherSrc = fs.readFileSync(path.join(ROOT, 'plugins/android/java/AutofillDomainMatcher.kt'), 'utf8');

  // Anti-noise & SaveInfo gating
  assert.ok(parserSrc.includes('TYPE_TEXT_FLAG_MULTI_LINE'), 'Must exclude multi-line chat/comment fields');
  assert.ok(parserSrc.includes('TYPE_TEXT_FLAG_CAP_SENTENCES'), 'Must exclude sentence-capitalized chat fields');
  assert.ok(parserSrc.includes('"com.whatsapp"'), 'Must guard native messaging apps like WhatsApp');
  assert.ok(parserSrc.includes('isFocusOnAuthField'), 'Must verify focused node is an auth field');
  assert.ok(!serviceSrc.includes('allEntries.take(8)'), 'Must NEVER dump unrelated vault accounts');
  assert.ok(serviceSrc.includes('if (passwordField != null)'), 'SaveInfo must ONLY be registered when passwordField != null');
  assert.ok(
    serviceSrc.includes('SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE'),
    'SaveInfo must set FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE so Chrome/SPA logins (e.g. chess.com) prompt on submission'
  );
  assert.ok(
    parserSrc.includes('node.autofillValue') && parserSrc.includes('includeInvisible = true'),
    'Parser must read node.autofillValue and include just-hidden fields during onSaveRequest'
  );
  assert.ok(
    parserSrc.includes('className.contains("webview")') && parserSrc.includes('className.contains("contentview")'),
    'Parser must exclude WebView/ContentView container nodes from hijacking input focus'
  );

  // Single-pass Keystore read & typed Intent constants
  assert.ok(serviceSrc.includes('AutofillSecureStore.loadSnapshot(this)'), 'Service must use single-pass loadSnapshot');
  assert.ok(!serviceSrc.includes('AutofillSecureStore.getAllEntries(this)'), 'Service must not perform duplicate Keystore reads');
  assert.ok(serviceSrc.includes('AutofillAuthActivity.EXTRA_ENTRY_ID'), 'Service must use typed Companion constants instead of magic strings');

  // Zero-Cloud noBackupFilesDir + AES-256-GCM authenticated session timestamp + Two-phase peek/ack
  assert.ok(storeSrc.includes('noBackupFilesDir'), 'AutofillSecureStore must store ciphertext inside noBackupFilesDir (Zero Cloud)');
  assert.ok(storeSrc.includes('setRandomizedEncryptionRequired(true)'), 'Keystore spec must enforce randomized IVs');
  assert.ok(storeSrc.includes('peekPendingSavesJson') && storeSrc.includes('ackPendingSaves'), 'Store must implement two-phase peek + ack');

  // Reprompt enforcement in Manual Picker, OS package disclosure & FLAG_SECURE
  assert.ok(authSrc.includes('FLAG_SECURE'), 'AutofillAuthActivity must enforce FLAG_SECURE');
  assert.ok(authSrc.includes('if (chosen.reprompt)') && authSrc.includes('pendingRepromptEntry'), 'Manual picker must enforce reprompt biometric check');
  assert.ok(authSrc.includes('setDescription("Hedef uygulama: $pkg")'), 'BiometricPrompt must disclose target package name on native apps');

  // Cross-origin iframe isolation & setWebDomain spoofing & APK signing certificate verification
  assert.ok(parserSrc.includes('eligibleFields') && parserSrc.includes('isDomainMatch(field.webDomain, rootDomain!!)'), 'Parser must block cross-origin third-party iframes in browsers');
  assert.ok(matcherSrc.includes('resolveTrustedWebDomain'), 'Matcher must neutralize untrusted setWebDomain spoofing');
  assert.ok(matcherSrc.includes('GET_SIGNING_CERTIFICATES') && matcherSrc.includes('SHA-256'), 'Matcher must verify APK SHA-256 signing certificates');
  assert.ok(!matcherSrc.includes('startsWith(et)'), 'Fuzzy prefix package token matching must be removed');
});

// 6. Identifier Tokenizer Simulation (Turkish ALL-CAPS "İ" & Substring Trap Prevention)
check('6. Identifier tokenizer handles Turkish "ŞİFRE", "E-posta", and avoids "numarası" false positives', () => {
  const EXCLUDED = new Set(['search', 'query', 'arama', 'ara', 'find', 'filter', 'omnibox', 'urlbar', 'message', 'mesaj', 'chat', 'sohbet', 'comment', 'yorum']);
  const USERNAME = new Set(['username', 'userid', 'email', 'eposta', 'identifier', 'login', 'signin', 'kullanici', 'kullanıcı', 'hesap']);
  const PASSWORD = new Set(['password', 'passwd', 'pwd', 'passcode', 'parola', 'sifre', 'şifre']);

  function tokenizeIdentifier(raw) {
    if (!raw) return new Set();
    const decamel = String(raw)
      .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
      .replace(/İ/g, 'i');
    const parts = decamel
      .toLowerCase()
      .replace(/\u0307/g, '')
      .split(/[^a-z0-9çğıöşü]+/)
      .filter(Boolean);
    const out = new Set(parts.filter((p) => p.length >= 2));
    for (let i = 0; i < parts.length - 1; i++) {
      const joined = parts[i] + parts[i + 1];
      if (EXCLUDED.has(joined) || USERNAME.has(joined) || PASSWORD.has(joined)) out.add(joined);
    }
    return out;
  }

  assert.ok([...tokenizeIdentifier("YouTube'da ara / searchEditText")].some((t) => EXCLUDED.has(t)));
  assert.ok([...tokenizeIdentifier('Mesaj yazın')].some((t) => EXCLUDED.has(t)));
  assert.strictEqual([...tokenizeIdentifier('Telefon numarası')].some((t) => EXCLUDED.has(t)), false);
  assert.strictEqual([...tokenizeIdentifier('passengerName')].some((t) => PASSWORD.has(t)), false);
  assert.ok(tokenizeIdentifier('E-posta adresi').has('eposta'));
  assert.ok(tokenizeIdentifier('ŞİFRE GİRİNİZ').has('şifre'));
});

// 7. Production autofillMerge.js: URL Userinfo Phishing, .com.tr / Multi-Tenant Isolation & Collision-Free Merge
check('7. autofillMerge blocks @-userinfo phishing, isolates .com.tr/github.io, and never overwrites netflix.com with x.com', () => {
  // Userinfo phishing defense (`https://google.com:443@evil.com/login` -> `evil.com`, NEVER `google.com`!)
  assert.strictEqual(
    extractNormalizedDomain('https://google.com:443@evil.com:8443/login?next=1'),
    'evil.com',
    'Userinfo @ confusion must extract real host evil.com'
  );
  assert.strictEqual(extractNormalizedDomain('androidapp://com.spotify.music'), '');

  // Compound ccTLD & multi-tenant isolation
  assert.strictEqual(areDomainsEquivalent('garantibbva.com.tr', 'ziraatbank.com.tr'), false);
  assert.strictEqual(areDomainsEquivalent('sube.garantibbva.com.tr', 'garantibbva.com.tr'), true);
  assert.strictEqual(areDomainsEquivalent('alice.github.io', 'bob.github.io'), false);
  assert.strictEqual(areDomainsEquivalent('app.alice.github.io', 'alice.github.io'), true);

  // Regression test for Security #5: saving password for `x.com` MUST NOT overwrite `netflix.com`!
  const existingVault = [
    {
      id: 'entry-netflix',
      site: 'Netflix',
      username: 'kadir@example.com',
      password: 'OldNetflixPassword!',
      url: 'https://www.netflix.com/browse',
    },
  ];
  const pendingXSave = [
    {
      id: 'save-x-1',
      site: 'x.com',
      username: 'kadir@example.com',
      password: 'NewXPassword!',
      domain: 'x.com',
      url: 'https://x.com',
      createdAt: 1700000000000,
    },
  ];

  const merged = mergePendingAutofillSaves(existingVault, pendingXSave);
  assert.strictEqual(merged.changed, true);
  assert.strictEqual(merged.entries.length, 2, 'x.com save must create a new entry instead of colliding with netflix.com');
  const netflixAfter = merged.entries.find((e) => e.id === 'entry-netflix');
  assert.strictEqual(netflixAfter.password, 'OldNetflixPassword!', 'Netflix password must remain untouched');
  assert.deepStrictEqual(merged.acknowledgedIds, ['save-x-1']);
});

// 8. Reverse-Domain Owner & setWebDomain Spoofing Simulation (Mirrors AutofillDomainMatcher)
check('8. Reverse-domain owner blocks com.randomdev.spotifydownloader and untrusted setWebDomain spoofing', () => {
  const BROWSERS = new Set(['com.android.chrome', 'org.mozilla.firefox', 'com.brave.browser']);
  const REV_COMPOUND = new Set(['tr.com', 'tr.gov', 'uk.co']);
  const TLDS = new Set(['com', 'net', 'org', 'io', 'tv', 'tr']);

  function extractReverseDomainOwner(pkg) {
    const lower = String(pkg || '').toLowerCase().trim();
    if (!lower || BROWSERS.has(lower)) return null;
    if (lower === 'com.google.android.gms') return 'google';
    const stripped = lower.replace(/^com\.google\.android\.(apps\.)?/, '');
    if (stripped !== lower) return stripped.split('.')[0];
    const parts = lower.split('.').filter(Boolean);
    if (parts.length < 2) return null;
    if (REV_COMPOUND.has(`${parts[0]}.${parts[1]}`)) return parts[2] || null;
    if (TLDS.has(parts[0])) return parts[1];
    return parts[0];
  }

  function resolveTrustedWebDomain(pkg, rawDomain) {
    if (!BROWSERS.has(pkg)) return null;
    return extractNormalizedDomain(rawDomain) || null;
  }

  assert.strictEqual(extractReverseDomainOwner('com.spotify.music'), 'spotify');
  assert.strictEqual(extractReverseDomainOwner('tr.com.ziraatbank.mobil'), 'ziraatbank');
  assert.strictEqual(extractReverseDomainOwner('com.google.android.youtube'), 'youtube');
  assert.strictEqual(extractReverseDomainOwner('com.randomdev.spotifydownloader'), 'randomdev');
  assert.strictEqual(extractReverseDomainOwner('com.netflix.mediaclient'), 'netflix');

  // ANY non-browser app spoofing or setting webDomain -> strictly null (isolated to androidapp:// namespace)!
  assert.strictEqual(resolveTrustedWebDomain('com.evil.flashlight', 'accounts.google.com'), null);
  assert.strictEqual(resolveTrustedWebDomain('com.garantibbva.fakeapp', 'garantibbva.com.tr'), null);
  // Real Chrome browser -> allowed!
  assert.strictEqual(resolveTrustedWebDomain('com.android.chrome', 'accounts.google.com'), 'accounts.google.com');
});

// 9. Clean Hook Separation & Two-Phase Commit Bridge Check
check('9. useAutofillSync hook, two-phase peek/ack JS service, and lean App.js integration are intact', () => {
  const hookPath = path.join(ROOT, 'src/hooks/useAutofillSync.js');
  assert.ok(fs.existsSync(hookPath), 'useAutofillSync.js hook must exist');

  const hookSrc = fs.readFileSync(hookPath, 'utf8');
  assert.ok(hookSrc.includes('peekPendingSaves') && hookSrc.includes('ackPendingSaves'), 'Hook must use two-phase commit');
  assert.ok(hookSrc.includes('fuin-bg-timeout'), 'Hook must align autofill session timeout with fuin-bg-timeout');

  const serviceJs = fs.readFileSync(path.join(ROOT, 'src/services/autofillService.js'), 'utf8');
  assert.ok(serviceJs.includes('!e.isDeleted && !e.deletedAt'), 'syncVault must exclude soft-deleted tombstones');

  const appSrc = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
  assert.ok(appSrc.includes('useAutofillSync('), 'App.js must delegate autofill sync to useAutofillSync');
  assert.ok(!appSrc.includes('itemUrl.includes(savedDomain)'), 'Legacy substring collision bug must be gone from App.js');
});

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`TOTAL PASSES: ${passed}`);
console.log(`TOTAL FAILURES: ${failed}`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
}

#!/usr/bin/env node
'use strict';

/**
 * FuinMobile Static Code & Integrity Checker
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

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
console.log('FUIN MOBILE STATIC CODE & INTEGRITY CHECK');
console.log('═══════════════════════════════════════════════════════════════════\n');

const PURE_JS_TARGETS = [
  'src/services/passwordGenerator.js',
  'src/services/totpEngine.js',
  'src/services/importers/detector.js',
  'src/services/importers/csvImporter.js',
  'src/services/importers/jsonImporter.js',
  'src/services/importers/index.js',
];

console.log('[1. Pure Domain Service VM Compilation]');
for (const relPath of PURE_JS_TARGETS) {
  check(`Syntax valid: ${relPath}`, () => {
    const fullPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(fullPath), `Missing file: ${relPath}`);
    const source = fs.readFileSync(fullPath, 'utf8');
    new vm.Script(source, { filename: relPath });
  });
}

const ALL_SOURCE_FILES = [
  'App.js',
  'src/storage.js',
  'src/crypto.js',
  'src/sync-merge.js',
  'src/sync-lan-mobile.js',
  'src/sync-v2-mobile.js',
  'src/screens/VaultScreen.js',
  'src/screens/LockScreen.js',
  'src/components/VaultCardItem.js',
  'src/hooks/useVaultLifecycle.js',
  'src/hooks/useVaultSearch.js',
];

console.log('\n[2. Top-Level Const Reassignment Guard (no-const-assign)]');
for (const relPath of ALL_SOURCE_FILES) {
  check(`No top-level const reassignment in ${relPath}`, () => {
    const fullPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(fullPath), `Missing file: ${relPath}`);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    const topConsts = [];
    lines.forEach((line, idx) => {
      const m = line.match(/^const\s+([a-zA-Z0-9_$]+)\s*=/);
      if (m) topConsts.push({ name: m[1], line: idx + 1 });
    });

    for (const c of topConsts) {
      const assignRegex = new RegExp(`\\b${c.name}\\s*=[^=]`);
      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        if (lineNo === c.line) return;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (
          !line.includes(`const ${c.name}`) &&
          !line.includes(`let ${c.name}`) &&
          !line.includes(`var ${c.name}`) &&
          assignRegex.test(line)
        ) {
          throw new Error(
            `Const variable '${c.name}' (declared at line ${c.line}) is reassigned at line ${lineNo}: ${trimmed}`
          );
        }
      });
    }
  });
}

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`MOBILE STATIC CHECK SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
}

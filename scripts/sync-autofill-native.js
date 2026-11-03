#!/usr/bin/env node
'use strict';

/**
 * Synchronizes native Android Autofill sources from `plugins/android/` (single source of truth
 * used by Expo prebuild / EAS Build) into `android/app/src/main/` when the local `android/`
 * directory exists.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pluginAndroidDir = path.join(ROOT, 'plugins', 'android');
const androidMainDir = path.join(ROOT, 'android', 'app', 'src', 'main');

if (!fs.existsSync(pluginAndroidDir)) {
  console.error('[sync-autofill-native] plugins/android directory not found.');
  process.exit(1);
}

if (!fs.existsSync(androidMainDir)) {
  console.log('[sync-autofill-native] Local android/ directory not present; skipping local copy.');
  process.exit(0);
}

function copyDirFiles(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(srcDir)) {
    const srcFile = path.join(srcDir, name);
    if (!fs.statSync(srcFile).isFile()) continue;
    fs.copyFileSync(srcFile, path.join(dstDir, name));
    count++;
  }
  return count;
}

const targetJavaDir = path.join(androidMainDir, 'java', 'com', 'sombooosteam', 'fuin');
const targetResDir = path.join(androidMainDir, 'res');

const ktCount = copyDirFiles(path.join(pluginAndroidDir, 'java'), targetJavaDir);
const layoutCount = copyDirFiles(path.join(pluginAndroidDir, 'res', 'layout'), path.join(targetResDir, 'layout'));
const xmlCount = copyDirFiles(path.join(pluginAndroidDir, 'res', 'xml'), path.join(targetResDir, 'xml'));
const drawableCount = copyDirFiles(path.join(pluginAndroidDir, 'res', 'drawable'), path.join(targetResDir, 'drawable'));

console.log(
  `[sync-autofill-native] Synced ${ktCount} Kotlin, ${layoutCount} layout, ${xmlCount} xml, ${drawableCount} drawable files.`
);

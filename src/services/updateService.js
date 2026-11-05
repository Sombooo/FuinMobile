import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  GITHUB_MOBILE_RELEASES_URL,
  normalizeVersion,
  isTrustedApkAssetUrl,
  selectLatestApkRelease,
} from './updateCore';

const { FuinAppUpdaterModule } = NativeModules;
const FALLBACK_APP_VERSION = '1.0.0-beta.7';
const UPDATE_CHECK_TIMEOUT_MS = 8000;

export const updateService = {
  isSupported() {
    return Platform.OS === 'android' && !!FuinAppUpdaterModule;
  },

  async getInstalledVersion() {
    if (!this.isSupported()) return FALLBACK_APP_VERSION;
    try {
      const info = await FuinAppUpdaterModule.getAppVersionInfo();
      return info?.versionName ? String(info.versionName) : FALLBACK_APP_VERSION;
    } catch {
      return FALLBACK_APP_VERSION;
    }
  },

  async cleanupOldUpdates() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAppUpdaterModule.cleanupUpdateCache();
    } catch {
      return false;
    }
  },

  async canInstallPackages() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAppUpdaterModule.canInstallPackages();
    } catch {
      return false;
    }
  },

  async openInstallPermissionSettings() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAppUpdaterModule.openInstallPermissionSettings();
    } catch {
      return false;
    }
  },

  async checkForUpdate() {
    const currentVersion = await this.getInstalledVersion();
    if (!this.isSupported()) {
      return { supported: false, currentVersion, hasUpdate: false, update: null };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {}
        }, UPDATE_CHECK_TIMEOUT_MS)
      : null;

    try {
      const res = await fetch(GITHUB_MOBILE_RELEASES_URL, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller ? controller.signal : undefined,
      });

      if (!res.ok) {
        throw new Error(`HTTP_${res.status}`);
      }
      if (res.url && !res.url.startsWith('https://api.github.com/')) {
        throw new Error('UNTRUSTED_API_ORIGIN');
      }

      const releases = await res.json();
      const latest = selectLatestApkRelease(releases, currentVersion);

      return {
        supported: true,
        currentVersion: normalizeVersion(currentVersion),
        hasUpdate: !!latest,
        update: latest,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  /**
   * Downloads the release APK into Fuin's scoped private cache directory with live progress,
   * then performs native streaming SHA-256 + APK signing certificate + anti-downgrade verification.
   */
  async downloadAndVerifyUpdate(updateInfo, onProgress) {
    if (!this.isSupported()) {
      throw new Error('UNSUPPORTED_PLATFORM');
    }
    if (!updateInfo || !isTrustedApkAssetUrl(updateInfo.apkUrl)) {
      throw new Error('UNTRUSTED_APK_URL');
    }

    const targetNativePath = await FuinAppUpdaterModule.getUpdateTargetFilePath();
    const targetFileUri = targetNativePath.startsWith('file://')
      ? targetNativePath
      : `file://${targetNativePath}`;

    let lastEmitTs = 0;
    const downloadResumable = FileSystem.createDownloadResumable(
      updateInfo.apkUrl,
      targetFileUri,
      {},
      (prog) => {
        if (typeof onProgress !== 'function') return;
        const now = Date.now();
        const total = prog.totalBytesExpectedToWrite > 0
          ? prog.totalBytesExpectedToWrite
          : (updateInfo.apkSize || 0);
        const written = prog.totalBytesWritten || 0;
        const pct = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;

        if (pct === 100 || now - lastEmitTs >= 100) {
          lastEmitTs = now;
          onProgress({
            percent: pct,
            downloadedBytes: written,
            totalBytes: total,
          });
        }
      }
    );

    const downloadResult = await downloadResumable.downloadAsync();
    if (!downloadResult || downloadResult.status !== 200) {
      await this.cleanupOldUpdates();
      throw new Error(`DOWNLOAD_HTTP_${downloadResult?.status || 'ERR'}`);
    }

    const verification = await FuinAppUpdaterModule.verifyDownloadedApk(
      targetNativePath,
      updateInfo.expectedSha256 || ''
    );

    if (!verification || !verification.verified) {
      await this.cleanupOldUpdates();
      throw new Error('APK_VERIFICATION_FAILED');
    }

    return verification.path || targetNativePath;
  },

  async launchVerifiedInstaller(verifiedPath) {
    if (!this.isSupported() || !verifiedPath) return false;
    return await FuinAppUpdaterModule.installVerifiedApk(verifiedPath);
  },
};

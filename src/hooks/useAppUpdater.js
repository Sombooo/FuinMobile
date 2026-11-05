import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { updateService } from '../services/updateService';
import { normalizeVersion } from '../services/updateCore';

export default function useAppUpdater({ t, showAlert }) {
  const [currentVersion, setCurrentVersion] = useState('1.0.0-beta.7');
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, downloadedBytes: 0, totalBytes: 0 });
  const [statusMessage, setStatusMessage] = useState('');
  const pendingVerifiedPathRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (Platform.OS !== 'android') return () => { mountedRef.current = false; };

    (async () => {
      const installed = await updateService.getInstalledVersion();
      if (mountedRef.current && installed) {
        setCurrentVersion(normalizeVersion(installed));
      }
      await updateService.cleanupOldUpdates();
      try {
        const res = await updateService.checkForUpdate();
        if (mountedRef.current && res.hasUpdate && res.update) {
          setUpdateInfo(res.update);
        }
      } catch {
        // Silent failure when offline ("Quietly Secure" offline-first invariant)
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Automatically resume installation once user enables "Allow from this source" in Android Settings
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && pendingVerifiedPathRef.current) {
        const allowed = await updateService.canInstallPackages();
        if (allowed && pendingVerifiedPathRef.current) {
          const pathToInstall = pendingVerifiedPathRef.current;
          pendingVerifiedPathRef.current = null;
          try {
            await updateService.launchVerifiedInstaller(pathToInstall);
          } catch {
            if (mountedRef.current) {
              showAlert(t('alertError'), t('updateInstallError'));
            }
          }
        }
      }
    });
    return () => sub.remove();
  }, [t, showAlert]);

  const checkUpdatesManual = useCallback(async () => {
    if (checking || downloading || verifying) return;
    setChecking(true);
    setStatusMessage('');
    try {
      const res = await updateService.checkForUpdate();
      if (!mountedRef.current) return;
      if (res.currentVersion) {
        setCurrentVersion(res.currentVersion);
      }
      if (res.hasUpdate && res.update) {
        setUpdateInfo(res.update);
        setBannerDismissed(false);
        setStatusMessage(
          (t('updateAvailableMsg') || 'Yeni sürüm mevcut: v{version}').replace('{version}', res.update.version)
        );
      } else {
        setUpdateInfo(null);
        setStatusMessage(
          (t('updateUpToDateMsg') || 'En güncel sürümü kullanıyorsunuz (v{version}).').replace(
            '{version}',
            res.currentVersion || currentVersion
          )
        );
      }
    } catch {
      if (mountedRef.current) {
        setStatusMessage(t('updateCheckFailedMsg') || 'Kontrol edilemedi. İnternet bağlantısını kontrol edin.');
      }
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, [checking, downloading, verifying, currentVersion, t]);

  const startUpdateDownload = useCallback(async () => {
    if (!updateInfo || downloading || verifying) return;
    setDownloading(true);
    setVerifying(false);
    setStatusMessage('');
    setProgress({ percent: 0, downloadedBytes: 0, totalBytes: updateInfo.apkSize || 0 });

    try {
      const verifiedPath = await updateService.downloadAndVerifyUpdate(updateInfo, (prog) => {
        if (!mountedRef.current) return;
        setProgress(prog);
        if (prog.percent >= 100) {
          setVerifying(true);
        }
      });

      if (!mountedRef.current) return;
      setDownloading(false);
      setVerifying(false);

      const allowed = await updateService.canInstallPackages();
      if (!allowed) {
        pendingVerifiedPathRef.current = verifiedPath;
        showAlert(
          t('updatePermTitle') || 'Kurulum İzni Gerekiyor',
          t('updatePermBody') ||
            'Güncelleme indirildi ve imzası doğrulandı. Kurulumu tamamlamak için açılan ekranda Fuin için "Bu kaynaktan izin ver" seçeneğini etkinleştirin.',
          [
            {
              text: t('btnCancel') || 'İptal',
              style: 'cancel',
              onPress: () => {
                pendingVerifiedPathRef.current = null;
              },
            },
            {
              text: t('updatePermBtn') || 'İzin Ver ve Kur',
              onPress: () => {
                updateService.openInstallPermissionSettings();
              },
            },
          ]
        );
        return;
      }

      await updateService.launchVerifiedInstaller(verifiedPath);
    } catch (err) {
      if (!mountedRef.current) return;
      setDownloading(false);
      setVerifying(false);
      const code = String(err?.message || '');
      const isSecurityFailure =
        code.includes('SHA256') || code.includes('SIGNATURE') || code.includes('PACKAGE_MISMATCH') || code.includes('DOWNGRADE');
      showAlert(
        t('alertError'),
        isSecurityFailure
          ? t('updateSecurityVerifyError') || 'Güvenlik doğrulaması başarısız oldu (imza veya özet uyuşmazlığı). Dosya silindi.'
          : t('updateDownloadError') || 'Güncelleme indirilemedi. Lütfen bağlantınızı kontrol edip tekrar deneyin.'
      );
    }
  }, [updateInfo, downloading, verifying, t, showAlert]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  return {
    isSupported: updateService.isSupported(),
    currentVersion,
    checking,
    updateInfo,
    showBanner: Boolean(updateInfo && !bannerDismissed),
    downloading,
    verifying,
    progress,
    statusMessage,
    checkUpdatesManual,
    startUpdateDownload,
    dismissBanner,
  };
}

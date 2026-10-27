import CustomTextInput from './src/components/CustomTextInput';
import CustomText from './src/components/CustomText';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, AppState, TextInput, Animated, LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { encryptLocalVault, decryptLocalVault } from './src/crypto';
import { saveVault, loadVault, clearVault, saveVaultBackup, getSyncState, setSyncState, setHasLocalEdits, runStorageDiagnostics } from './src/storage';
import { ChunkAssembler, processSyncEnvelope } from './src/sync-v2-mobile';
import { ThemeProvider, useTheme } from './src/theme';
import * as SecureStore from 'expo-secure-store';
import * as Font from 'expo-font';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ClipboardExpo from 'expo-clipboard';
import { Buffer } from '@craftzdog/react-native-buffer';
import * as ScreenCapture from 'expo-screen-capture';
import { clearIfExpired } from './src/clipboardManager';
import useVaultLifecycle from './src/hooks/useVaultLifecycle';
import { initSessionKey, clearSessionKey, protectEntries, unprotectEntries } from './src/services/sessionSecurity';

import LockScreen from './src/screens/LockScreen';
import VaultScreen from './src/screens/VaultScreen';
import SuccessScreen from './src/screens/SuccessScreen';
import { ToastProvider, useToast } from './src/components/Toast';
import { LanguageProvider, useI18n } from './src/i18n';
import { AlertProvider, useAlert } from './src/components/CustomAlert';
import { useShareIntent } from 'expo-share-intent';
import { Feather } from '@expo/vector-icons';
// Removed defaultProps hack

function AppInner() {
  const [fontsLoaded] = Font.useFonts({
    'JetBrains Mono': require('./assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrains Mono-Medium': require('./assets/fonts/JetBrainsMono-Medium.ttf'),
    'JetBrains Mono-SemiBold': require('./assets/fonts/JetBrainsMono-SemiBold.ttf'),
    'JetBrains Mono-Bold': require('./assets/fonts/JetBrainsMono-Bold.ttf'),
  });

  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('lock');
  const modeAnim = useRef(new Animated.Value(1)).current;

  const changeModeSmooth = (nextMode) => {
    Animated.timing(modeAnim, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(() => {
      setMode(nextMode);
      Animated.timing(modeAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
    });
  };
  const lockApp = () => {
    clearSessionKey();
    setPassword('');
    setVaultData(null);
    setSyncPassword('');
    setChunkAssembler(null);
    setChunks({});
    setTotalChunks(0);
    setIsDecrypting(false);
    setPendingV2Transfer(null);
    setPendingPayload(null);
    setSyncPasswordPrompt(false);
    setMasterPasswordPrompt(false);
    setImportMasterPassword('');
    setImportConfirmPassword('');
    setSyncFailCount(0);
    setSyncLockUntil(0);
    changeModeSmooth('lock');
  };

  const [permission, requestPermission] = useCameraPermissions();
  const toast = useToast();
  const { t } = useI18n();
  const { showAlert } = useAlert();
  
  const [hasLocalVault, setHasLocalVault] = useState(false);
  const [vaultData, setVaultData] = useState(null);

  // Sync state
  const [chunks, setChunks] = useState({});
  const [totalChunks, setTotalChunks] = useState(0);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');
  const [syncPasswordPrompt, setSyncPasswordPrompt] = useState(false);
  const [syncFailCount, setSyncFailCount] = useState(0);
  const [syncLockUntil, setSyncLockUntil] = useState(0);
  const isBarcodeLocked = useRef(false);
  const isLanSyncing = useRef(false);
  const [lanPairingVersion, setLanPairingVersion] = useState(0);
  const [syncIntent, setSyncIntent] = useState('sync'); // 'sync' | 'pair'
  const [hasPairedDevice, setHasPairedDevice] = useState(false);
  const [chunkAssembler, setChunkAssembler] = useState(null);
  const [syncSourceMode, setSyncSourceMode] = useState('lock');
  const [pendingV2Transfer, setPendingV2Transfer] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [masterPasswordPrompt, setMasterPasswordPrompt] = useState(false);
  const [importMasterPassword, setImportMasterPassword] = useState('');
  const [importConfirmPassword, setImportConfirmPassword] = useState('');

  const [masterKeyData, setMasterKeyData] = useState(null);
  const lastSyncErrorToast = useRef(0);

  // Share Intent State
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [sharedEntryData, setSharedEntryData] = useState(null);

  useEffect(() => {
    // Ekran koruması: FLAG_SECURE ve ekran görüntüsü/kaydı engelleme varsayılan olarak açıktır.
    ScreenCapture.preventScreenCaptureAsync().catch(console.warn);
  }, []);

  useEffect(() => {
    if (hasShareIntent && shareIntent.value) {
      const text = String(shareIntent.value || '');
      const isUrl = text.startsWith('http://') || text.startsWith('https://');
      const title = shareIntent.meta?.title || '';
      let parsedHost = 'Yeni Kayıt';
      if (isUrl) {
        try {
          parsedHost = new URL(text).hostname.replace('www.', '') || 'Yeni Kayıt';
        } catch {
          parsedHost = 'Yeni Kayıt';
        }
      }
      
      setSharedEntryData({
        site: title || parsedHost,
        url: isUrl ? text : '',
        notes: isUrl ? '' : text,
        category: 'Diğer'
      });
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent]);

  const checkLocalVault = async () => {
    const data = await loadVault();
    setHasLocalVault(!!data);
  };

  const { isAppActive } = useVaultLifecycle({
    onLock: lockApp,
    onCheckLocalVault: checkLocalVault,
  });

  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (pw = password) => {
    if (isLoggingIn) return;
    if (pw && pw.length > 128) return;
    
    if (!pw) {
      showAlert(t('alertError'), t('toastEnterPassword'));
      return;
    }
    
    if (!hasLocalVault) {
      showAlert(t('alertError'), t('toastVaultNotFound'));
      return;
    }

    const savedLockUntil = parseInt(await SecureStore.getItemAsync('fuin_lock_until') || '0', 10);
    if (Date.now() < savedLockUntil) {
      const remaining = Math.ceil((savedLockUntil - Date.now()) / 1000);
      showAlert(t('alertError'), `${remaining}s beklemeniz gerekiyor.`);
      return;
    }

    setIsLoggingIn(true);
    try {
      const encryptedBase64 = await loadVault();
      const decryptedJson = await decryptLocalVault(encryptedBase64, pw);
      
      await SecureStore.deleteItemAsync('fuin_fail_count');
      await SecureStore.deleteItemAsync('fuin_lock_until');
      setFailCount(0);
      
      initSessionKey();
      let safeVaultJson = decryptedJson;
      try {
        const parsed = JSON.parse(decryptedJson);
        if (parsed && Array.isArray(parsed.entries)) {
          parsed.entries = protectEntries(parsed.entries);
          safeVaultJson = JSON.stringify(parsed);
        }
      } catch {}

      setPassword(pw);
      setVaultData(safeVaultJson);
      changeModeSmooth('vault');
      setIsLoggingIn(false);
    } catch (e) {
      if (e.message && (e.message.includes('boyut') || e.message.includes('tipi'))) {
        const { getVaultBackups, restoreVaultBackup } = require('./src/storage');
        const backups = await getVaultBackups();
        if (backups.length > 0) {
          const restored = await restoreVaultBackup(backups[0].fileName);
          if (restored) {
            showAlert('Kurtarma Başarılı', 'Kasa dosyanız bozuktu ancak otomatik olarak son sağlıklı yedeğe dönüldü. Tekrar giriş yapın.');
            setIsLoggingIn(false);
            return;
          }
        }
        showAlert('Kritik Hata', 'Kasa dosyası bozulmuş ve kurtarılacak yedek bulunamadı.');
        setIsLoggingIn(false);
        return;
      }

      const savedFailCount = parseInt(await SecureStore.getItemAsync('fuin_fail_count') || '0', 10);
      const newFailCount = savedFailCount + 1;
      setFailCount(newFailCount);
      await SecureStore.setItemAsync('fuin_fail_count', newFailCount.toString());
      
      if (newFailCount >= 3) {
        const delay = Math.min(5 * Math.pow(2, newFailCount - 3), 300) * 1000;
        const newLockUntil = Date.now() + delay;
        setLockUntil(newLockUntil);
        await SecureStore.setItemAsync('fuin_lock_until', newLockUntil.toString());
      }
      
      if (newFailCount >= 15) {
        await clearVault();
        await SecureStore.deleteItemAsync('fuin_fail_count');
        await SecureStore.deleteItemAsync('fuin_lock_until');
        handleVaultErased();
        showAlert(t('alertError'), 'Çok fazla hatalı deneme nedeniyle kasa silindi.');
        setIsLoggingIn(false);
        return;
      }
      showAlert(t('alertError'), t('toastWrongPasswordOrCorrupted'));
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    const handleLoginBio = async () => {
      let targetPassword = null;
      try {
        const bioEnabled = await SecureStore.getItemAsync('fuin-biometric-enabled');
        if (bioEnabled === 'true') {
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = await LocalAuthentication.isEnrolledAsync();
          if (hasHardware && isEnrolled) {
            const auth = await LocalAuthentication.authenticateAsync({
              promptMessage: t('bioPromptLogin'),
              fallbackLabel: t('bioFallbackLabel')
            });
            if (auth.success) {
              targetPassword = await SecureStore.getItemAsync('fuin-biometric-key', {
                requireAuthentication: true,
                authenticationPrompt: t('bioPromptLogin'),
              });
            }
          }
        }

        if (targetPassword) {
          handleLogin(targetPassword);
        }
      } catch (e) {}
    };

    if (mode === 'lock' && hasLocalVault) {
      handleLoginBio();
    }
  }, [mode, hasLocalVault]);

  const [syncMode, setSyncMode] = useState('lan');

  useEffect(() => {
    SecureStore.setItemAsync('fuin_sync_mode', 'lan').catch(() => {});
    setSyncMode('lan');
  }, [mode]);

  useEffect(() => {
    const checkPaired = async () => {
      try {
        const { getPairingInfo } = require('./src/sync-lan-mobile');
        const info = await getPairingInfo();
        setHasPairedDevice(!!info);
      } catch {
        setHasPairedDevice(false);
      }
    };
    checkPaired();
  }, [lanPairingVersion, mode]);

  const handlePerformLanSync = async () => {
    if (isLanSyncing.current) return;
    isLanSyncing.current = true;

    try {
      const { getPairingInfo } = require('./src/sync-lan-mobile');
      const existingPairing = await getPairingInfo();
      if (!existingPairing) {
        showAlert(
          t('alertWarning') || 'Dikkat',
          t('noPairedDeviceWarn') || 'Henüz eşleşmiş bir cihaz bulunmuyor. Lütfen önce Ayarlar sekmesinden cihazınızı eşleştirin.'
        );
        return;
      }
    } catch {}

    if (hasLocalVault && !vaultData) {
      showAlert(t('alertError') || 'Kasa Kilitli', t('syncVaultLockedMsg') || 'Senkronizasyon yapabilmek için lütfen önce kasanızın kilidini açın.');
      return;
    }

    try {
      setIsDecrypting(true);
      toast.showToast(t('syncLanInProgress') || 'Wi-Fi üzerinden eşitleniyor...');
      const { performLanSync } = require('./src/sync-lan-mobile');

      let parsedVault = null;
      if (vaultData) {
        try {
          parsedVault = typeof vaultData === 'string' ? JSON.parse(vaultData) : vaultData;
          if (parsedVault && Array.isArray(parsedVault.entries)) {
            parsedVault = {
              ...parsedVault,
              entries: unprotectEntries(parsedVault.entries)
            };
          }
        } catch {}
      }

      const result = await performLanSync(parsedVault || { entries: [] });
      
      if (result && Array.isArray(result.entries)) {
        if (parsedVault) {
          const updatedVault = {
            ...parsedVault,
            entries: result.entries
          };
          const updatedVaultJson = JSON.stringify(updatedVault);
          await handleUpdateVaultData(updatedVaultJson);
          showAlert(t('syncLanSuccessTitle'), `${t('syncLanCompleted')} (${result.entries.length} ${t('syncEntriesCount')})`);
          setMode('vault');
        } else {
          setPendingPayload({
            entries: result.entries,
            generation: 1,
            timestamp: result.timestamp || Date.now()
          });
          setMasterPasswordPrompt(true);
          setMode('sync');
        }
      }
    } catch (err) {
      setLanPairingVersion(v => v + 1);

      const isRevoked = err.message && (
        err.message.includes('kaldırılmış') || 
        err.message.includes('401') || 
        err.message.includes('Yetkisiz')
      );

      if (isRevoked) {
        showAlert(
          t('syncErrorTitle'),
          t('syncRevokedBody') || 'Masaüstü cihazında bu eşleşme kaldırılmış olduğu için telefonunuzdaki bağlantı da sıfırlandı. Lütfen Ayarlar sekmesinden tekrar eşleştirin.',
          [{
            text: t('btnOk') || 'Tamam',
            onPress: () => {
              if (syncSourceMode === 'vault' && vaultData) changeModeSmooth('vault');
            }
          }]
        );
      } else {
        showAlert(
          t('syncErrorTitle'),
          t('syncUnreachableDetailed') || 'Masaüstü cihazına bağlanılamadı.\n\nLütfen kontrol edin:\n• Bilgisayarınızda Fuin açık ve ana ekrandaki "Eşitle" butonuna basılmış olmalı.\n• Telefon ve bilgisayarınız aynı Wi-Fi / yerel ağa bağlı olmalı.\n• Veya cihaz eşleşmesi bilgisayardan kaldırılmış olabilir.',
          [
            {
              text: t('btnUnpairDevice') || 'Eşleşmeyi Kaldır',
              style: 'destructive',
              onPress: async () => {
                const { clearPairingInfo } = require('./src/sync-lan-mobile');
                await clearPairingInfo();
                setLanPairingVersion(v => v + 1);
                showAlert(t('alertSuccess'), t('toastDeviceUnpaired'));
                if (syncSourceMode === 'vault' && vaultData) changeModeSmooth('vault');
              }
            },
            {
              text: t('btnOk') || 'Tamam',
              style: 'cancel',
              onPress: () => {
                if (syncSourceMode === 'vault' && vaultData) changeModeSmooth('vault');
              }
            }
          ]
        );
      }
    } finally {
      setIsDecrypting(false);
      isLanSyncing.current = false;
      isBarcodeLocked.current = false;
    }
  };

  const handleCancelScanner = () => {
    isBarcodeLocked.current = false;
    setChunkAssembler(null);
    setChunks({});
    setTotalChunks(0);
    setIsDecrypting(false);
    setSyncIntent('sync');
    if (syncSourceMode === 'vault' && vaultData) {
      changeModeSmooth('vault');
    } else {
      lockApp();
    }
  };

  const startCameraSync = (intent = 'pair') => {
    isBarcodeLocked.current = false;
    setSyncSourceMode(mode);
    setSyncIntent('pair');
    setSyncPassword('');
    setSyncPasswordPrompt(false);
    setPendingV2Transfer(null);
    setPendingPayload(null);
    setMasterPasswordPrompt(false);
    setIsDecrypting(false);
    setMode('sync');
  };

  const handleSyncButton = async () => {
    try {
      const { getPairingInfo } = require('./src/sync-lan-mobile');
      const pairing = await getPairingInfo();
      if (pairing) {
        handlePerformLanSync();
        return;
      } else {
        showAlert(
          t('settingSyncDevicesTitle'),
          t('pairDesktopHint'),
          [
            { text: t('btnCancel'), style: 'cancel' },
            { text: t('btnPairDesktop'), style: 'primary', onPress: () => startCameraSync('pair') }
          ]
        );
        return;
      }
    } catch {}
    startCameraSync('pair');
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (isDecrypting || syncPasswordPrompt || masterPasswordPrompt || isBarcodeLocked.current) return;
    
    const cleanData = typeof data === 'string' ? data.trim() : '';
    let pairing = null;
    if (cleanData && cleanData.startsWith('{') && (cleanData.includes('fuin-lan') || cleanData.includes('pairKey'))) {
      try {
        pairing = JSON.parse(cleanData);
      } catch (err) {
        console.warn('Pairing parse error:', err);
      }
    } else if (cleanData && cleanData.startsWith('fuin://pair')) {
      try {
        const url = new URL(cleanData);
        pairing = {
          protocol: 'fuin-lan-v1',
          deviceId: url.searchParams.get('id') || url.searchParams.get('deviceId'),
          pairKey: url.searchParams.get('key') || url.searchParams.get('pairKey'),
          port: parseInt(url.searchParams.get('port') || '8765', 10),
          addresses: (url.searchParams.get('ips') || '').split(',').filter(Boolean)
        };
      } catch (err) {
        console.warn('Pairing URL parse error:', err);
      }
    }

    if (pairing && pairing.pairKey && pairing.deviceId) {
      isBarcodeLocked.current = true;
      try {
        const { savePairingInfo, sendPairRequest } = require('./src/sync-lan-mobile');
        toast.showToast(t('pairingInProgress') || 'Masaüstü cihaz ile eşleştiriliyor...');

        let pairResult = null;
        if (typeof sendPairRequest === 'function') {
          pairResult = await sendPairRequest(pairing).catch(() => null);
        }

        if (!pairResult || !pairResult.success) {
          showAlert(
            t('syncErrorTitle') || 'Eşleştirme Hatası',
            t('pairingFailedBody') || 'Masaüstü cihaz ile eşleşme kurulamadı.\n\nLütfen kontrol edin:\n• Telefon ve bilgisayarınız aynı Wi-Fi / yerel ağa bağlı olmalı.\n• Masaüstünde Fuin\'de "Cihaz Eşle" veya "Eşitle" açık olmalı.',
            [{
              text: t('btnOk') || 'Tamam',
              onPress: () => {
                isBarcodeLocked.current = false;
              }
            }]
          );
          return;
        }

        await savePairingInfo(pairing);
        setLanPairingVersion(v => v + 1);

        // If user has an active unlocked vault, switch away from scanner immediately and perform two-way sync
        if (vaultData) {
          setSyncIntent('sync');
          toast.showToast(t('syncLanInProgress') || 'Cihaz eşleşti, veriler eşitleniyor...');
          setMode('vault');
          await handlePerformLanSync();
          return;
        }

        showAlert(
          t('pairingSuccessTitle'),
          t('pairingSuccessBody').replace('{deviceId}', pairing.deviceId),
          [
            {
              text: t('btnSyncWifiNow'),
              style: 'primary',
              onPress: () => {
                setSyncIntent('sync');
                setMode(vaultData ? 'vault' : 'lock');
                handlePerformLanSync();
              }
            },
            { 
              text: t('btnDone'), 
              style: 'cancel',
              onPress: () => {
                isBarcodeLocked.current = false;
                setSyncIntent('sync');
                setMode(vaultData ? 'vault' : 'lock');
              } 
            }
          ]
        );
        return;
      } catch (err) {
        isBarcodeLocked.current = false;
        console.warn('Pairing save error:', err);
      }
    }

    if (!data.startsWith('FUIN|2|')) {
      return;
    }

    if (!chunkAssembler) return;
    const res = chunkAssembler.add(data);
    if (res.error) {
      if (res.timedOut) {
        setChunks({});
        setTotalChunks(0);
      }
      const now = Date.now();
      if (now - lastSyncErrorToast.current > 2000) {
        lastSyncErrorToast.current = now;
        toast.showToast(t('syncTransferFailed'));
      }
      return;
    }
    
    setChunks({ ...chunkAssembler.chunks });
    setTotalChunks(chunkAssembler.total);

    if (res.complete && !isDecrypting) {
      setPendingV2Transfer({ envelope: res.envelope, sessionIdHex: res.sessionIdHex });
      
      // Auto-decrypt using paired device's pairKey if paired
      (async () => {
        try {
          const { getPairingInfo } = require('./src/sync-lan-mobile');
          const pairing = await getPairingInfo();
          if (pairing && pairing.pairKey) {
            setIsDecrypting(true);
            try {
              const ok = await processV2Transfer(res.envelope, res.sessionIdHex, pairing.pairKey, true);
              if (ok) return;
            } catch (err) {
              // Pair key did not decrypt this QR, fall back to manual password prompt
            } finally {
              setIsDecrypting(false);
            }
          }
        } catch {}
        setSyncPasswordPrompt(true);
      })();
    }
  };

  const handleConfirmSyncPassword = async () => {
    const pw = syncPassword ? syncPassword.trim() : '';
    if (!pw) {
      showAlert(t('alertError'), t('toastEnterPassword'));
      return;
    }
    if (pw.length < 10) {
      showAlert(t('alertError'), t('syncPassMinLen') || 'Sync şifresi en az 10 karakter olmalıdır.');
      return;
    }
    if (Date.now() < syncLockUntil) {
      const waitSec = Math.ceil((syncLockUntil - Date.now()) / 1000);
      showAlert(t('alertError'), `${t('syncRetryDelayText') || 'Lütfen tekrar denemeden önce bekleyin:'} ${waitSec}s`);
      return;
    }
    if (!pendingV2Transfer) return;
    setSyncPasswordPrompt(false);
    setIsDecrypting(true);
    await processV2Transfer(pendingV2Transfer.envelope, pendingV2Transfer.sessionIdHex, syncPassword);
  };

  const processV2Transfer = async (envelope, sessionIdHex, syncPw, isSilent = false) => {
    try {
      const cleanPw = syncPw ? syncPw.trim() : '';
      const syncState = await getSyncState();
      const payload = await processSyncEnvelope(envelope, sessionIdHex, cleanPw);
      
      // Generation / Replay Validation
      if (payload.generation <= syncState.generation && syncState.generation !== 0) {
        throw new Error('Bu senkronizasyon verisi eski veya daha önce kullanılmış');
      }

      setSyncFailCount(0);
      setSyncLockUntil(0);

      const proceedToSaveOrMasterPassword = () => {
        if (syncSourceMode === 'vault' && password) {
          finalizeV2Import(payload, password);
        } else {
          setIsDecrypting(false);
          setPendingPayload(payload);
          setMasterPasswordPrompt(true);
        }
      };

      if (syncState.hasLocalEdits) {
        // Two-way deterministic merge ensures zero data loss; proceed non-destructively
        proceedToSaveOrMasterPassword();
      } else {
        proceedToSaveOrMasterPassword();
      }
      return true;
    } catch (e) {
      if (isSilent) {
        throw e;
      }
      const isAuthFailure = e.message && (
        e.message.includes('Yanlış Sync Password') || 
        e.message.includes('bozulmuş/tahrif')
      );

      if (isAuthFailure) {
        const newFailCount = syncFailCount + 1;
        setSyncFailCount(newFailCount);
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
        const delaySec = Math.min(Math.pow(2, newFailCount - 1), 30);
        const lockTime = Date.now() + (delaySec * 1000);
        setSyncLockUntil(lockTime);

        showAlert(t('alertError'), `${e.message || t('alertDecryptFailed')}\n\n${t('syncRetryDelayPrefix') || 'Güvenlik gecikmesi:'} ${delaySec}s`, [
          { 
            text: t('btnOk'), 
            onPress: () => { 
              setIsDecrypting(false); 
              setSyncPasswordPrompt(true);
            } 
          }
        ]);
      } else {
        showAlert(t('alertError'), e.message || t('alertDecryptFailed'), [
          { 
            text: t('btnOk'), 
            onPress: () => { 
              setIsDecrypting(false); 
              setSyncPasswordPrompt(true);
            } 
          }
        ]);
      }
    }
  };

  const handleConfirmMasterPassword = async () => {
    if (!importMasterPassword || importMasterPassword.length < 8) {
      showAlert(t('alertError'), t('toastMin8Chars'));
      return;
    }
    if (importMasterPassword !== importConfirmPassword) {
      showAlert(t('alertError'), t('toastPasswordsDoNotMatch'));
      return;
    }
    if (!pendingPayload) {
      showAlert(t('alertError'), 'Senkronizasyon verisi bulunamadı.');
      return;
    }
    await finalizeV2Import(pendingPayload, importMasterPassword);
  };

  const finalizeV2Import = async (payload, targetMasterPassword) => {
    try {
      let existingEntries = [];
      let existingCategories = [];
      if (vaultData) {
        try {
          const parsed = typeof vaultData === 'string' ? JSON.parse(vaultData) : vaultData;
          if (Array.isArray(parsed?.entries)) existingEntries = parsed.entries;
          if (Array.isArray(parsed?.categories)) existingCategories = parsed.categories;
        } catch {}
      } else {
        const existingVaultEnc = await loadVault();
        if (existingVaultEnc && targetMasterPassword) {
          try {
            const dec = await decryptLocalVault(existingVaultEnc, targetMasterPassword);
            const parsed = typeof dec === 'string' ? JSON.parse(dec) : dec;
            if (Array.isArray(parsed?.entries)) existingEntries = parsed.entries;
            if (Array.isArray(parsed?.categories)) existingCategories = parsed.categories;
          } catch {}
        }
      }

      const { mergeVaultEntries } = require('./src/sync-merge');
      const { mergedEntries } = mergeVaultEntries(existingEntries, payload.entries || []);

      const finalVault = {
        type: 'fuin/vault',
        categories: existingCategories.length > 0 ? existingCategories : (payload.categories || []),
        entries: mergedEntries
      };
      const finalVaultJson = JSON.stringify(finalVault);

      // Pre-sync backup safeguard: ensure existing local vault is preserved prior to snapshot overwrite
      const existingVaultEnc = await loadVault();
      if (existingVaultEnc) {
        await saveVaultBackup(existingVaultEnc);
      }

      const localEncrypted = await encryptLocalVault(finalVaultJson, targetMasterPassword);
      await saveVault(localEncrypted);
      await saveVaultBackup(localEncrypted);
      
      await setSyncState({
        generation: payload.generation,
        snapshotHash: payload.snapshotHash,
        sessionId: payload.sessionId,
        timestamp: payload.timestamp,
        hasLocalEdits: false
      });

      await checkLocalVault();
      setPassword(targetMasterPassword);
      setVaultData(finalVaultJson);
      
      setChunkAssembler(null);
      setChunks({});
      setTotalChunks(0);
      setIsDecrypting(false);
      setPendingV2Transfer(null);
      setPendingPayload(null);
      setSyncPasswordPrompt(false);
      setMasterPasswordPrompt(false);
      setImportMasterPassword('');
      setImportConfirmPassword('');
      setMode('success');
    } catch (e) {
      showAlert(t('alertError'), e.message, [
        { 
          text: t('btnOk'), 
          onPress: () => { 
            setIsDecrypting(false); 
            if (syncSourceMode === 'lock' || !password) {
              setMasterPasswordPrompt(true);
            }
          } 
        }
      ]);
    }
  };

  const handleCreateVault = async (newPassword) => {
    let stage = 'START';
    try {
      console.log('[VAULT_CREATE] START');

      stage = 'PASSWORD_VALIDATION';
      if (!newPassword || newPassword.length < 8) {
        throw new Error('PASSWORD_TOO_SHORT');
      }
      console.log('[VAULT_CREATE] PASSWORD_VALIDATION_OK');

      stage = 'DIAGNOSTICS';
      console.log('[VAULT_CREATE] DIAGNOSTICS_START');
      await runStorageDiagnostics();
      console.log('[VAULT_CREATE] DIAGNOSTICS_OK');

      stage = 'PAYLOAD_PREPARATION';
      const emptyVaultJson = JSON.stringify({ type: 'fuin/vault', categories: [], entries: [] });
      console.log('[VAULT_CREATE] PAYLOAD_PREPARATION_OK');

      stage = 'KEY_DERIVATION_AND_ENCRYPTION';
      console.log('[VAULT_CREATE] KEY_DERIVATION_START');
      console.log('[VAULT_CREATE] ENCRYPTION_START');
      const localEncrypted = await encryptLocalVault(emptyVaultJson, newPassword);
      console.log('[VAULT_CREATE] KEY_DERIVATION_OK');
      console.log('[VAULT_CREATE] ENCRYPTION_OK');

      stage = 'SAVE';
      console.log('[VAULT_CREATE] SAVE_START');
      await saveVault(localEncrypted, true);
      console.log('[VAULT_CREATE] SAVE_OK');

      stage = 'BACKUP';
      console.log('[VAULT_CREATE] BACKUP_START');
      await saveVaultBackup(localEncrypted);
      console.log('[VAULT_CREATE] BACKUP_OK');

      stage = 'METADATA';
      console.log('[VAULT_CREATE] METADATA_START');
      try {
        const crypto = require('react-native-quick-crypto');
        const { deriveLocalKey } = require('./src/crypto');
        const keyBytes = crypto.randomBytes(16);
        const rawMasterKey = Array.from(keyBytes)
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join('')
          .match(/.{4}/g)
          .join('-');

        const recoverySalt = crypto.randomBytes(32);
        const recoveryKey = await deriveLocalKey(rawMasterKey, recoverySalt);

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', recoveryKey, iv);
        const enc1 = cipher.update(Buffer.from(newPassword, 'utf8'));
        const enc2 = cipher.final();
        const tag = cipher.getAuthTag();
        const encryptedPass = Buffer.concat([recoverySalt, iv, tag, enc1, enc2]).toString('base64');

        try {
          await SecureStore.setItemAsync('fuin-recovery-code-hash', crypto.createHash('sha256').update(rawMasterKey).digest('hex'));
          await SecureStore.setItemAsync('fuin-recovery-data', encryptedPass);
        } catch (secureStoreError) {
          console.warn('[VAULT_CREATE] METADATA_SECURESTORE_IGNORED', secureStoreError?.message || secureStoreError);
        }

        setMasterKeyData(rawMasterKey);
      } catch (cryptoErr) {
        console.warn('[VAULT_CREATE] METADATA_RECOVERY_KEY_GEN_IGNORED', cryptoErr?.message || cryptoErr);
      }
      console.log('[VAULT_CREATE] METADATA_OK');

      stage = 'STATE';
      console.log('[VAULT_CREATE] STATE_START');
      initSessionKey();
      await checkLocalVault();
      setVaultData(emptyVaultJson);
      setMode('vault');
      console.log('[VAULT_CREATE] STATE_OK');

      console.log('[VAULT_CREATE] COMPLETE');
    } catch (err) {
      const errorName = err?.name || 'Error';
      const errorCode = err?.code || 'NO_CODE';
      const errorMessage = err?.message || String(err);
      console.error('[VAULT_CREATE] FAILURE', {
        stage,
        errorName,
        errorCode,
        message: errorMessage,
      });
      toast.showToast(`${t('toastVaultCreateFailed')} [${stage}: ${errorMessage}]`);
    }
  };

  const handleVaultErased = () => {
    setHasLocalVault(false);
    lockApp();
  };

  const handleUpdateVaultData = async (newVaultDataString) => {
    try {
      let parsed = null;
      try { parsed = JSON.parse(newVaultDataString); } catch {}
      let diskString = newVaultDataString;
      let memoryString = newVaultDataString;

      if (parsed && Array.isArray(parsed.entries)) {
        const cleanEntries = unprotectEntries(parsed.entries);
        diskString = JSON.stringify({ ...parsed, entries: cleanEntries });
        const protectedEntries = protectEntries(cleanEntries);
        memoryString = JSON.stringify({ ...parsed, entries: protectedEntries });
      }

      const localEncrypted = await encryptLocalVault(diskString, password);
      await saveVault(localEncrypted);
      await saveVaultBackup(localEncrypted);
      await setHasLocalEdits(true);
      setVaultData(memoryString);
      return true;
    } catch (e) {
      showAlert(t('alertError'), t('alertSaveFailed') + ' (Hata)');
      return false;
    }
  };

  // ── ROUTING ──
  if (!fontsLoaded) {
    return null;
  }

  let content = null;
  if (!isAppActive) {
    content = (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <CustomText style={{ color: theme.muted, fontSize: 18 }}>FuinMobile Kilitli</CustomText>
      </View>
    );
  } else if (mode === 'lock') {
    content = (
      <LockScreen 
        password={password} 
        setPassword={setPassword} 
        onLogin={handleLogin} 
        onSync={handleSyncButton} 
        onCreateVault={handleCreateVault}
        onVaultErased={handleVaultErased}
        hasVault={hasLocalVault} 
        syncMode={syncMode}
      />
    );
  } else if (mode === 'vault') {
    content = (
      <VaultScreen 
        vaultData={vaultData}
        password={password}
        onUpdateVaultData={handleUpdateVaultData}
        onLogout={() => {
          lockApp();
        }}
        onSyncRequest={handleSyncButton}
        onOpenScanner={startCameraSync}
        onPerformLanSync={handlePerformLanSync}
        sharedEntryData={sharedEntryData}
        setSharedEntryData={setSharedEntryData}
        lanPairingVersion={lanPairingVersion}
        onPairingUpdated={() => setLanPairingVersion(v => v + 1)}
      />
    );
  } else if (mode === 'success') {
    content = <SuccessScreen onComplete={() => setMode('vault')} />;
  } else if (mode === 'sync') {
    const progress = totalChunks > 0 ? Math.round((Object.keys(chunks).length / totalChunks) * 100) : 0;

    if (masterPasswordPrompt) {
      content = (
        <View style={{ flex: 1, backgroundColor: theme.bg, padding: 20, justifyContent: 'center' }}>
          <CustomText style={{ color: theme.text, fontSize: 18, marginBottom: 8, textAlign: 'center', fontWeight: 'bold' }}>
            {hasLocalVault ? t('syncMasterPromptTitleExisting') : t('syncMasterPromptTitleNew')}
          </CustomText>
          <CustomText style={{ color: theme.muted, fontSize: 13, marginBottom: 20, textAlign: 'center', lineHeight: 18 }}>
            {hasLocalVault ? t('syncMasterPromptDescExisting') : t('syncMasterPromptDescNew')}
          </CustomText>
          <CustomTextInput
            style={{
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              color: theme.text,
              padding: 14,
              fontSize: 15,
              marginBottom: 12
            }}
            placeholder={t('syncMasterPasswordPh')}
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={importMasterPassword}
            onChangeText={setImportMasterPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <CustomTextInput
            style={{
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              color: theme.text,
              padding: 14,
              fontSize: 15,
              marginBottom: 20
            }}
            placeholder={t('syncMasterConfirmPh')}
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={importConfirmPassword}
            onChangeText={setImportConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={{ backgroundColor: theme.accent, padding: 15, borderRadius: 8, alignItems: 'center' }}
            onPress={handleConfirmMasterPassword}
          >
            <CustomText style={{ color: theme.bg, fontWeight: 'bold' }}>{t('syncImportBtn')}</CustomText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: 20, alignItems: 'center' }}
            onPress={handleCancelScanner}
          >
            <CustomText style={{ color: theme.muted }}>{t('btnCancel')}</CustomText>
          </TouchableOpacity>
        </View>
      );
    } else if (syncPasswordPrompt) {
      content = (
        <View style={{ flex: 1, backgroundColor: theme.bg, padding: 20, justifyContent: 'center' }}>
          <CustomText style={{ color: theme.text, fontSize: 18, marginBottom: 20, textAlign: 'center' }}>
            {t('syncPasswordPromptTitle')}
          </CustomText>
          <CustomTextInput
            style={{
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              color: theme.text,
              padding: 14,
              fontSize: 15,
              marginBottom: 20
            }}
            placeholder={t('syncPasswordPh') || 'Sync Password'}
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={syncPassword}
            onChangeText={setSyncPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={{ backgroundColor: theme.accent, padding: 15, borderRadius: 8, alignItems: 'center' }}
            onPress={handleConfirmSyncPassword}
          >
            <CustomText style={{ color: theme.bg, fontWeight: 'bold' }}>{t('btnContinue')}</CustomText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: 20, alignItems: 'center' }}
            onPress={handleCancelScanner}
          >
            <CustomText style={{ color: theme.muted }}>{t('btnCancel')}</CustomText>
          </TouchableOpacity>
        </View>
      );
    } else {
      content = (
        <View style={{ flex: 1, backgroundColor: 'black' }}>
          {permission && permission.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              autofocus="on"
              onBarcodeScanned={handleBarcodeScanned}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            />
          ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
            <CustomText style={{ textAlign: 'center', marginBottom: 20, color: theme.text }}>{t('cameraPermissionRequired')}</CustomText>
            <TouchableOpacity style={{ backgroundColor: theme.accent, padding: 12, borderRadius: 4 }} onPress={requestPermission}>
              <CustomText style={{ color: theme.bg }}>{t('btnGrantPermission')}</CustomText>
            </TouchableOpacity>
          </View>
        )}
        <View style={[styles.overlay, { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'flex-end', pointerEvents: 'box-none' }]}>
          <CustomText style={styles.syncTitle}>
            {t('pairingScannerTitle') || 'CİHAZ EŞLEŞTİRME'}
          </CustomText>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <CustomText style={{ color: theme.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 }}>
              {t('pairingScannerSub') || 'Bilgisayarınızdaki eşleştirme QR kodunu okutun'}
            </CustomText>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 20, marginBottom: 20 }}>
            <TouchableOpacity style={[styles.cancelBtn, { flex: 1, alignItems: 'center', justifyContent: 'center' }]} onPress={handleCancelScanner}>
              <CustomText style={[styles.cancelText, { textAlign: 'center' }]}>{t('btnCancel')}</CustomText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
    }
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.View style={{ 
        flex: 1, 
        opacity: modeAnim,
        transform: [{
          scale: modeAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.985, 1],
          })
        }]
      }}>
        {content}
      </Animated.View>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        
        {/* Master Key Modal */}
        {masterKeyData && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }]}>
            <View style={{ width: '85%', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, padding: 24, borderRadius: 4 }}>
              <CustomText style={{ fontSize: 18, color: theme.text, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' }}>
                {t('recoveryCreatedTitle')}
              </CustomText>
              <CustomText style={{ fontSize: 13, color: theme.muted, lineHeight: 20, marginBottom: 20, textAlign: 'center' }}>
                {t('recoveryCreatedBody')}
              </CustomText>
              
              <View style={{ backgroundColor: '#1A1A1A', padding: 15, borderRadius: 4, borderWidth: 1, borderColor: '#333', marginBottom: 20, alignItems: 'center' }}>
                <CustomText style={{ fontSize: 16, color: theme.accent, fontWeight: '600', letterSpacing: 1 }}>
                  {masterKeyData}
                </CustomText>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity 
                  style={{ flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 4 }} 
                  onPress={() => setMasterKeyData(null)}
                >
                  <CustomText style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>{t('btnCloseUpper')}</CustomText>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={{ flex: 1, backgroundColor: theme.accent, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 4 }} 
                  onPress={async () => {
                    await ClipboardExpo.setStringAsync(masterKeyData);
                    toast.showToast(t('toastRecoveryKeyCopied'));
                  }}
                >
                  <CustomText style={{ color: theme.bg, fontSize: 12, fontWeight: '600' }}>{t('btnCopyUpper')}</CustomText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <AlertProvider>
            <AppInner />
          </AlertProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

const getStyles = (theme) => StyleSheet.create({
  overlay: {
    paddingBottom: 40,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  syncTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 20,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  progressBox: {
    backgroundColor: theme.card,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  progressText: {
    fontSize: 14,
    color: theme.text,
    marginBottom: 8,
  },
  progressPercent: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.accent,
  },
  cancelBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  }
});

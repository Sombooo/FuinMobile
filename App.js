import CustomTextInput from './src/components/CustomTextInput';
import CustomText from './src/components/CustomText';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, AppState, TextInput } from 'react-native';
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

import LockScreen from './src/screens/LockScreen';
import VaultScreen from './src/screens/VaultScreen';
import SuccessScreen from './src/screens/SuccessScreen';
import { ToastProvider, useToast } from './src/components/Toast';
import { LanguageProvider, useI18n } from './src/i18n';
import { AlertProvider, useAlert } from './src/components/CustomAlert';
import { useShareIntent } from 'expo-share-intent';
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
  const lockApp = () => {
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
    setMode('lock');
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
    ScreenCapture.preventScreenCaptureAsync().catch(console.warn);
  }, []);

  useEffect(() => {
    if (hasShareIntent && shareIntent.value) {
      const text = shareIntent.value;
      const isUrl = text.startsWith('http://') || text.startsWith('https://');
      const title = shareIntent.meta?.title || '';
      
      setSharedEntryData({
        site: title || (isUrl ? new URL(text).hostname.replace('www.', '') : 'Yeni Kayıt'),
        url: isUrl ? text : '',
        notes: isUrl ? '' : text,
        category: 'Diğer'
      });
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent]);

  // AppState & Background lock
  const appState = useRef(AppState.currentState);
  const backgroundTime = useRef(null);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    checkLocalVault();

    const subscription = AppState.addEventListener('change', async nextAppState => {
      setIsAppActive(nextAppState === 'active');
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        backgroundTime.current = Date.now();
      } else if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (backgroundTime.current) {
          const elapsed = Date.now() - backgroundTime.current;
          try {
            const timeoutStr = await SecureStore.getItemAsync('fuin-bg-timeout');
            const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 60000; // default 1 min
            if (timeout > 0 && elapsed > timeout) {
              lockApp();
            }
          } catch (e) {}
        }
        
        // Also clear clipboard if it's older than 45 seconds when returning to app
        try {
          const copyTimeStr = await SecureStore.getItemAsync('fuin-clipboard-time');
          if (copyTimeStr) {
            const copyTime = parseInt(copyTimeStr, 10);
            if (Date.now() - copyTime > 45000) {
              await ClipboardExpo.setStringAsync('');
              await SecureStore.deleteItemAsync('fuin-clipboard-time');
            }
          }
        } catch (e) {}

        backgroundTime.current = null;
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const checkLocalVault = async () => {
    const data = await loadVault();
    setHasLocalVault(!!data);
  };

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
      
      setPassword(pw);
      setVaultData(decryptedJson);
      setMode('vault');
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

  const handleSyncButton = () => {
    setSyncSourceMode(mode);
    setSyncPassword('');
    setSyncPasswordPrompt(false);
    setPendingV2Transfer(null);
    setPendingPayload(null);
    setMasterPasswordPrompt(false);
    setImportMasterPassword('');
    setImportConfirmPassword('');
    setChunkAssembler(new ChunkAssembler());
    setChunks({});
    setTotalChunks(0);
    setIsDecrypting(false);
    setMode('sync');
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (isDecrypting || syncPasswordPrompt || masterPasswordPrompt) return;
    
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
      setSyncPasswordPrompt(true);
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

  const processV2Transfer = async (envelope, sessionIdHex, syncPw) => {
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
        Alert.alert(
          t('alertWarning'),
          'Bu cihazda yapılan değişiklikler, yeni Desktop snapshot\'ı kabul edilirse üzerine yazılacaktır. Devam edilsin mi?',
          [
            { 
              text: t('btnCancel'), 
              style: 'cancel', 
              onPress: () => { 
                setIsDecrypting(false); 
                setPendingV2Transfer(null);
                setPendingPayload(null);
                setChunkAssembler(null); 
                setChunks({}); 
                lockApp();
              } 
            },
            { text: t('btnOk'), onPress: proceedToSaveOrMasterPassword }
          ]
        );
      } else {
        proceedToSaveOrMasterPassword();
      }

    } catch (e) {
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
      const finalVault = {
        type: 'fuin/vault',
        categories: [],
        entries: payload.entries
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
      const localEncrypted = await encryptLocalVault(newVaultDataString, password);
      await saveVault(localEncrypted);
      await saveVaultBackup(localEncrypted);
      await setHasLocalEdits(true);
      setVaultData(newVaultDataString);
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
        sharedEntryData={sharedEntryData}
        setSharedEntryData={setSharedEntryData}
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
            onPress={() => lockApp()}
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
            onPress={() => lockApp()}
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
          <CustomText style={styles.syncTitle}>{t('syncTitle')}</CustomText>
          <View style={styles.progressBox}>
            <CustomText style={styles.progressText}>
              {isDecrypting ? t('syncEncrypting') : `${t('syncChunksCollected')}${Object.keys(chunks).length} / ${totalChunks || '?'}`}
            </CustomText>
            <CustomText style={styles.progressPercent}>{progress}%</CustomText>
          </View>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => lockApp()}>
            <CustomText style={styles.cancelText}>{t('btnCancel')}</CustomText>
          </TouchableOpacity>
        </View>
      </View>
    );
    }
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1 }}>
        {content}
        
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
    paddingHorizontal: 30,
    borderRadius: 20,
  },
  cancelText: {
    color: '#fff',
    fontWeight: '600',
  }
});

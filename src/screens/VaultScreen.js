import CustomTextInput from '../components/CustomTextInput';
import CustomText from '../components/CustomText';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, SafeAreaView, StatusBar, Alert, Platform, ScrollView, TextInput, Switch, Modal, KeyboardAvoidingView, LayoutAnimation, Animated, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useTheme } from '../theme';
import Svg, { Polygon, Path, Circle, Rect, Polyline, Line } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import EditModal from './EditModal';
import HealthModal from './HealthModal';
import WhatsNewModal from './WhatsNewModal';
import BackupHistoryModal from './BackupHistoryModal';
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { getVaultBackups } from '../storage';

import { Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';
import { copySecure } from '../clipboardManager';
import FuinImporters from '../services/importers';
import TotpEngine from '../services/totpEngine';
import quickCrypto from 'react-native-quick-crypto';
import { Buffer as RNBuffer } from '@craftzdog/react-native-buffer';
import { encryptFuinBackupEnvelope, decryptFuinBackup, extractFuinBackupEnvelope } from '../crypto';
import VaultCardItem from '../components/VaultCardItem';
import useVaultSearch from '../hooks/useVaultSearch';
import useAppUpdater from '../hooks/useAppUpdater';
import { memDecrypt, unprotectEntries } from '../services/sessionSecurity';
import { hasStoredRecoveryKey } from '../services/recoveryService';
import { autofillService } from '../services/autofillService';

TotpEngine.setCryptoProvider(quickCrypto, RNBuffer);

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function decodeImportedBase64Buffer(b64) {
  const buf = RNBuffer.from(b64, 'base64');
  if (!buf || buf.length === 0) return '';
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = RNBuffer.from(buf.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
    }
    return swapped.toString('utf16le');
  }
  const sampleLen = Math.min(buf.length - (buf.length % 2), 64);
  if (sampleLen >= 4) {
    let oddZero = 0;
    let evenZero = 0;
    for (let i = 0; i < sampleLen; i += 2) {
      if (buf[i] === 0) evenZero++;
      if (buf[i + 1] === 0) oddZero++;
    }
    if (oddZero > sampleLen / 4 && evenZero === 0) {
      return buf.toString('utf16le');
    }
  }
  const utf8Str = buf.toString('utf8');
  if (utf8Str.includes('\uFFFD')) {
    return buf.toString('latin1');
  }
  return utf8Str;
}

export default function VaultScreen({ 
  vaultData, 
  password, 
  onLogout, 
  onSyncRequest, 
  onOpenScanner,
  onOpenTotpScanner,
  onPerformLanSync,
  onUpdateVaultData, 
  sharedEntryData, 
  setSharedEntryData,
  lanPairingVersion,
  onPairingUpdated,
  onRegenerateRecoveryKey,
  onChangeMasterPassword,
  recoveryKeyVersion
}) {
  const { t, lang, setLang } = useI18n();
  const { showAlert } = useAlert();
  const updater = useAppUpdater({ t, showAlert });
  
  const insets = useSafeAreaInsets();
  const { theme, themeMode, changeTheme } = useTheme();
  const isLight = theme.bg === '#f5f0e8';
  const styles = useMemo(() => getStyles(theme), [theme]);

  const [activeTab, setActiveTab] = useState('vault'); 

  const {
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    parsedVault,
    DEFAULT_CATEGORIES,
    allCategories,
    entries,
    filteredEntries
  } = useVaultSearch({ vaultData, t });

  const switchTabSmooth = (nextTab) => {
    if (activeTab === nextTab) return;
    setActiveTab(nextTab);
  };

  const switchCategorySmooth = (nextCat) => {
    if (activeCategory === nextCat) return;
    setActiveCategory(nextCat);
  };

  const editableCategories = useMemo(() => {
    return allCategories.filter(c =>
      c !== t('cat_all') &&
      c !== t('navLogins') &&
      c !== t('navCards') &&
      c !== t('navNotes') &&
      c !== t('cat_fav') &&
      c !== t('cat_trash')
    );
  }, [allCategories, t]);
  
  // Edit State
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [healthModalVisible, setHealthModalVisible] = useState(false);
  const [whatsNewModalVisible, setWhatsNewModalVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [backups, setBackups] = useState([]);

  // Live 2FA (TOTP) Modal State
  const [totpModalSite, setTotpModalSite] = useState(null);
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpState, setTotpState] = useState({
    token: '------',
    formattedToken: '--- ---',
    secondsRemaining: 30,
    progressPercent: 100,
    valid: false,
    error: null,
  });

  // Encrypted .fuin Backup Password Prompt State
  const [encBackupRaw, setEncBackupRaw] = useState(null);
  const [encBackupPw, setEncBackupPw] = useState('');
  const [encBackupBusy, setEncBackupBusy] = useState(false);

  // Show password state
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [bgTimeout, setBgTimeout] = useState('60000');
  const [showCryptoDetails, setShowCryptoDetails] = useState(false);

  // Change Master Password Modal State
  const [changePwModalVisible, setChangePwModalVisible] = useState(false);
  const [curMasterPw, setCurMasterPw] = useState('');
  const [newMasterPw, setNewMasterPw] = useState('');
  const [confirmMasterPw, setConfirmMasterPw] = useState('');
  const [showCurMasterPw, setShowCurMasterPw] = useState(false);
  const [showNewMasterPw, setShowNewMasterPw] = useState(false);
  const [showConfirmMasterPw, setShowConfirmMasterPw] = useState(false);
  const [changePwError, setChangePwError] = useState('');
  const [changePwBusy, setChangePwBusy] = useState(false);

  // Master Password Reprompt Modal State (fallback when biometrics are unavailable/unenrolled)
  const [repromptModalVisible, setRepromptModalVisible] = useState(false);
  const [repromptPwInput, setRepromptPwInput] = useState('');
  const [showRepromptPw, setShowRepromptPw] = useState(false);
  const [repromptError, setRepromptError] = useState('');
  const repromptResolverRef = useRef(null);

  // Sync & Pairing State
  const [syncMode, setSyncMode] = useState('lan');
  const [pairingInfo, setPairingInfo] = useState(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [autofillSupported, setAutofillSupported] = useState(false);
  const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
  const [recoveryKeyBusy, setRecoveryKeyBusy] = useState(false);

  const resetChangePwForm = useCallback(() => {
    setCurMasterPw('');
    setNewMasterPw('');
    setConfirmMasterPw('');
    setShowCurMasterPw(false);
    setShowNewMasterPw(false);
    setShowConfirmMasterPw(false);
    setChangePwError('');
  }, []);

  const openChangePwModal = useCallback(() => {
    resetChangePwForm();
    setChangePwModalVisible(true);
  }, [resetChangePwForm]);

  const closeChangePwModal = useCallback(() => {
    if (changePwBusy) return;
    setChangePwModalVisible(false);
    resetChangePwForm();
  }, [changePwBusy, resetChangePwForm]);

  const handleSubmitChangePw = useCallback(async () => {
    if (changePwBusy || !onChangeMasterPassword) return;
    setChangePwError('');

    if (!curMasterPw) {
      setChangePwError(t('changePwWrongCurrent'));
      return;
    }
    if (!newMasterPw || newMasterPw.length < 8) {
      setChangePwError(t('toastMin8Chars'));
      return;
    }
    if (newMasterPw.length > 128) {
      setChangePwError(t('changePwMax128Chars'));
      return;
    }
    if (newMasterPw !== confirmMasterPw) {
      setChangePwError(t('changePwMismatch'));
      return;
    }
    if (newMasterPw === curMasterPw) {
      setChangePwError(t('changePwSameAsOld'));
      return;
    }

    setChangePwBusy(true);
    try {
      const res = await onChangeMasterPassword(curMasterPw, newMasterPw);
      if (res && res.ok) {
        setChangePwModalVisible(false);
        resetChangePwForm();
        SecureStore.getItemAsync('fuin-biometric-enabled')
          .then((val) => setBiometricEnabled(val === 'true'))
          .catch(() => {});
      } else {
        setChangePwError((res && res.error) || t('changePwFailed'));
      }
    } catch {
      setChangePwError(t('changePwFailed'));
    } finally {
      setChangePwBusy(false);
    }
  }, [
    changePwBusy,
    onChangeMasterPassword,
    curMasterPw,
    newMasterPw,
    confirmMasterPw,
    resetChangePwForm,
    t,
  ]);

  const handleOpenBackupHistory = useCallback(async () => {
    const blist = await getVaultBackups();
    setBackups(blist);
    setBackupModalVisible(true);
  }, []);

  useEffect(() => {
    let active = true;
    if (activeTab === 'settings') {
      hasStoredRecoveryKey()
        .then((exists) => {
          if (active) setHasRecoveryKey(Boolean(exists));
        })
        .catch(() => {
          if (active) setHasRecoveryKey(false);
        });
    }
    return () => {
      active = false;
    };
  }, [activeTab, recoveryKeyVersion]);

  const handleRegenerateRecoveryKeyPress = useCallback(() => {
    if (recoveryKeyBusy || !onRegenerateRecoveryKey) return;
    showAlert(
      t('recoveryKeyCardTitle'),
      hasRecoveryKey ? t('recoveryKeyRegenerateConfirm') : t('recoveryKeyCreateConfirm'),
      [
        { text: t('btnCancel'), style: 'cancel' },
        {
          text: hasRecoveryKey ? t('recoveryKeyRegenerateAction') : t('recoveryKeyCreateAction'),
          style: 'primary',
          onPress: async () => {
            setRecoveryKeyBusy(true);
            try {
              const ok = await onRegenerateRecoveryKey();
              if (ok) {
                setHasRecoveryKey(true);
              }
            } finally {
              setRecoveryKeyBusy(false);
            }
          },
        },
      ]
    );
  }, [recoveryKeyBusy, onRegenerateRecoveryKey, hasRecoveryKey, showAlert, t]);

  useEffect(() => {
    const checkAutofill = async () => {
      const supported = autofillService.isSupported();
      setAutofillSupported(supported);
      if (supported) {
        const enabled = await autofillService.isEnabled();
        setAutofillEnabled(enabled);
      }
    };
    if (activeTab === 'settings') {
      checkAutofill();
    }
  }, [activeTab]);

  const loadPairingAndSyncSettings = async () => {
    try {
      await SecureStore.setItemAsync('fuin_sync_mode', 'lan').catch(() => {});
      setSyncMode('lan');
      const { getPairingInfo } = require('../sync-lan-mobile');
      const info = await getPairingInfo();
      setPairingInfo(info);
    } catch (e) {
      console.warn('loadPairingAndSyncSettings error:', e);
    }
  };

  useEffect(() => {
    loadPairingAndSyncSettings();
  }, [activeTab, lanPairingVersion]);

  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const lastSeen = await AsyncStorage.getItem('fuin_last_seen_changelog');
        const curVer = updater.currentVersion || '1.0.0-beta.12';
        const { isNewerVersion } = require('../services/updateCore');
        if (!lastSeen || isNewerVersion(curVer, lastSeen)) {
          setTimeout(() => {
            setWhatsNewModalVisible(true);
          }, 600);
        }
      } catch {}
    })();
  }, []);

  const handleSetSyncMode = async () => {
    setSyncMode('lan');
    try {
      await SecureStore.setItemAsync('fuin_sync_mode', 'lan');
    } catch (e) {
      console.warn('handleSetSyncMode error:', e);
    }
  };

  const handleUnpairPress = () => {
    showAlert(
      t('alertUnpairTitle'),
      t('alertUnpairConfirm'),
      [
        { text: t('btnCancel'), style: 'cancel' },
        {
          text: t('btnUnpairAction'),
          style: 'destructive',
          onPress: async () => {
            const { clearPairingInfo } = require('../sync-lan-mobile');
            await clearPairingInfo();
            setPairingInfo(null);
            if (onPairingUpdated) onPairingUpdated();
            showAlert(t('alertSuccess'), t('toastDeviceUnpaired'));
          }
        }
      ]
    );
  };

  const handlePairDesktopPress = () => {
    if (onOpenScanner) {
      onOpenScanner('pair');
    } else if (onSyncRequest) {
      onSyncRequest();
    }
  };

  const handleLanSyncPress = () => {
    if (onPerformLanSync) {
      onPerformLanSync();
    } else if (onSyncRequest) {
      onSyncRequest();
    }
  };

  useEffect(() => {
    SecureStore.getItemAsync('fuin-biometric-enabled').then(val => {
      setBiometricEnabled(val === 'true');
    }).catch(() => {});
    SecureStore.getItemAsync('fuin-bg-timeout').then(val => {
      if (val) setBgTimeout(val);
    }).catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (sharedEntryData) {
      setSelectedEntry({
        id: Date.now().toString(),
        site: sharedEntryData.site || '',
        category: sharedEntryData.category || 'Diğer',
        username: sharedEntryData.username || '',
        password: sharedEntryData.password || '',
        url: sharedEntryData.url || '',
        notes: sharedEntryData.notes || '',
        isNew: true
      });
      setModalVisible(true);
      
      if (setSharedEntryData) {
        setSharedEntryData(null);
      }
    }
  }, [sharedEntryData]);


  useEffect(() => {
    return () => {
      setSelectedEntry(null);
      setTotpSecret(null);
      setEncBackupRaw(null);
      setEncBackupPw('');
      setCurMasterPw('');
      setNewMasterPw('');
      setConfirmMasterPw('');
      setChangePwError('');
    };
  }, []);

  useEffect(() => {
    if (!totpSecret) return undefined;
    const ticker = TotpEngine.startTOTPTicker(totpSecret, (res) => {
      setTotpState(res);
    }, { intervalMs: 500 });
    return () => {
      ticker.stop();
    };
  }, [totpSecret]);

  const toggleBiometric = async () => {
    const newVal = !biometricEnabled;
    if (newVal) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const canBioStore = typeof SecureStore.canUseBiometricAuthentication === 'function'
        ? SecureStore.canUseBiometricAuthentication()
        : true;
      if (!hasHardware || !isEnrolled || !canBioStore) {
        showAlert(t('alertError'), t('bioNotSupportedOrEnrolled'));
        return;
      }

      try {
        if (Platform.OS === 'android' && password) {
          // On Android, SecureStore.setItemAsync({ requireAuthentication: true }) invokes BiometricPrompt directly;
          // calling LocalAuthentication.authenticateAsync beforehand causes a duplicate prompt.
          await SecureStore.setItemAsync('fuin-biometric-key', password, {
            requireAuthentication: true,
            authenticationPrompt: t('bioEnablePrompt'),
          });
        } else {
          const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: t('bioEnablePrompt')
          });
          if (!auth.success) return;
          if (password) {
            await SecureStore.setItemAsync('fuin-biometric-key', password, {
              requireAuthentication: true,
              authenticationPrompt: t('bioPromptLogin'),
            });
          }
        }

        await SecureStore.setItemAsync('fuin-biometric-enabled', 'true');
        setBiometricEnabled(true);
        showAlert(t('alertSuccess'), t('bioEnabledSuccess'));
      } catch {
        // User canceled or biometric Keystore authentication failed; leave disabled cleanly
      }
    } else {
      await SecureStore.setItemAsync('fuin-biometric-enabled', 'false');
      await SecureStore.deleteItemAsync('fuin-biometric-key');
      setBiometricEnabled(false);
    }
  };


  const verifySessionMasterPassword = useCallback((candidate) => {
    if (typeof candidate !== 'string' || !candidate || typeof password !== 'string' || !password) {
      return false;
    }
    let candHash = null;
    let activeHash = null;
    try {
      candHash = quickCrypto.createHash('sha256').update(candidate, 'utf8').digest();
      activeHash = quickCrypto.createHash('sha256').update(password, 'utf8').digest();
      return (
        candHash.length === activeHash.length &&
        quickCrypto.timingSafeEqual(candHash, activeHash)
      );
    } catch {
      return false;
    } finally {
      try { if (candHash) candHash.fill(0); } catch {}
      try { if (activeHash) activeHash.fill(0); } catch {}
    }
  }, [password]);

  const closeRepromptModal = useCallback((verified = false) => {
    setRepromptModalVisible(false);
    setRepromptPwInput('');
    setShowRepromptPw(false);
    setRepromptError('');
    const resolver = repromptResolverRef.current;
    repromptResolverRef.current = null;
    if (typeof resolver === 'function') {
      resolver(Boolean(verified));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typeof repromptResolverRef.current === 'function') {
        const resolver = repromptResolverRef.current;
        repromptResolverRef.current = null;
        resolver(false);
      }
    };
  }, []);

  const requestMasterPasswordReprompt = useCallback(() => {
    if (typeof password !== 'string' || !password) {
      return Promise.resolve(false);
    }
    if (typeof repromptResolverRef.current === 'function') {
      const prevResolver = repromptResolverRef.current;
      repromptResolverRef.current = null;
      prevResolver(false);
    }
    setRepromptPwInput('');
    setShowRepromptPw(false);
    setRepromptError('');
    setRepromptModalVisible(true);
    return new Promise((resolve) => {
      repromptResolverRef.current = resolve;
    });
  }, [password]);

  const handleSubmitRepromptPw = useCallback(() => {
    if (!repromptPwInput) {
      setRepromptError(t('toastEnterPassword'));
      return;
    }
    if (verifySessionMasterPassword(repromptPwInput)) {
      closeRepromptModal(true);
    } else {
      setRepromptPwInput('');
      setRepromptError(t('repromptWrongPassword'));
    }
  }, [repromptPwInput, verifySessionMasterPassword, closeRepromptModal, t]);

  const verifyReprompt = useCallback(async (entry) => {
    if (!entry || !entry.reprompt) return true;
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHw && isEnrolled) {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: t('repromptBioPrompt')
        });
        return Boolean(res && res.success);
      }
      return await requestMasterPasswordReprompt();
    } catch (err) {
      console.error('Reprompt auth error:', err);
      return false;
    }
  }, [t, requestMasterPasswordReprompt]);

  const handleCopy = useCallback(async (val, label, entry, customDuration) => {
    const isSecret = label === t('fieldPassword') ||
                     label === t('fieldCardNumber') ||
                     label === t('fieldCardCvv') ||
                     label === t('fieldCardPin') ||
                     label === t('fieldNote') ||
                     label === t('typeNote') ||
                     label === t('fieldSecureNoteContent');
    if (isSecret && entry && entry.reprompt) {
      const ok = await verifyReprompt(entry);
      if (!ok) return;
    }
    const textToCopy = typeof val === 'object' && val !== null ? memDecrypt(val) : String(val || '');
    const duration = customDuration || (label === t('fieldCardCvv') || label === t('fieldCardPin') ? 20000 : (label === t('fieldPassword') || label === t('fieldNote') || label === t('fieldSecureNoteContent') ? 45000 : 30000));
    await copySecure(textToCopy, duration, { isSensitive: true });
    let msg = label + t('toastCopiedClipboard30s');
    if (label === t('fieldPassword')) {
      msg = t('toastCopiedClipboard45s');
    } else if (label === t('fieldCardNumber')) {
      msg = t('toastCardCopied');
    } else if (label === t('fieldCardCvv')) {
      msg = t('toastCvvCopied');
    } else if (label === t('fieldCardPin')) {
      msg = t('toastPinCopied');
    } else if (label === t('fieldNote') || label === t('fieldSecureNoteContent')) {
      msg = t('toastNoteCopied');
    }
    showAlert(t('alertCopied'), msg);
  }, [t, showAlert, verifyReprompt]);

  const togglePasswordVisibility = useCallback(async (entryOrId) => {
    const isObj = typeof entryOrId === 'object' && entryOrId !== null;
    const id = isObj ? entryOrId.id : entryOrId;
    const entry = isObj ? entryOrId : entries.find(e => e.id === id);
    if (!visiblePasswords[id] && entry && entry.reprompt) {
      const ok = await verifyReprompt(entry);
      if (!ok) return;
    }
    setVisiblePasswords(prev => {
      const nextState = !prev[id];
      if (nextState) {
        setTimeout(() => {
          setVisiblePasswords(p => ({ ...p, [id]: false }));
        }, 3000);
      }
      return {
        ...prev,
        [id]: nextState
      };
    });
  }, [visiblePasswords, entries, verifyReprompt]);

  const handleSaveEntry = async (updatedEntry) => {
    const newEntries = [...entries];
    const index = newEntries.findIndex(e => e.id === updatedEntry.id);
    const isEdit = index >= 0;
    if (isEdit) {
      newEntries[index] = updatedEntry;
    } else {
      newEntries.push(updatedEntry);
    }

    const payload = JSON.stringify({ type: 'fuin/vault', categories: [], entries: newEntries });
    const success = await onUpdateVaultData(payload);
    if (success) {
      setModalVisible(false);
      let saveMsg = t('alertSaved');
      if (!isEdit) {
        if (updatedEntry.type === 'card') saveMsg = t('toastCardSaved');
        else if (updatedEntry.type === 'note') saveMsg = t('toastNoteSaved');
      }
      showAlert(t('alertSuccess'), saveMsg);
    }
  };

  const handleDeleteEntry = async (id) => {
    let newEntries = [...entries];
    const index = newEntries.findIndex(e => e.id === id);
    if (index >= 0) {
      if (newEntries[index].isDeleted) {
        newEntries = newEntries.filter(e => e.id !== id);
      } else {
        const now = Date.now();
        newEntries[index] = {
          ...newEntries[index],
          isDeleted: true,
          deletedAt: now,
          updated: now,
          updatedAt: now
        };
      }
    }
    const payload = JSON.stringify({ type: 'fuin/vault', categories: [], entries: newEntries });
    const success = await onUpdateVaultData(payload);
    if (success) {
      setModalVisible(false);
    }
  };

  const handleRestoreEntry = async (id) => {
    let newEntries = [...entries];
    const index = newEntries.findIndex(e => e.id === id);
    if (index >= 0) {
      const now = Date.now();
      newEntries[index] = {
        ...newEntries[index],
        isDeleted: false,
        deletedAt: null,
        updated: now,
        updatedAt: now
      };
    }
    const payload = JSON.stringify({ type: 'fuin/vault', categories: [], entries: newEntries });
    const success = await onUpdateVaultData(payload);
    if (success) {
      setModalVisible(false);
    }
  };

  const openAddModal = useCallback(() => {
    setSelectedEntry(null);
    setModalVisible(true);
  }, []);

  const openEditModal = useCallback(async (entry) => {
    if (entry && entry.reprompt) {
      const ok = await verifyReprompt(entry);
      if (!ok) return;
    }
    setSelectedEntry(entry);
    setModalVisible(true);
  }, [verifyReprompt]);

  const closeTotpModal = useCallback(() => {
    setTotpSecret(null);
    setTotpModalSite(null);
  }, []);

  const handleOpenTotp = useCallback(async (entry) => {
    if (!entry || !entry.totp) return;
    if (entry.reprompt) {
      const ok = await verifyReprompt(entry);
      if (!ok) return;
    }
    const rawSecret = typeof entry.totp === 'object' ? memDecrypt(entry.totp) : String(entry.totp || '');
    if (!rawSecret.trim()) return;
    setTotpModalSite(entry.site || entry.title || '2FA');
    setTotpSecret(rawSecret);
  }, [verifyReprompt]);

  const handleCopyTotpCode = useCallback(async () => {
    if (!totpState.valid || !totpState.token || totpState.token.includes('-')) return;
    await copySecure(totpState.token, 30000, { isSensitive: true });
    showAlert(t('alertCopied'), t('toastTotpCopied'));
  }, [totpState, showAlert, t]);

  const saveExportFile = useCallback(async ({ content, fileName, mimeType, uti, dialogTitle, successMsg, failPrefix }) => {
    try {
      const { StorageAccessFramework } = FileSystem;
      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const fileUri = await StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, mimeType);
          await FileSystem.writeAsStringAsync(fileUri, content, { encoding: 'utf8' });
          showAlert(t('alertSuccess'), successMsg);
        }
      } else {
        const fileUri = FileSystem.cacheDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, content, { encoding: 'utf8' });
        try {
          await Sharing.shareAsync(fileUri, { UTI: uti, dialogTitle });
        } finally {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        }
      }
    } catch (e) {
      showAlert(t('alertError'), failPrefix + (e?.message || t('toastGenericError')));
    }
  }, [showAlert, t]);

  const readPickedFileText = useCallback(async (asset) => {
    const uri = asset?.uri;
    if (!uri) throw new Error(t('ioFileReadError'));
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const byteSize = asset?.size || info?.size || 0;
      if (byteSize > MAX_IMPORT_BYTES) {
        throw new Error(t('ioFileTooLarge'));
      }
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      return decodeImportedBase64Buffer(b64);
    } finally {
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
    }
  }, [t]);

  const applyImportedVaultEntries = useCallback(async (res, { formatType, successMsg }) => {
    const newEntries = [...unprotectEntries(entries), ...res.entries];
    const newCategories = Array.from(new Set([...(parsedVault.categories || DEFAULT_CATEGORIES), ...(res.categories || [])]));
    const success = await onUpdateVaultData(JSON.stringify({ type: 'fuin/vault', categories: newCategories, entries: newEntries }));
    if (success) showAlert(t('alertSuccess'), successMsg);
    return success;
  }, [entries, parsedVault, DEFAULT_CATEGORIES, onUpdateVaultData, showAlert, t]);

  const handleOpenUrl = useCallback(async (rawUrl) => {
    try {
      let urlToOpen = String(rawUrl || '').trim();
      if (!urlToOpen) return;

      // Reject non-web URI schemes (javascript:, intent:, file:, content:, fuin:, androidapp:)
      if (/^[a-z][a-z0-9+.-]*:/i.test(urlToOpen) && !/^https?:\/\//i.test(urlToOpen)) {
        showAlert(t('alertError'), t('invalidUrlError'));
        return;
      }

      if (!/^https?:\/\//i.test(urlToOpen)) {
        urlToOpen = 'https://' + urlToOpen;
      }

      const parsed = new URL(urlToOpen);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
        showAlert(t('alertError'), t('invalidUrlError'));
        return;
      }

      const supported = await Linking.canOpenURL(parsed.href);
      if (supported) {
        await Linking.openURL(parsed.href);
      } else {
        showAlert(t('alertError'), t('invalidUrlError'));
      }
    } catch (error) {
      console.error('URL open error:', error);
      showAlert(t('alertError'), t('invalidUrlError'));
    }
  }, [t, showAlert]);

  const renderItem = useCallback(({ item }) => (
    <VaultCardItem
      item={item}
      isPwVisible={Boolean(visiblePasswords[item.id])}
      onTogglePw={togglePasswordVisibility}
      onCopy={handleCopy}
      onOpenEdit={openEditModal}
      onOpenUrl={handleOpenUrl}
      onOpenTotp={handleOpenTotp}
      theme={theme}
      styles={styles}
      t={t}
    />
  ), [visiblePasswords, togglePasswordVisibility, handleCopy, openEditModal, handleOpenUrl, handleOpenTotp, theme, styles, t]);

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={isLight ? 'dark-content' : 'light-content'} />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Svg width="24" height="24" viewBox="0 0 38 38" fill="none">
            <Polygon points="19,2 35,10.5 35,27.5 19,36 3,27.5 3,10.5" stroke={theme.text} strokeWidth="1.5" fill="none" />
          </Svg>
          <CustomText style={styles.headerTitle}>
            {activeTab === 'vault' ? t('navVault') : (activeTab === 'settings' ? t('navSettings') : t('navTools'))}
          </CustomText>
        </View>
        <TouchableOpacity onPress={onLogout} activeOpacity={0.7} delayPressIn={0}>
          <CustomText style={styles.logoutText}>{t('btnLogout')}</CustomText>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {activeTab === 'vault' ? (
          <>
            {/* Categories Scroll */}
            <View style={styles.categoriesWrapper}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={styles.categoriesScroll}
                keyboardShouldPersistTaps="handled"
              >
                {allCategories.map(cat => (
                  <TouchableOpacity 
                    key={cat} 
                    style={[styles.categoryBtn, activeCategory === cat && styles.categoryBtnActive]}
                    onPress={() => switchCategorySmooth(cat)}
                    activeOpacity={0.7}
                    delayPressIn={0}
                  >
                    <CustomText style={[styles.categoryText, activeCategory === cat && styles.categoryTextActive]}>
                      {cat}
                    </CustomText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Search Bar */}
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: theme.paper }}>
              <CustomTextInput
                style={{ backgroundColor: theme.bg, color: theme.text, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
                placeholder={t('searchPlaceholderVault')}
                placeholderTextColor={theme.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                clearButtonMode="while-editing"
              />
            </View>

            {/* In-App Update Notification Banner */}
            {updater.showBanner && updater.updateInfo ? (
              <View style={{
                marginHorizontal: 16,
                marginTop: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: theme.accent,
                backgroundColor: 'rgba(90, 154, 110, 0.14)',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>
                      {t('updateBannerTitle').replace('{version}', updater.updateInfo.version)}
                    </CustomText>
                    {(updater.downloading || updater.verifying) ? (
                      <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>
                        {updater.verifying
                          ? t('updateVerifying')
                          : t('updateDownloading').replace('{percent}', String(updater.progress.percent))}
                      </CustomText>
                    ) : null}
                  </View>

                  {!(updater.downloading || updater.verifying) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        delayPressIn={0}
                        style={{ backgroundColor: theme.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 }}
                        onPress={updater.startUpdateDownload}
                      >
                        <CustomText style={{ color: theme.bg, fontSize: 12, fontWeight: 'bold' }}>
                          {t('updateBtnInstallNow')}
                        </CustomText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        delayPressIn={0}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        onPress={updater.dismissBanner}
                      >
                        <Feather name="x" size={16} color={theme.muted} />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {(updater.downloading || updater.verifying) ? (
                  <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                    <View style={{ width: `${updater.verifying ? 100 : updater.progress.percent}%`, height: '100%', backgroundColor: theme.accent }} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* List */}
            <FlatList
              data={filteredEntries}
              keyExtractor={(item, index) => item.id || String(index)}
              renderItem={renderItem}
              contentContainerStyle={styles.listContainer}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={5}
              updateCellsBatchingPeriod={50}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <CustomText style={styles.emptyText}>{t('emptyCategoryResults')}</CustomText>
                </View>
              }
            />

            {/* Floating Action Button */}
            <TouchableOpacity 
              style={styles.fab} 
              onPress={openAddModal}
              activeOpacity={0.7}
              delayPressIn={0}
            >
              <CustomText style={styles.fabText}>+</CustomText>
            </TouchableOpacity>
          </>
        ) : null}
        
        {activeTab === 'tools' && (
          <ScrollView style={styles.settingsWrap} keyboardShouldPersistTaps="handled">

            
            {/* Old JSON block removed */}

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('ioTitle')}</CustomText>
            
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                const jsonStr = JSON.stringify({ ...parsedVault, entries: unprotectEntries(entries) }, null, 2);
                await saveExportFile({
                  content: jsonStr,
                  fileName: 'fuin-yedek.json',
                  mimeType: 'application/json',
                  uti: 'public.json',
                  dialogTitle: t('ioExportJsonTitle'),
                  successMsg: t('toastJsonExported'),
                  failPrefix: t('ioExportJsonFailed'),
                });
              }}>
                <Feather name="download" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioExportJsonBtn')}</CustomText>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center', paddingVertical: 14 }]} onPress={async () => {
                let csv = 'name,url,username,password,notes,category,totp\n';
                unprotectEntries(entries).forEach(e => {
                  const row = [e.site, e.url, e.username, e.password, e.note, e.category, e.totp]
                    .map(v => `"${(v||'').replace(/"/g, '""')}"`).join(',');
                  csv += row + '\n';
                });
                await saveExportFile({
                  content: csv,
                  fileName: 'fuin-yedek.csv',
                  mimeType: 'text/csv',
                  uti: 'public.comma-separated-values-text',
                  dialogTitle: t('ioExportCsvTitle'),
                  successMsg: t('toastCsvExported'),
                  failPrefix: t('ioExportCsvFailed'),
                });
              }}>
                <Feather name="file-text" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioExportCsvBtn')}</CustomText>
              </TouchableOpacity>
            </View>

            <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
                  if (result.canceled === false && result.assets && result.assets.length > 0) {
                    const content = await readPickedFileText(result.assets[0]);
                    const res = FuinImporters.importJSON(content, {
                      existingEntries: unprotectEntries(entries),
                      defaultCategory: 'Diğer'
                    });
                    if (res.entries.length === 0) {
                      showAlert(t('alertInfo'), res.skippedCount > 0 ? t('ioAllDuplicatesOrSkipped') : t('ioInvalidJsonError'));
                      return;
                    }
                    await applyImportedVaultEntries(res, {
                      formatType: 'json',
                      successMsg: `${res.entries.length}${t('ioItemsImportedSuccess')}`,
                    });
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioImportFailed') + e.message);
                }
              }}>
                <Feather name="upload" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioImportJsonBtn')}</CustomText>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
                  if (result.canceled === false && result.assets && result.assets.length > 0) {
                    const content = await readPickedFileText(result.assets[0]);
                    const res = FuinImporters.importCSV(content, {
                      existingEntries: unprotectEntries(entries),
                      defaultCategory: 'Diğer'
                    });

                    if (res.format === 'unknown' && res.entries.length === 0) {
                      throw new Error(res.totalRows > 0 ? t('ioInvalidCsvColumns') : t('ioInvalidCsvEmpty'));
                    }
                    if (res.entries.length === 0) {
                      showAlert(
                        t('alertInfo'),
                        (res.totalRows > 0 || res.skippedCount > 0) ? t('ioAllDuplicatesOrSkipped') : t('ioInvalidCsvEmpty')
                      );
                      return;
                    }

                    await applyImportedVaultEntries(res, {
                      formatType: 'csv',
                      successMsg: `${res.entries.length}${t('ioItemsImportedCsvSuccess')}`,
                    });
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioImportFailed') + e.message);
                }
              }}>
                <Feather name="folder" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioImportCsvBtn')}</CustomText>
              </TouchableOpacity>
            </View>

            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20}}>
              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center', borderColor: 'rgba(90, 154, 110, 0.4)' }]} onPress={async () => {
                try {
                  const payload = JSON.stringify({
                    type: 'fuin/vault',
                    exportedAt: Date.now(),
                    categories: parsedVault.categories || DEFAULT_CATEGORIES,
                    entries: unprotectEntries(entries),
                  });
                  const envelope = await encryptFuinBackupEnvelope(payload, password);
                  const datePart = new Date().toISOString().slice(0, 10);
                  await saveExportFile({
                    content: envelope,
                    fileName: `fuin-kasa-${datePart}.fuin`,
                    mimeType: 'application/octet-stream',
                    uti: 'public.data',
                    dialogTitle: t('ioExportEncTitle'),
                    successMsg: t('toastEncBackupExported'),
                    failPrefix: t('ioExportEncFailed'),
                  });
                } catch (e) {
                  showAlert(t('alertError'), t('ioExportEncFailed') + (e?.message || t('toastGenericError')));
                }
              }}>
                <Feather name="shield" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold', textAlign: 'center'}}>{t('ioExportEncBtn')}</CustomText>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center', borderColor: 'rgba(90, 154, 110, 0.4)' }]} onPress={async () => {
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
                  if (result.canceled === false && result.assets && result.assets.length > 0) {
                    const content = await readPickedFileText(result.assets[0]);
                    const { ciphertext, kdf } = extractFuinBackupEnvelope(content);
                    try {
                      const plainJson = await decryptFuinBackup(ciphertext, password, kdf);
                      const res = FuinImporters.importJSON(plainJson, {
                        existingEntries: unprotectEntries(entries),
                        defaultCategory: 'Diğer',
                      });
                      if (res.entries.length === 0) {
                        showAlert(t('alertInfo'), res.skippedCount > 0 ? t('ioAllDuplicatesOrSkipped') : t('ioInvalidFuinFile'));
                        return;
                      }
                      await applyImportedVaultEntries(res, {
                        formatType: 'fuin',
                        successMsg: `${res.entries.length}${t('toastEncBackupRestored')}`,
                      });
                    } catch {
                      setEncBackupPw('');
                      setEncBackupRaw(content);
                    }
                  }
                } catch {
                  showAlert(t('alertError'), t('ioInvalidFuinFile'));
                }
              }}>
                <Feather name="lock" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold', textAlign: 'center'}}>{t('ioImportEncBtn')}</CustomText>
              </TouchableOpacity>
            </View>

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('secToolsTitle')}</CustomText>
            <TouchableOpacity style={styles.settingsCard} onPress={() => setHealthModalVisible(true)}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2}}>
                <Feather name="activity" size={16} color={theme.accent} />
                <CustomText style={{color: theme.text, fontSize: 14, fontWeight: 'bold'}}>{t('healthReportCardTitle')}</CustomText>
              </View>
              <CustomText style={{color: theme.muted, fontSize: 12, marginTop: 4}}>{t('healthReportCardSub')}</CustomText>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.settingsCard, { marginTop: 10 }]} activeOpacity={0.7} delayPressIn={0} onPress={handleOpenBackupHistory}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2}}>
                <Feather name="database" size={16} color={theme.accent} />
                <CustomText style={{color: theme.text, fontSize: 14, fontWeight: 'bold'}}>{t('backupsCardTitle')}</CustomText>
              </View>
              <CustomText style={{color: theme.muted, fontSize: 12, marginTop: 4}}>{t('backupsCardSub')}</CustomText>
            </TouchableOpacity>
            
            <View style={{height: 40}} />
          </ScrollView>
        )}

        {activeTab === 'settings' && (
          <ScrollView style={styles.settingsWrap} keyboardShouldPersistTaps="handled">
            {/* ── GROUP 1: VAULT & SECURITY ── */}
            <CustomText style={[styles.settingsGroupHeader, { marginTop: 4 }]}>
              {t('settingsGroupVaultSecurity')}
            </CustomText>

            {/* Biometric & Background Auto-Lock Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <CustomText style={[styles.settingsCardKicker, { marginBottom: 8 }]}>
                {t('bioSectionTitle')}
              </CustomText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <CustomText style={{ color: theme.text, fontSize: 14, fontWeight: 'bold' }}>
                    {t('bioFingerprintFaceId')}
                  </CustomText>
                  <CustomText style={{ color: theme.muted, fontSize: 12, marginTop: 4, lineHeight: 16 }}>
                    {t('bioNoPasswordSub')}
                  </CustomText>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={toggleBiometric}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.bg}
                />
              </View>

              <View style={styles.settingsDivider} />

              <CustomText style={[styles.settingsCardKicker, { marginBottom: 12 }]}>
                {t('autoLockTitle')}
              </CustomText>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { label: t('time1m'), value: '60000' },
                  { label: t('time2m'), value: '120000' },
                  { label: t('time5m'), value: '300000' },
                  { label: t('time15m'), value: '900000' }
                ].map(opt => {
                  const isActive = bgTimeout === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      activeOpacity={0.7}
                      delayPressIn={0}
                      style={[
                        styles.settingsPillBtn,
                        isActive && {
                          borderColor: theme.accent,
                          backgroundColor: isLight ? 'rgba(61,107,79,0.12)' : 'rgba(90,154,110,0.14)',
                        },
                      ]}
                      onPress={async () => {
                        await SecureStore.setItemAsync('fuin-bg-timeout', opt.value);
                        setBgTimeout(opt.value);
                        autofillService.syncVault(unprotectEntries(entries), parseInt(opt.value, 10)).catch(() => {});
                        showAlert(t('alertSaved'), t('autoLockSavedMsg').replace('{label}', opt.label));
                      }}
                    >
                      <CustomText style={{ color: isActive ? theme.accent : theme.text, fontSize: 12, fontWeight: 'bold' }}>
                        {opt.label}
                      </CustomText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Change Master Password Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Feather name="lock" size={16} color={theme.accent} />
                <CustomText style={{ color: theme.text, fontSize: 14, fontWeight: 'bold' }}>
                  {t('settingChangePwTitle')}
                </CustomText>
              </View>
              <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
                {t('settingChangePwSub')}
              </CustomText>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                disabled={!onChangeMasterPassword}
                style={[
                  styles.settingsSecondaryBtn,
                  !onChangeMasterPassword && { opacity: 0.6 },
                ]}
                onPress={openChangePwModal}
              >
                <Feather name="edit-3" size={14} color={theme.accent} />
                <CustomText style={{ color: theme.accent, fontSize: 12, fontWeight: 'bold' }}>
                  {t('btnChangeMasterPw')}
                </CustomText>
              </TouchableOpacity>
            </View>

            {/* Recovery Key Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Feather name="key" size={16} color={theme.accent} />
                  <CustomText style={styles.settingsCardKicker}>
                    {t('recoveryKeySectionTitle')}
                  </CustomText>
                </View>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: hasRecoveryKey
                    ? (isLight ? 'rgba(61,107,79,0.15)' : 'rgba(90,154,110,0.2)')
                    : (isLight ? 'rgba(176,112,32,0.12)' : 'rgba(212,152,42,0.16)'),
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 12,
                }}>
                  <View style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: hasRecoveryKey ? theme.green : theme.amber,
                    marginRight: 6,
                  }} />
                  <CustomText style={{
                    color: hasRecoveryKey ? theme.green : theme.amber,
                    fontSize: 11,
                    fontWeight: '600',
                  }}>
                    {hasRecoveryKey ? t('recoveryKeyStatusActive') : t('recoveryKeyStatusMissing')}
                  </CustomText>
                </View>
              </View>
              <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
                {t('recoveryKeyCardDesc')}
              </CustomText>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                disabled={recoveryKeyBusy || !onRegenerateRecoveryKey}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: hasRecoveryKey ? theme.paper : theme.accent,
                  borderWidth: 1,
                  borderColor: hasRecoveryKey ? theme.border : theme.accent,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 6,
                  opacity: (recoveryKeyBusy || !onRegenerateRecoveryKey) ? 0.6 : 1,
                }}
                onPress={handleRegenerateRecoveryKeyPress}
              >
                <Feather
                  name={hasRecoveryKey ? 'refresh-cw' : 'key'}
                  size={14}
                  color={hasRecoveryKey ? theme.accent : theme.bg}
                />
                <CustomText style={{
                  color: hasRecoveryKey ? theme.accent : theme.bg,
                  fontSize: 12,
                  fontWeight: 'bold',
                }}>
                  {recoveryKeyBusy
                    ? '...'
                    : (hasRecoveryKey ? t('recoveryKeyBtnRegenerate') : t('recoveryKeyBtnCreate'))}
                </CustomText>
              </TouchableOpacity>
            </View>

            {/* Android Autofill Card */}
            {autofillSupported && (
              <View style={[styles.settingsCard, styles.settingsGroupCard]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Feather name="zap" size={16} color={theme.accent} />
                    <CustomText style={styles.settingsCardKicker} numberOfLines={1}>
                      {t('autofillTitle')}
                    </CustomText>
                  </View>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: autofillEnabled
                      ? (isLight ? 'rgba(61,107,79,0.15)' : 'rgba(90,154,110,0.2)')
                      : (isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)'),
                    paddingVertical: 4,
                    paddingHorizontal: 8,
                    borderRadius: 12,
                  }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: autofillEnabled ? theme.green : theme.red, marginRight: 6 }} />
                    <CustomText style={{ color: autofillEnabled ? theme.green : theme.red, fontSize: 11, fontWeight: '600' }}>
                      {autofillEnabled ? t('autofillStatusActive') : t('autofillStatusInactive')}
                    </CustomText>
                  </View>
                </View>
                <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
                  {t('autofillDesc')}
                </CustomText>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    backgroundColor: autofillEnabled ? theme.paper : theme.accent,
                    borderWidth: 1,
                    borderColor: autofillEnabled ? theme.border : theme.accent,
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 6,
                  }}
                  onPress={async () => {
                    await autofillService.openSettings();
                    setTimeout(async () => {
                      const en = await autofillService.isEnabled();
                      setAutofillEnabled(en);
                    }, 1000);
                  }}
                >
                  <Feather name="external-link" size={14} color={autofillEnabled ? theme.accent : theme.bg} />
                  <CustomText style={{ color: autofillEnabled ? theme.accent : theme.bg, fontSize: 12, fontWeight: 'bold' }}>
                    {autofillEnabled ? t('autofillBtnSettings') : t('autofillBtnEnable')}
                  </CustomText>
                </TouchableOpacity>
              </View>
            )}

            {/* ── GROUP 2: SYNC & BACKUPS ── */}
            <CustomText style={styles.settingsGroupHeader}>
              {t('settingsGroupSyncBackups')}
            </CustomText>

            {/* LAN Sync & Paired Desktop Card */}
            {pairingInfo ? (
              <View style={[styles.settingsCard, styles.settingsGroupCard]}>
                <CustomText style={[styles.settingsCardKicker, { marginBottom: 8 }]}>
                  {t('settingSyncDevicesTitle')}
                </CustomText>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Feather name="monitor" size={16} color={theme.text} />
                    <CustomText numberOfLines={1} style={{ color: theme.text, fontSize: 13, fontWeight: 'bold', flex: 1 }}>
                      {pairingInfo.deviceId || t('desktopDeviceDefault')}
                    </CustomText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isLight ? 'rgba(61,107,79,0.15)' : 'rgba(90,154,110,0.2)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.green, marginRight: 6 }} />
                    <CustomText style={{ color: theme.green, fontSize: 11, fontWeight: '600' }}>{t('deviceStatusReady')}</CustomText>
                  </View>
                </View>

                <CustomText style={{ color: theme.muted, fontSize: 11, marginBottom: 12 }}>
                  {pairingInfo.addresses && pairingInfo.addresses.length > 0
                    ? pairingInfo.addresses.map(a => `${a}:${pairingInfo.port || 8765}`).join('  |  ')
                    : `127.0.0.1:${pairingInfo.port || 8765}`}
                </CustomText>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    delayPressIn={0}
                    style={[styles.settingsSecondaryBtn, { flex: 1 }]}
                    onPress={handleLanSyncPress}
                  >
                    <Feather name="refresh-cw" size={14} color={theme.accent} />
                    <CustomText style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>{t('btnSyncNow')}</CustomText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.7}
                    delayPressIn={0}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      backgroundColor: isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)',
                      borderWidth: 1,
                      borderColor: theme.red,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 6,
                    }}
                    onPress={handleUnpairPress}
                  >
                    <Feather name="trash-2" size={14} color={theme.red} />
                    <CustomText style={{ color: theme.red, fontSize: 12, fontWeight: '600' }}>{t('btnUnpairDevice')}</CustomText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={[styles.settingsCard, styles.settingsGroupCard, { alignItems: 'center', paddingVertical: 20 }]}>
                <CustomText style={[styles.settingsCardKicker, { marginBottom: 12 }]}>
                  {t('settingSyncDevicesTitle')}
                </CustomText>
                <Feather name="monitor" size={24} color={theme.muted} style={{ marginBottom: 8 }} />
                <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>
                  {t('noDesktopPaired')}
                </CustomText>
                <CustomText style={{ color: theme.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 16, paddingHorizontal: 8 }}>
                  {t('pairDesktopHint')}
                </CustomText>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 }}
                  onPress={handlePairDesktopPress}
                >
                  <Feather name="camera" size={14} color={theme.bg} />
                  <CustomText style={{ color: theme.bg, fontSize: 12, fontWeight: 'bold' }}>{t('btnPairDesktop')}</CustomText>
                </TouchableOpacity>
              </View>
            )}

            {/* Backups & Portable .fuin Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Feather name="database" size={16} color={theme.accent} />
                <CustomText style={{ color: theme.text, fontSize: 14, fontWeight: 'bold' }}>
                  {t('settingsBackupCardTitle')}
                </CustomText>
              </View>
              <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
                {t('settingsBackupCardSub')}
              </CustomText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={[styles.settingsSecondaryBtn, { flex: 1, minWidth: 136 }]}
                  onPress={handleOpenBackupHistory}
                >
                  <Feather name="clock" size={14} color={theme.accent} />
                  <CustomText style={{ color: theme.accent, fontSize: 12, fontWeight: 'bold' }}>
                    {t('btnOpenBackupHistory')}
                  </CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={[styles.settingsSecondaryBtn, { flex: 1, minWidth: 136 }]}
                  onPress={() => switchTabSmooth('tools')}
                >
                  <Feather name="shield" size={14} color={theme.accent} />
                  <CustomText style={{ color: theme.accent, fontSize: 12, fontWeight: 'bold' }}>
                    {t('btnPortableFuinBackup')}
                  </CustomText>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── GROUP 3: APPEARANCE, LANGUAGE & SYSTEM ── */}
            <CustomText style={styles.settingsGroupHeader}>
              {t('settingsGroupAppearanceSystem')}
            </CustomText>

            {/* Theme & Language Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <CustomText style={[styles.settingsCardKicker, { marginBottom: 12 }]}>
                {t('themeTitle')}
              </CustomText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['dark', 'light', 'system'].map(m => {
                  const isActive = themeMode === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.7}
                      delayPressIn={0}
                      style={[
                        styles.settingsPillBtn,
                        { flex: 1 },
                        isActive && {
                          borderColor: theme.accent,
                          backgroundColor: isLight ? 'rgba(61,107,79,0.12)' : 'rgba(90,154,110,0.14)',
                        },
                      ]}
                      onPress={() => changeTheme(m)}
                    >
                      <CustomText style={{ color: isActive ? theme.accent : theme.text, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {m === 'system' ? t('themeSystem') : m === 'dark' ? t('themeDark') : t('themeLight')}
                      </CustomText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.settingsDivider} />

              <CustomText style={[styles.settingsCardKicker, { marginBottom: 12 }]}>
                {t('langTitle')}
              </CustomText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['tr', 'en'].map(l => {
                  const isActive = lang === l;
                  return (
                    <TouchableOpacity
                      key={l}
                      activeOpacity={0.7}
                      delayPressIn={0}
                      style={[
                        styles.settingsPillBtn,
                        { flex: 1 },
                        isActive && {
                          borderColor: theme.accent,
                          backgroundColor: isLight ? 'rgba(61,107,79,0.12)' : 'rgba(90,154,110,0.14)',
                        },
                      ]}
                      onPress={() => setLang(l)}
                    >
                      <CustomText style={{ color: isActive ? theme.accent : theme.text, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {l === 'tr' ? 'TR' : 'EN'}
                      </CustomText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Updates & Cryptographic Architecture Card */}
            <View style={[styles.settingsCard, styles.settingsGroupCard]}>
              <CustomText style={[styles.settingsCardKicker, { marginBottom: 12 }]}>
                {t('sysSecurityTitle')}
              </CustomText>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <CustomText style={{ color: theme.text, fontSize: 14, fontWeight: 'bold' }}>
                    Fuin Mobile v{updater.currentVersion}
                  </CustomText>
                  <CustomText style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>
                    {t('sysLocalVaultActive')}
                  </CustomText>
                </View>

                {updater.isSupported ? (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    delayPressIn={0}
                    disabled={updater.checking || updater.downloading || updater.verifying}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 6,
                      backgroundColor: updater.updateInfo ? theme.accent : theme.paper,
                      borderWidth: 1,
                      borderColor: updater.updateInfo ? theme.accent : theme.border,
                      opacity: (updater.checking || updater.downloading || updater.verifying) ? 0.65 : 1,
                    }}
                    onPress={updater.updateInfo ? updater.startUpdateDownload : updater.checkUpdatesManual}
                  >
                    <Feather
                      name={updater.updateInfo ? 'download' : 'refresh-cw'}
                      size={13}
                      color={updater.updateInfo ? theme.bg : theme.text}
                    />
                    <CustomText style={{ color: updater.updateInfo ? theme.bg : theme.text, fontSize: 12, fontWeight: 'bold' }}>
                      {updater.checking
                        ? t('updateChecking')
                        : updater.verifying
                          ? t('updateVerifying')
                          : updater.downloading
                            ? `${updater.progress.percent}%`
                            : updater.updateInfo
                              ? `${t('updateBtnInstallNow')} (v${updater.updateInfo.version})`
                              : t('updateBtnCheck')}
                    </CustomText>
                  </TouchableOpacity>
                ) : null}
              </View>

              {(updater.downloading || updater.verifying) ? (
                <View style={{ marginTop: 12 }}>
                  <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
                    <View style={{ width: `${updater.verifying ? 100 : updater.progress.percent}%`, height: '100%', backgroundColor: theme.accent }} />
                  </View>
                  <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>
                    {updater.verifying
                      ? t('updateVerifying')
                      : t('updateDownloading').replace('{percent}', String(updater.progress.percent))}
                  </CustomText>
                </View>
              ) : updater.statusMessage ? (
                <CustomText style={{ color: updater.updateInfo ? theme.accent : theme.muted, fontSize: 11, marginTop: 8 }}>
                  {updater.statusMessage}
                </CustomText>
              ) : null}

              <View style={styles.settingsDivider} />

              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                onPress={() => setShowCryptoDetails(prev => !prev)}
              >
                <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>
                  {t('sysCryptoArchitecture')}
                </CustomText>
                <Feather name={showCryptoDetails ? 'chevron-up' : 'chevron-down'} size={16} color={theme.muted} />
              </TouchableOpacity>
              {showCryptoDetails ? (
                <CustomText style={{ color: theme.muted, fontSize: 11, lineHeight: 18, marginTop: 8 }}>
                  {t('sysCryptoDetails')}
                </CustomText>
              ) : null}
            </View>

            {/* What's New Card */}
            <TouchableOpacity
              activeOpacity={0.7}
              delayPressIn={0}
              style={[styles.settingsCard, styles.settingsGroupCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
              onPress={() => setWhatsNewModalVisible(true)}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="zap" size={14} color={theme.accent} />
                  <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>{t('whatsNewTitle')}</CustomText>
                </View>
                <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4, lineHeight: 16 }}>
                  {t('whatsNewSub')}
                </CustomText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </TouchableOpacity>

            {/* Lock Session Action */}
            <TouchableOpacity
              activeOpacity={0.7}
              delayPressIn={0}
              style={[styles.settingsCard, { marginTop: 8, marginBottom: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
              onPress={onLogout}
            >
              <Feather name="log-out" size={15} color={theme.red} />
              <CustomText style={{ color: theme.red, fontSize: 14, fontWeight: '600' }}>{t('lockSessionBtn')}</CustomText>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
      {/* Edit/Add Modal */}
      <EditModal 
        visible={modalVisible} 
        entry={selectedEntry}
        allCategories={editableCategories}
        onOpenTotpScanner={onOpenTotpScanner}
        onClose={() => setModalVisible(false)} 
        onSave={handleSaveEntry} 
        onDelete={handleDeleteEntry} 
        onRestore={handleRestoreEntry}
      />

      <HealthModal 
        visible={healthModalVisible} 
        entries={entries.filter(e => !e.isDeleted)} 
        onClose={() => setHealthModalVisible(false)} 
      />

      <WhatsNewModal 
        visible={whatsNewModalVisible} 
        onClose={() => setWhatsNewModalVisible(false)} 
      />

      {/* Bottom Navigation Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 20 }]}>
        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('vault')} activeOpacity={0.7} delayPressIn={0}>
          <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'vault' ? theme.accent : theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <Polyline points="9 22 9 12 15 12 15 22" />
          </Svg>
          <CustomText style={[styles.navText, activeTab === 'vault' && styles.navTextActive]}>{t('tabVault')}</CustomText>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.navBtn} 
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={() => {
            if (!pairingInfo) {
              showAlert(
                t('settingSyncDevicesTitle'),
                t('pairDesktopHint'),
                [
                  { text: t('btnCancel'), style: 'cancel' },
                  { text: t('btnPairDesktop'), onPress: handlePairDesktopPress }
                ]
              );
            } else {
              handleLanSyncPress();
            }
          }}
        >
          <Feather name="wifi" size={22} color={theme.muted} />
          <CustomText style={styles.navText}>
            {t('tabLanSync')}
          </CustomText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('tools')} activeOpacity={0.7} delayPressIn={0}>
          <Feather name="tool" size={22} color={activeTab === 'tools' ? theme.accent : theme.muted} />
          <CustomText style={[styles.navText, activeTab === 'tools' && styles.navTextActive]}>{t('tabTools')}</CustomText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('settings')} activeOpacity={0.7} delayPressIn={0}>
          <View style={{ position: 'relative' }}>
            <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'settings' ? theme.accent : theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <Circle cx="12" cy="12" r="3" />
              <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </Svg>
            {updater.updateInfo ? (
              <View style={{
                position: 'absolute',
                top: -2,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.accent,
              }} />
            ) : null}
          </View>
          <CustomText style={[styles.navText, activeTab === 'settings' && styles.navTextActive]}>{t('tabSettings')}</CustomText>
        </TouchableOpacity>
      </View>

      {/* Backup Restore Modal */}
      <BackupHistoryModal
        visible={backupModalVisible}
        backups={backups}
        onClose={() => setBackupModalVisible(false)}
        onRestored={onLogout}
        theme={theme}
        styles={styles}
        lang={lang}
        t={t}
        showAlert={showAlert}
      />

      {/* Live 2FA (TOTP) Viewer Modal */}
      <Modal
        visible={Boolean(totpSecret)}
        transparent
        animationType="fade"
        onRequestClose={closeTotpModal}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: theme.paper, borderRadius: 8, borderWidth: 1, borderColor: theme.border, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <CustomText style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1.5, color: theme.muted }}>{t('totpModalTitle')}</CustomText>
              <CustomText style={{ fontSize: 12, fontWeight: 'bold', color: totpState.secondsRemaining <= 5 ? (theme.amber || '#c88040') : theme.accent }}>
                {totpState.secondsRemaining}s
              </CustomText>
            </View>
            <CustomText style={{ fontSize: 16, fontWeight: 'bold', color: theme.text, marginBottom: 14 }} numberOfLines={1}>
              {totpModalSite}
            </CustomText>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleCopyTotpCode}
              style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingVertical: 18, paddingHorizontal: 14, alignItems: 'center', marginBottom: 12 }}
            >
              <CustomText style={{ fontSize: 30, fontWeight: 'bold', letterSpacing: 4, color: totpState.valid ? theme.accent : theme.red, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                {totpState.valid ? totpState.formattedToken : '--- ---'}
              </CustomText>
              <CustomText style={{ fontSize: 11, color: theme.muted, marginTop: 6 }}>
                {totpState.valid ? t('totpHint') : t('totpInvalidSecret')}
              </CustomText>
            </TouchableOpacity>

            <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 16 }}>
              <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, totpState.progressPercent))}%`, backgroundColor: totpState.secondsRemaining <= 5 ? (theme.amber || '#c88040') : theme.accent }} />
            </View>

            <TouchableOpacity
              onPress={closeTotpModal}
              style={{ alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 4, borderWidth: 1, borderColor: theme.border }}
            >
              <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>{t('btnClose')}</CustomText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Encrypted .fuin Backup Password Modal */}
      <Modal
        visible={Boolean(encBackupRaw)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!encBackupBusy) { setEncBackupRaw(null); setEncBackupPw(''); } }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: theme.paper, borderRadius: 8, borderWidth: 1, borderColor: theme.border, padding: 20 }}>
            <CustomText style={{ fontSize: 15, fontWeight: 'bold', color: theme.text, marginBottom: 8 }}>{t('promptEncBackupTitle')}</CustomText>
            <CustomText style={{ fontSize: 12, color: theme.muted, marginBottom: 14, lineHeight: 18 }}>{t('promptEncBackupDesc')}</CustomText>
            <CustomTextInput
              value={encBackupPw}
              onChangeText={setEncBackupPw}
              placeholder={t('fieldPassword')}
              placeholderTextColor={theme.muted}
              secureTextEntry
              autoFocus
              style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 4, padding: 12, color: theme.text, fontSize: 14, marginBottom: 16 }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
              <TouchableOpacity
                disabled={encBackupBusy}
                onPress={() => { setEncBackupRaw(null); setEncBackupPw(''); }}
                style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 4, borderWidth: 1, borderColor: theme.border }}
              >
                <CustomText style={{ color: theme.muted, fontSize: 13, fontWeight: 'bold' }}>{t('btnCancel')}</CustomText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={encBackupBusy || !encBackupPw}
                onPress={async () => {
                  if (!encBackupRaw || !encBackupPw || encBackupBusy) return;
                  setEncBackupBusy(true);
                  try {
                    const plainJson = await decryptFuinBackup(encBackupRaw, encBackupPw);
                    const res = FuinImporters.importJSON(plainJson, {
                      existingEntries: unprotectEntries(entries),
                      defaultCategory: 'Diğer',
                    });
                    setEncBackupRaw(null);
                    setEncBackupPw('');
                    if (res.entries.length === 0) {
                      showAlert(t('alertInfo'), res.skippedCount > 0 ? t('ioAllDuplicatesOrSkipped') : t('ioInvalidFuinFile'));
                      return;
                    }
                    await applyImportedVaultEntries(res, {
                      formatType: 'fuin',
                      successMsg: `${res.entries.length}${t('toastEncBackupRestored')}`,
                    });
                  } catch {
                    showAlert(t('alertError'), t('toastWrongPasswordOrCorrupted'));
                  } finally {
                    setEncBackupBusy(false);
                  }
                }}
                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 4, backgroundColor: theme.accent, opacity: encBackupBusy || !encBackupPw ? 0.6 : 1 }}
              >
                <CustomText style={{ color: theme.bg, fontSize: 13, fontWeight: 'bold' }}>{encBackupBusy ? '...' : t('btnOk')}</CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Master Password Reprompt Modal (fail-closed fallback when biometrics are unavailable) */}
      <Modal
        visible={repromptModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => closeRepromptModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.changePwBackdrop}
        >
          <View style={styles.changePwCard}>
            <View style={styles.changePwHeader}>
              <CustomText style={styles.changePwTitle}>{t('repromptModalTitle')}</CustomText>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => closeRepromptModal(false)}
              >
                <Feather name="x" size={18} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <CustomText style={styles.changePwDesc}>{t('repromptModalDesc')}</CustomText>

            <CustomText style={styles.changePwFieldLabel}>{t('changePwCurrentLabel')}</CustomText>
            <View style={styles.changePwInputWrap}>
              <CustomTextInput
                style={styles.changePwInput}
                value={repromptPwInput}
                onChangeText={(val) => {
                  setRepromptPwInput(val);
                  if (repromptError) setRepromptError('');
                }}
                placeholder={t('repromptPasswordPh')}
                placeholderTextColor={theme.muted}
                secureTextEntry={!showRepromptPw}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={128}
                onSubmitEditing={handleSubmitRepromptPw}
              />
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                style={styles.changePwEyeBtn}
                onPress={() => setShowRepromptPw(prev => !prev)}
              >
                <Feather name={showRepromptPw ? 'eye-off' : 'eye'} size={16} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {repromptError ? (
              <View style={[
                styles.changePwErrorBox,
                { backgroundColor: isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)' },
              ]}>
                <CustomText style={styles.changePwErrorText}>{repromptError}</CustomText>
              </View>
            ) : null}

            <View style={styles.changePwFooter}>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                style={styles.changePwCancelBtn}
                onPress={() => closeRepromptModal(false)}
              >
                <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>
                  {t('btnCancel')}
                </CustomText>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                style={styles.changePwSaveBtn}
                onPress={handleSubmitRepromptPw}
              >
                <CustomText style={{ color: theme.bg, fontSize: 13, fontWeight: 'bold' }}>
                  {t('btnVerify')}
                </CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Master Password Modal */}
      <Modal
        visible={changePwModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeChangePwModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.changePwBackdrop}
        >
          <View style={styles.changePwCard}>
            <View style={styles.changePwHeader}>
              <CustomText style={styles.changePwTitle}>{t('changePwModalTitle')}</CustomText>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                disabled={changePwBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={closeChangePwModal}
              >
                <Feather name="x" size={18} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <CustomText style={styles.changePwDesc}>{t('changePwModalDesc')}</CustomText>

              {/* Current Master Password */}
              <CustomText style={styles.changePwFieldLabel}>{t('changePwCurrentLabel')}</CustomText>
              <View style={styles.changePwInputWrap}>
                <CustomTextInput
                  style={styles.changePwInput}
                  value={curMasterPw}
                  onChangeText={(val) => {
                    setCurMasterPw(val);
                    if (changePwError) setChangePwError('');
                  }}
                  placeholder={t('changePwCurrentPh')}
                  placeholderTextColor={theme.muted}
                  secureTextEntry={!showCurMasterPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!changePwBusy}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={styles.changePwEyeBtn}
                  onPress={() => setShowCurMasterPw(prev => !prev)}
                >
                  <Feather name={showCurMasterPw ? 'eye-off' : 'eye'} size={16} color={theme.muted} />
                </TouchableOpacity>
              </View>

              {/* New Master Password */}
              <CustomText style={styles.changePwFieldLabel}>{t('changePwNewLabel')}</CustomText>
              <View style={styles.changePwInputWrap}>
                <CustomTextInput
                  style={styles.changePwInput}
                  value={newMasterPw}
                  onChangeText={(val) => {
                    setNewMasterPw(val);
                    if (changePwError) setChangePwError('');
                  }}
                  placeholder={t('changePwNewPh')}
                  placeholderTextColor={theme.muted}
                  secureTextEntry={!showNewMasterPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!changePwBusy}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={styles.changePwEyeBtn}
                  onPress={() => setShowNewMasterPw(prev => !prev)}
                >
                  <Feather name={showNewMasterPw ? 'eye-off' : 'eye'} size={16} color={theme.muted} />
                </TouchableOpacity>
              </View>

              {/* Confirm New Master Password */}
              <CustomText style={styles.changePwFieldLabel}>{t('changePwConfirmLabel')}</CustomText>
              <View style={styles.changePwInputWrap}>
                <CustomTextInput
                  style={styles.changePwInput}
                  value={confirmMasterPw}
                  onChangeText={(val) => {
                    setConfirmMasterPw(val);
                    if (changePwError) setChangePwError('');
                  }}
                  placeholder={t('changePwConfirmPh')}
                  placeholderTextColor={theme.muted}
                  secureTextEntry={!showConfirmMasterPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!changePwBusy}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={styles.changePwEyeBtn}
                  onPress={() => setShowConfirmMasterPw(prev => !prev)}
                >
                  <Feather name={showConfirmMasterPw ? 'eye-off' : 'eye'} size={16} color={theme.muted} />
                </TouchableOpacity>
              </View>

              {changePwError ? (
                <View style={[
                  styles.changePwErrorBox,
                  { backgroundColor: isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)' },
                ]}>
                  <CustomText style={styles.changePwErrorText}>{changePwError}</CustomText>
                </View>
              ) : null}

              <View style={styles.changePwFooter}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  disabled={changePwBusy}
                  style={[styles.changePwCancelBtn, changePwBusy && { opacity: 0.6 }]}
                  onPress={closeChangePwModal}
                >
                  <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>
                    {t('btnCancel')}
                  </CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  disabled={changePwBusy}
                  style={[styles.changePwSaveBtn, changePwBusy && { opacity: 0.65 }]}
                  onPress={handleSubmitChangePw}
                >
                  <CustomText style={{ color: theme.bg, fontSize: 13, fontWeight: 'bold' }}>
                    {changePwBusy ? t('changePwSaving') : t('btnSaveNewMasterPw')}
                  </CustomText>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.paper,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    color: theme.text,
  },
  logoutText: {
    color: theme.red,
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  categoriesWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border2,
    backgroundColor: theme.bg,
    paddingVertical: 4,
  },
  categoriesScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  categoryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  categoryBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  categoryText: {
    fontSize: 12,
    color: theme.text,
    fontWeight: '500',
  },
  categoryTextActive: {
    color: theme.bg,
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 20,
    gap: 16,
    paddingBottom: 80, // for FAB
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
  },
  cardCategory: {
    fontSize: 10,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: theme.muted,
    letterSpacing: 1,
  },
  value: {
    fontSize: 14,
    color: theme.accent,
    fontWeight: '600',
    padding: 4,
  },
  emptyWrap: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: theme.muted,
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  fabText: {
    color: theme.bg,
    fontSize: 32,
    fontWeight: '300',
    marginTop: -4,
  },
  settingsWrap: {
    padding: 20,
  },
  settingsTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 20,
  },
  settingsGroupHeader: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 12,
  },
  settingsCard: {
    backgroundColor: theme.card,
    padding: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  settingsGroupCard: {
    marginBottom: 12,
  },
  settingsCardKicker: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: 12,
  },
  settingsPillBtn: {
    backgroundColor: theme.paper,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.paper,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  changePwBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  changePwCard: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '88%',
    backgroundColor: theme.paper,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
  },
  changePwHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  changePwTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  changePwDesc: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  changePwFieldLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  changePwInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    marginBottom: 12,
  },
  changePwInput: {
    flex: 1,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
  },
  changePwEyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changePwErrorBox: {
    borderWidth: 1,
    borderColor: theme.red,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  changePwErrorText: {
    color: theme.red,
    fontSize: 12,
    lineHeight: 16,
  },
  changePwFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
  },
  changePwCancelBtn: {
    flex: 1,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePwSaveBtn: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.paper,
    paddingBottom: Platform.OS === 'ios' ? 30 : 25,
    paddingTop: 10,
  },
  navBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navText: {
    fontSize: 10,
    color: theme.muted,
    fontWeight: '500',
  },
  navTextActive: {
    color: theme.accent,
    fontWeight: 'bold',
  }
});

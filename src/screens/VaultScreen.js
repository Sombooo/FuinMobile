import CustomTextInput from '../components/CustomTextInput';
import CustomText from '../components/CustomText';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, SafeAreaView, StatusBar, Alert, Platform, ScrollView, TextInput, Switch, Modal, LayoutAnimation, Animated, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useTheme } from '../theme';
import Svg, { Polygon, Path, Circle, Rect, Polyline, Line } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ClipboardExpo from 'expo-clipboard';
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
import VaultCardItem from '../components/VaultCardItem';
import useVaultSearch from '../hooks/useVaultSearch';
import useAppUpdater from '../hooks/useAppUpdater';
import { memDecrypt, unprotectEntries } from '../services/sessionSecurity';
import { autofillService } from '../services/autofillService';

export default function VaultScreen({ 
  vaultData, 
  password, 
  onLogout, 
  onSyncRequest, 
  onOpenScanner,
  onPerformLanSync,
  onUpdateVaultData, 
  sharedEntryData, 
  setSharedEntryData,
  lanPairingVersion,
  onPairingUpdated
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
    return allCategories.filter(c => c !== t('cat_all') && c !== t('cat_fav') && c !== t('cat_trash'));
  }, [allCategories, t]);
  
  // Edit State
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [healthModalVisible, setHealthModalVisible] = useState(false);
  const [whatsNewModalVisible, setWhatsNewModalVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [backups, setBackups] = useState([]);

  // Show password state
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Sync & Pairing State
  const [syncMode, setSyncMode] = useState('lan');
  const [pairingInfo, setPairingInfo] = useState(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [autofillSupported, setAutofillSupported] = useState(false);

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
        const curVer = updater.currentVersion || '1.0.0-beta.10';
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
    });
  }, []);

  useEffect(() => {
    if (sharedEntryData) {
      setSelectedEntry({
        id: Date.now().toString(),
        site: sharedEntryData.site || '',
        category: sharedEntryData.category || t('cat_other'),
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
    };
  }, []);

  const toggleBiometric = async () => {
    const newVal = !biometricEnabled;
    if (newVal) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        showAlert(t('alertError'), t('bioNotSupportedOrEnrolled'));
        return;
      }
      
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: t('bioEnablePrompt')
      });
      
      if (auth.success) {
        await SecureStore.setItemAsync('fuin-biometric-enabled', 'true');
        if (password) {
          await SecureStore.setItemAsync('fuin-biometric-key', password, {
            requireAuthentication: true,
            authenticationPrompt: 'Kasayı açmak için doğrulayın',
          });
        }
        setBiometricEnabled(true);
        showAlert(t('alertSuccess'), t('bioEnabledSuccess'));
      }
    } else {
      await SecureStore.setItemAsync('fuin-biometric-enabled', 'false');
      await SecureStore.deleteItemAsync('fuin-biometric-key');
      setBiometricEnabled(false);
    }
  };


  const verifyReprompt = useCallback(async (entry) => {
    if (!entry || !entry.reprompt) return true;
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHw && isEnrolled) {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: t('repromptBioPrompt') || 'Korumalı kayda erişmek için kimliğinizi doğrulayın'
        });
        return res.success;
      }
      return true;
    } catch (err) {
      console.error('Reprompt auth error:', err);
      return false;
    }
  }, [t]);

  const handleCopy = useCallback(async (val, label, entry) => {
    const isPassword = label === t('fieldPassword');
    if (isPassword && entry && entry.reprompt) {
      const ok = await verifyReprompt(entry);
      if (!ok) return;
    }
    const textToCopy = isPassword && typeof val === 'object' ? memDecrypt(val) : String(val || '');
    const duration = isPassword ? 45000 : 30000;
    await copySecure(textToCopy, duration);
    showAlert(t('alertCopied'), isPassword ? t('toastCopiedClipboard45s') : label + t('toastCopiedClipboard30s'));
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
    if (index >= 0) {
      newEntries[index] = updatedEntry;
    } else {
      newEntries.push(updatedEntry);
    }

    const payload = JSON.stringify({ type: 'fuin/vault', categories: [], entries: newEntries });
    const success = await onUpdateVaultData(payload);
    if (success) {
      setModalVisible(false);
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

  const handleOpenUrl = useCallback(async (rawUrl) => {
    try {
      let urlToOpen = String(rawUrl || '').trim();
      if (!urlToOpen) return;

      // Reject non-web URI schemes (javascript:, intent:, file:, content:, fuin:, androidapp:)
      if (/^[a-z][a-z0-9+.-]*:/i.test(urlToOpen) && !/^https?:\/\//i.test(urlToOpen)) {
        showAlert(t('alertError'), t('toastGenericError') + ' (Geçersiz URL)');
        return;
      }

      if (!/^https?:\/\//i.test(urlToOpen)) {
        urlToOpen = 'https://' + urlToOpen;
      }

      const parsed = new URL(urlToOpen);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
        showAlert(t('alertError'), t('toastGenericError') + ' (Geçersiz URL)');
        return;
      }

      const supported = await Linking.canOpenURL(parsed.href);
      if (supported) {
        await Linking.openURL(parsed.href);
      } else {
        showAlert(t('alertError'), t('toastGenericError') + ' (Geçersiz URL)');
      }
    } catch (error) {
      console.error("URL açılırken hata:", error);
      showAlert(t('alertError'), t('toastGenericError') + ' (Geçersiz URL)');
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
      theme={theme}
      styles={styles}
      t={t}
    />
  ), [visiblePasswords, togglePasswordVisibility, handleCopy, openEditModal, handleOpenUrl, theme, styles, t]);

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
                      {(t('updateBannerTitle') || 'Yeni sürüm mevcut: v{version}').replace('{version}', updater.updateInfo.version)}
                    </CustomText>
                    {(updater.downloading || updater.verifying) ? (
                      <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>
                        {updater.verifying
                          ? t('updateVerifying')
                          : (t('updateDownloading') || 'İndiriliyor... %{percent}').replace('{percent}', String(updater.progress.percent))}
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
                try {
                  const { StorageAccessFramework } = FileSystem;
                  const jsonStr = JSON.stringify({ ...parsedVault, entries: unprotectEntries(entries) }, null, 2);
                  const fileName = 'fuin-yedek.json';
                  
                  if (Platform.OS === 'android') {
                    const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
                    if (permissions.granted) {
                      const fileUri = await StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, 'application/json');
                      await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: 'utf8' });
                      showAlert(t('alertSuccess'), t('toastJsonExported'));
                    }
                  } else {
                    const fileUri = FileSystem.cacheDirectory + fileName;
                    await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: 'utf8' });
                    try {
                      await Sharing.shareAsync(fileUri, { UTI: 'public.json', dialogTitle: t('ioExportJsonTitle') });
                    } finally {
                      await FileSystem.deleteAsync(fileUri, { idempotent: true });
                    }
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioExportJsonFailed') + ' (Hata)');
                }
              }}>
                <Feather name="download" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioExportJsonBtn')}</CustomText>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center', paddingVertical: 14 }]} onPress={async () => {
                try {
                  const { StorageAccessFramework } = FileSystem;
                  
                  let csv = 'name,url,username,password,notes,category,totp\n';
                  entries.forEach(e => {
                    const row = [e.site, e.url, e.username, memDecrypt(e.password), e.note, e.category, memDecrypt(e.totp)]
                      .map(v => `"${(v||'').replace(/"/g, '""')}"`).join(',');
                    csv += row + '\n';
                  });
                  const fileName = 'fuin-yedek.csv';
                  
                  if (Platform.OS === 'android') {
                    const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
                    if (permissions.granted) {
                      const fileUri = await StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, 'text/csv');
                      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });
                      showAlert(t('alertSuccess'), t('toastCsvExported'));
                    }
                  } else {
                    const fileUri = FileSystem.cacheDirectory + fileName;
                    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });
                    try {
                      await Sharing.shareAsync(fileUri, { UTI: 'public.comma-separated-values-text', dialogTitle: t('ioExportCsvTitle') });
                    } finally {
                      await FileSystem.deleteAsync(fileUri, { idempotent: true });
                    }
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioExportCsvFailed') + ' (Hata)');
                }
              }}>
                <Feather name="file-text" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioExportCsvBtn')}</CustomText>
              </TouchableOpacity>
            </View>

            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20}}>
              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                let importedCacheUri = null;
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
                  if (result.canceled === false && result.assets && result.assets.length > 0) {
                    importedCacheUri = result.assets[0].uri;
                    const content = await FileSystem.readAsStringAsync(importedCacheUri, { encoding: 'utf8' });
                    try { await FileSystem.deleteAsync(importedCacheUri, { idempotent: true }); importedCacheUri = null; } catch {}
                    
                    const res = FuinImporters.importJSON(content, {
                      existingEntries: entries,
                      defaultCategory: t('cat_other')
                    });

                    const newEntries = [...entries, ...res.entries];
                    const newCategories = Array.from(new Set([...(parsedVault.categories || DEFAULT_CATEGORIES), ...(res.categories || [])]));
                    
                    const success = await onUpdateVaultData(JSON.stringify({ type: 'fuin/vault', categories: newCategories, entries: newEntries }));
                    if (success) showAlert(t('alertSuccess'), `${res.entries.length}${t('ioItemsImportedSuccess')}`);
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioImportFailed') + ': ' + e.message);
                } finally {
                  if (importedCacheUri) {
                    try { await FileSystem.deleteAsync(importedCacheUri, { idempotent: true }); } catch {}
                  }
                }
              }}>
                <Feather name="upload" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioImportJsonBtn')}</CustomText>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                let importedCsvUri = null;
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true });
                  if (result.canceled === false && result.assets && result.assets.length > 0) {
                    importedCsvUri = result.assets[0].uri;
                    const content = await FileSystem.readAsStringAsync(importedCsvUri, { encoding: 'utf8' });
                    try { await FileSystem.deleteAsync(importedCsvUri, { idempotent: true }); importedCsvUri = null; } catch {}

                    const res = FuinImporters.importCSV(content, {
                      existingEntries: entries,
                      defaultCategory: t('cat_other')
                    });

                    if (res.entries.length === 0 && res.totalRows === 0) {
                      throw new Error(t('ioInvalidCsvEmpty'));
                    }

                    const newEntries = [...entries, ...res.entries];
                    const success = await onUpdateVaultData(JSON.stringify({ type: 'fuin/vault', categories: parsedVault.categories, entries: newEntries }));
                    if (success) showAlert(t('alertSuccess'), `${res.entries.length}${t('ioItemsImportedCsvSuccess')}`);
                  }
                } catch(e) {
                  showAlert(t('alertError'), t('ioImportFailed') + ': ' + e.message);
                } finally {
                  if (importedCsvUri) {
                    try { await FileSystem.deleteAsync(importedCsvUri, { idempotent: true }); } catch {}
                  }
                }
              }}>
                <Feather name="folder" size={20} color={theme.accent} style={{ marginBottom: 6 }} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>{t('ioImportCsvBtn')}</CustomText>
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
            
            <TouchableOpacity style={[styles.settingsCard, { marginTop: 10 }]} onPress={async () => {
              const blist = await getVaultBackups();
              setBackups(blist);
              setBackupModalVisible(true);
            }}>
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


            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('themeTitle')}</CustomText>
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20}}>
              {['dark', 'light', 'system'].map(m => (
                <TouchableOpacity key={m} style={[styles.settingsCard, { flex: 1, alignItems: 'center', borderColor: themeMode === m ? theme.accent : theme.border }]} onPress={() => changeTheme(m)}>
                  <CustomText style={{color: themeMode === m ? theme.accent : theme.text, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase'}}>{m === 'system' ? t('themeSystem') : m === 'dark' ? t('themeDark') : t('themeLight')}</CustomText>
                </TouchableOpacity>
              ))}
            </View>

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('langTitle')}</CustomText>
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20}}>
              {['tr', 'en'].map(l => (
                <TouchableOpacity key={l} style={[styles.settingsCard, { flex: 1, alignItems: 'center', borderColor: lang === l ? theme.accent : theme.border }]} onPress={() => setLang(l)}>
                  <CustomText style={{color: lang === l ? theme.accent : theme.text, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase'}}>{l === 'tr' ? 'TR' : 'EN'}</CustomText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Eşitleme & Cihazlar Bölümü */}
            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('settingSyncDevicesTitle')}</CustomText>
            
            {/* Eşleşmiş Masaüstü Kartı */}
            {pairingInfo ? (
              <View style={[styles.settingsCard, { marginBottom: 20 }]}>
                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8}}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1}}>
                    <Feather name="monitor" size={18} color={theme.text} />
                    <CustomText numberOfLines={1} style={{color: theme.text, fontSize: 13, fontWeight: 'bold', flex: 1}}>
                      {pairingInfo.deviceId || t('desktopDeviceDefault')}
                    </CustomText>
                  </View>
                  <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: isLight ? 'rgba(61,107,79,0.15)' : 'rgba(90,154,110,0.2)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12}}>
                    <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: theme.green, marginRight: 5}} />
                    <CustomText style={{color: theme.green, fontSize: 11, fontWeight: '600'}}>{t('deviceStatusReady')}</CustomText>
                  </View>
                </View>
                
                <CustomText style={{color: theme.muted, fontSize: 11, marginBottom: 12}}>
                  {pairingInfo.addresses && pairingInfo.addresses.length > 0 
                    ? pairingInfo.addresses.map(a => `${a}:${pairingInfo.port || 8765}`).join('  |  ') 
                    : `127.0.0.1:${pairingInfo.port || 8765}`}
                </CustomText>

                <View style={{flexDirection: 'row', gap: 10}}>
                  <TouchableOpacity 
                    style={{flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.border, paddingVertical: 9, borderRadius: 6}}
                    onPress={handleLanSyncPress}
                  >
                    <Feather name="refresh-cw" size={14} color={theme.accent} />
                    <CustomText style={{color: theme.accent, fontSize: 12, fontWeight: '600'}}>{t('btnSyncNow')}</CustomText>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)', borderWidth: 1, borderColor: theme.red, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 6}}
                    onPress={handleUnpairPress}
                  >
                    <Feather name="trash-2" size={14} color={theme.red} />
                    <CustomText style={{color: theme.red, fontSize: 12, fontWeight: '600'}}>{t('btnUnpairDevice')}</CustomText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={[styles.settingsCard, { marginBottom: 20, alignItems: 'center', paddingVertical: 18 }]}>
                <Feather name="monitor" size={26} color={theme.muted} style={{marginBottom: 8}} />
                <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold', marginBottom: 4}}>{t('noDesktopPaired')}</CustomText>
                <CustomText style={{color: theme.muted, fontSize: 11, textAlign: 'center', marginBottom: 14, paddingHorizontal: 12}}>
                  {t('pairDesktopHint')}
                </CustomText>
                <TouchableOpacity 
                  style={{flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 6}}
                  onPress={handlePairDesktopPress}
                >
                  <Feather name="camera" size={14} color={theme.bg} />
                  <CustomText style={{color: theme.bg, fontSize: 12, fontWeight: 'bold'}}>{t('btnPairDesktop')}</CustomText>
                </TouchableOpacity>
              </View>
            )}

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('bioSectionTitle')}</CustomText>
            <View style={[styles.settingsCard, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }]}>
              <View>
                <CustomText style={{color: theme.text, fontSize: 14, fontWeight: 'bold'}}>{t('bioFingerprintFaceId')}</CustomText>
                <CustomText style={{color: theme.muted, fontSize: 12, marginTop: 4}}>{t('bioNoPasswordSub')}</CustomText>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor={theme.bg}
              />
            </View>

            {autofillSupported && (
              <>
                <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('autofillTitle')}</CustomText>
                <View style={[styles.settingsCard, { marginBottom: 20 }]}>
                  <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8}}>
                    <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1}}>
                      <Feather name="zap" size={18} color={theme.text} />
                      <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold'}}>
                        {autofillEnabled ? t('autofillStatusActive') : t('autofillStatusInactive')}
                      </CustomText>
                    </View>
                    <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: autofillEnabled ? (isLight ? 'rgba(61,107,79,0.15)' : 'rgba(90,154,110,0.2)') : (isLight ? 'rgba(160,52,42,0.08)' : 'rgba(212,90,74,0.12)'), paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12}}>
                      <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: autofillEnabled ? theme.green : theme.red, marginRight: 5}} />
                      <CustomText style={{color: autofillEnabled ? theme.green : theme.red, fontSize: 11, fontWeight: '600'}}>
                        {autofillEnabled ? t('autofillStatusActive') : t('autofillStatusInactive')}
                      </CustomText>
                    </View>
                  </View>
                  <CustomText style={{color: theme.muted, fontSize: 12, marginBottom: 12}}>
                    {t('autofillDesc')}
                  </CustomText>
                  <TouchableOpacity
                    style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: autofillEnabled ? theme.paper : theme.accent, borderWidth: 1, borderColor: autofillEnabled ? theme.border : theme.accent, paddingVertical: 9, borderRadius: 6}}
                    onPress={async () => {
                      await autofillService.openSettings();
                      setTimeout(async () => {
                        const en = await autofillService.isEnabled();
                        setAutofillEnabled(en);
                      }, 1000);
                    }}
                  >
                    <Feather name="external-link" size={14} color={autofillEnabled ? theme.accent : theme.bg} />
                    <CustomText style={{color: autofillEnabled ? theme.accent : theme.bg, fontSize: 12, fontWeight: 'bold'}}>
                      {autofillEnabled ? t('autofillBtnSettings') : t('autofillBtnEnable')}
                    </CustomText>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('autoLockTitle')}</CustomText>
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap'}}>
              {[
                { label: t('time1m'), value: '60000' },
                { label: t('time2m'), value: '120000' },
                { label: t('time5m'), value: '300000' },
                { label: t('time15m'), value: '900000' }
              ].map(opt => (
                <TouchableOpacity key={opt.value} style={[styles.settingsCard, { paddingVertical: 10, paddingHorizontal: 16 }]} onPress={async () => {
                  const SecureStore = require('expo-secure-store');
                  await SecureStore.setItemAsync('fuin-bg-timeout', opt.value);
                  autofillService.syncVault(unprotectEntries(entries), parseInt(opt.value, 10)).catch(() => {});
                  showAlert(t('alertSaved'), t('autoLockSavedMsg').replace('{label}', opt.label));
                }}>
                  <CustomText style={{color: theme.text, fontSize: 12, fontWeight: 'bold'}}>{opt.label}</CustomText>
                </TouchableOpacity>
              ))}
            </View>

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('sysSecurityTitle')}</CustomText>
            <View style={styles.settingsCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <CustomText style={{color: theme.text, fontSize: 14, fontWeight: 'bold'}}>
                    Fuin Mobile v{updater.currentVersion}
                  </CustomText>
                  <CustomText style={{color: theme.muted, fontSize: 12, marginTop: 4}}>{t('sysLocalVaultActive')}</CustomText>
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
                      borderRadius: 4,
                      backgroundColor: updater.updateInfo ? theme.accent : 'transparent',
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
                <View style={{ marginTop: 10 }}>
                  <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
                    <View style={{ width: `${updater.verifying ? 100 : updater.progress.percent}%`, height: '100%', backgroundColor: theme.accent }} />
                  </View>
                  <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 5 }}>
                    {updater.verifying
                      ? t('updateVerifying')
                      : (t('updateDownloading') || 'İndiriliyor... %{percent}').replace('{percent}', String(updater.progress.percent))}
                  </CustomText>
                </View>
              ) : updater.statusMessage ? (
                <CustomText style={{ color: updater.updateInfo ? theme.accent : theme.muted, fontSize: 11, marginTop: 8 }}>
                  {updater.statusMessage}
                </CustomText>
              ) : null}
              
              <View style={{height: 1, backgroundColor: theme.border, marginVertical: 10}} />
              <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold', marginBottom: 5}}>{t('sysCryptoArchitecture')}</CustomText>
              <CustomText style={{color: theme.muted, fontSize: 11, lineHeight: 16}}>
                {t('sysCryptoDetails')}
              </CustomText>
            </View>

            <TouchableOpacity 
              activeOpacity={0.7}
              delayPressIn={0}
              style={[styles.settingsCard, { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]} 
              onPress={() => setWhatsNewModalVisible(true)}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="zap" size={14} color={theme.accent} />
                  <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>{t('whatsNewTitle') || 'Neler Yeni?'}</CustomText>
                </View>
                <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4, lineHeight: 16 }}>
                  {t('whatsNewSub') || 'Son sürümlerdeki güncellemeleri ve güvenlik iyileştirmelerini görüntüleyin.'}
                </CustomText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.settingsCard, { marginTop: 16, marginBottom: 40 }]} onPress={onLogout}>
              <CustomText style={{color: theme.red, fontSize: 14, fontWeight: '600'}}>{t('lockSessionBtn')}</CustomText>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
      {/* Edit/Add Modal */}
      <EditModal 
        visible={modalVisible} 
        entry={selectedEntry}
        allCategories={editableCategories}
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
            {t('tabLanSync') || 'Eşitle'}
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
  settingsCard: {
    backgroundColor: theme.card,
    padding: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
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

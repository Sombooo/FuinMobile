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
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { getVaultBackups, restoreVaultBackup } from '../storage';

import { Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';
import { copySecure } from '../clipboardManager';
import FuinImporters from '../services/importers';
import VaultCardItem from '../components/VaultCardItem';
import useVaultSearch from '../hooks/useVaultSearch';

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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(nextTab);
  };

  const switchCategorySmooth = (nextCat) => {
    if (activeCategory === nextCat) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveCategory(nextCat);
  };
  
  // Edit State
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [healthModalVisible, setHealthModalVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [backups, setBackups] = useState([]);

  // Show password state
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Sync & Pairing State
  const [syncMode, setSyncMode] = useState('lan');
  const [pairingInfo, setPairingInfo] = useState(null);

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
        username: '',
        password: '',
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


  const handleCopy = useCallback(async (text, label) => {
    const isPassword = label === t('fieldPassword');
    const duration = isPassword ? 45000 : 30000;
    await copySecure(text, duration);
    showAlert(t('alertCopied'), isPassword ? t('toastCopiedClipboard45s') : label + t('toastCopiedClipboard30s'));
  }, [t, showAlert]);

  const togglePasswordVisibility = useCallback((id) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  }, []);

  const handleSaveEntry = async (updatedEntry) => {
    let newEntries = [...entries];
    const finalEntries = newEntries || entries;
    const allCategories = [...DEFAULT_CATEGORIES];
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

  const openEditModal = useCallback((entry) => {
    setSelectedEntry(entry);
    setModalVisible(true);
  }, []);

  const handleOpenUrl = useCallback(async (rawUrl) => {
    try {
      let urlToOpen = (rawUrl || '').trim();
      if (!/^https?:\/\//i.test(urlToOpen)) {
        urlToOpen = 'https://' + urlToOpen;
      }
      const supported = await Linking.canOpenURL(urlToOpen);
      if (supported) {
        await Linking.openURL(urlToOpen);
      } else {
        showAlert(t('alertError'), t('toastGenericError') + ' (Geçersiz URL)');
      }
    } catch (error) {
      console.error("URL açılırken hata:", error);
      showAlert(t('alertError'), t('toastGenericError'));
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
        <TouchableOpacity onPress={onLogout}>
          <CustomText style={styles.logoutText}>{t('btnLogout')}</CustomText>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {activeTab === 'vault' ? (
          <>
            {/* Categories Scroll */}
            <View style={styles.categoriesWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
                {allCategories.map(cat => (
                  <TouchableOpacity 
                    key={cat} 
                    style={[styles.categoryBtn, activeCategory === cat && styles.categoryBtnActive]}
                    onPress={() => switchCategorySmooth(cat)}
                  >
                    <CustomText style={[styles.categoryText, activeCategory === cat && styles.categoryTextActive]}>
                      {cat}
                    </CustomText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Search Bar */}
            <View style={{ paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, backgroundColor: theme.paper }}>
              <CustomTextInput
                style={{ backgroundColor: theme.bg, color: theme.text, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
                placeholder={t('searchPlaceholderVault')}
                placeholderTextColor={theme.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {/* List */}
            <FlatList
              data={filteredEntries}
              keyExtractor={(item) => item.id || Math.random().toString()}
              renderItem={renderItem}
              contentContainerStyle={styles.listContainer}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
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
          <ScrollView style={styles.settingsWrap}>

            
            {/* Old JSON block removed */}

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('ioTitle')}</CustomText>
            
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
              <TouchableOpacity style={[styles.settingsCard, { flex: 1, alignItems: 'center' }]} onPress={async () => {
                try {
                  const { StorageAccessFramework } = FileSystem;
                  const jsonStr = JSON.stringify(parsedVault, null, 2);
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
                    const row = [e.site, e.url, e.username, e.password, e.note, e.category, e.totp]
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
          <ScrollView style={styles.settingsWrap}>


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

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('autoLockTitle')}</CustomText>
            <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap'}}>
              {[
                { label: t('time1m'), value: '60000' },
                { label: t('time2m'), value: '120000' },
                { label: t('time5m'), value: '300000' },
                { label: t('time15m'), value: '900000' }
              ].map(opt => (
                <TouchableOpacity key={opt.value} style={[styles.settingsCard, { paddingVertical: 10, paddingHorizontal: 15 }]} onPress={async () => {
                  const SecureStore = require('expo-secure-store');
                  await SecureStore.setItemAsync('fuin-bg-timeout', opt.value);
                  showAlert(t('alertSaved'), t('autoLockSavedMsg').replace('{label}', opt.label));
                }}>
                  <CustomText style={{color: theme.text, fontSize: 12, fontWeight: 'bold'}}>{opt.label}</CustomText>
                </TouchableOpacity>
              ))}
            </View>

            <CustomText style={[styles.settingsTitle, {fontSize: 14, color: theme.muted, marginTop: 10}]}>{t('sysSecurityTitle')}</CustomText>
            <View style={styles.settingsCard}>
              <CustomText style={{color: theme.text, fontSize: 14, fontWeight: 'bold'}}>FuinMobile v1.0.0</CustomText>
              <CustomText style={{color: theme.muted, fontSize: 12, marginTop: 4}}>{t('sysLocalVaultActive')}</CustomText>
              
              <View style={{height: 1, backgroundColor: theme.border, marginVertical: 10}} />
              <CustomText style={{color: theme.text, fontSize: 13, fontWeight: 'bold', marginBottom: 5}}>{t('sysCryptoArchitecture')}</CustomText>
              <CustomText style={{color: theme.muted, fontSize: 11, lineHeight: 16}}>
                {t('sysCryptoDetails')}
              </CustomText>
            </View>
            <TouchableOpacity style={[styles.settingsCard, { marginTop: 15, marginBottom: 40 }]} onPress={onLogout}>
              <CustomText style={{color: theme.red, fontSize: 14, fontWeight: '600'}}>{t('lockSessionBtn')}</CustomText>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
      {/* Edit/Add Modal */}
      <EditModal 
        visible={modalVisible} 
        entry={selectedEntry}
        allCategories={allCategories.filter(c => c !== t('cat_all') && c !== t('cat_fav') && c !== t('cat_trash'))}
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

      {/* Bottom Navigation Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 20 }]}>
        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('vault')}>
          <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'vault' ? theme.accent : theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <Polyline points="9 22 9 12 15 12 15 22" />
          </Svg>
          <CustomText style={[styles.navText, activeTab === 'vault' && styles.navTextActive]}>{t('tabVault')}</CustomText>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.navBtn} 
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

        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('tools')}>
          <Feather name="tool" size={22} color={activeTab === 'tools' ? theme.accent : theme.muted} />
          <CustomText style={[styles.navText, activeTab === 'tools' && styles.navTextActive]}>{t('tabTools')}</CustomText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => switchTabSmooth('settings')}>
          <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'settings' ? theme.accent : theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="3" />
            <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </Svg>
          <CustomText style={[styles.navText, activeTab === 'settings' && styles.navTextActive]}>{t('tabSettings')}</CustomText>
        </TouchableOpacity>
      </View>

      {/* Backup Restore Modal */}
      <Modal visible={backupModalVisible} transparent animationType="slide" onRequestClose={() => setBackupModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: Platform.OS === 'ios' ? 40 : StatusBar.currentHeight }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity 
              onPress={() => setBackupModalVisible(false)} 
              style={{ padding: 10, marginLeft: -10 }} 
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <CustomText style={{ color: theme.text, fontSize: 28, lineHeight: 28 }}>×</CustomText>
            </TouchableOpacity>
            <CustomText style={{ flex: 1, textAlign: 'center', color: theme.text, fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>{t('backupModalTitle')}</CustomText>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <CustomText style={{ color: theme.muted, fontSize: 13, marginBottom: 20, lineHeight: 20 }}>
              {t('backupModalDesc')}
            </CustomText>
            
            {backups.length === 0 ? (
              <CustomText style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}>{t('backupEmpty')}</CustomText>
            ) : (
              backups.map(b => {
                const date = new Date(b.timestamp);
                const isToday = new Date().toDateString() === date.toDateString();
                const dStr = isToday ? t('dateToday') + date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
                
                return (
                  <TouchableOpacity key={b.fileName} style={[styles.settingsCard, { marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]} onPress={() => {
                    showAlert(t('alertRestoreTitle'), `${dStr}${t('alertRestoreBody')}`, [
                      { text: t('btnCancel'), style: 'cancel' },
                      { text: t('btnRestoreConfirm'), style: 'destructive', onPress: async () => {
                        const success = await restoreVaultBackup(b.fileName);
                        if (success) {
                          showAlert(t('alertSuccess'), t('alertRestoreSuccessRelogin'));
                          setBackupModalVisible(false);
                          onLogout();
                        } else {
                          showAlert(t('alertError'), t('alertRestoreFailed'));
                        }
                      }}
                    ]);
                  }}>
                    <View>
                      <CustomText style={{ color: theme.text, fontSize: 15, fontWeight: 'bold' }}>{dStr}</CustomText>
                      <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>{b.fileName}</CustomText>
                    </View>
                    <CustomText style={{ color: theme.accent, fontWeight: 'bold' }}>{t('btnRestoreAction')}</CustomText>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
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
    paddingVertical: 15,
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
    paddingHorizontal: 15,
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
    gap: 15,
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

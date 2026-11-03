import CustomText from '../components/CustomText';
import React, { useState, useEffect, useRef } from 'react';
import { View, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Platform, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';
import crypto from 'react-native-quick-crypto';
import { memDecrypt } from '../services/sessionSecurity';

const HIBP_TIMEOUT_MS = 8000;
const HIBP_MAX_RESPONSE_CHARS = 262144;

export default function HealthModal({ visible, entries, onClose }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentSite: '' });
  const scanSessionRef = useRef(0);
  const activeAbortRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      scanSessionRef.current += 1;
      if (activeAbortRef.current) {
        try { activeAbortRef.current.abort(); } catch {}
        activeAbortRef.current = null;
      }
      setScanResults(null);
      setScanning(false);
      setProgress({ current: 0, total: 0, currentSite: '' });
    }
    return () => {
      scanSessionRef.current += 1;
      if (activeAbortRef.current) {
        try { activeAbortRef.current.abort(); } catch {}
        activeAbortRef.current = null;
      }
    };
  }, [visible]);

  const checkPwned = async (pw) => {
    if (!pw) return 0;
    const hash = crypto.createHash('sha1').update(pw, 'utf8').digest('hex').toUpperCase();
    const pre = hash.slice(0, 5);
    const suf = hash.slice(5);
    if (!/^[0-9A-F]{5}$/.test(pre)) return -1;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortRef.current = controller;
    const timer = controller ? setTimeout(() => {
      try { controller.abort(); } catch {}
    }, HIBP_TIMEOUT_MS) : null;

    try {
      const r = await fetch(`https://api.pwnedpasswords.com/range/${pre}`, {
        cache: 'no-store',
        headers: { 'Add-Padding': 'true' },
        signal: controller ? controller.signal : undefined
      });
      if (!r.ok) return -1;
      if (r.url && !r.url.startsWith('https://api.pwnedpasswords.com/')) return -1;
      const text = await r.text();
      if (typeof text !== 'string' || text.length > HIBP_MAX_RESPONSE_CHARS) return -1;
      const lines = text.split('\n');
      for (const line of lines) {
        const [hh, c] = line.trim().split(':');
        if (hh === suf) {
          const parsedCount = parseInt(c, 10);
          return Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : -1;
        }
      }
      return 0;
    } catch {
      return -1;
    } finally {
      if (timer) clearTimeout(timer);
      if (activeAbortRef.current === controller) {
        activeAbortRef.current = null;
      }
    }
  };

  const startScan = async () => {
    const sessionId = ++scanSessionRef.current;
    setScanning(true);
    const passwordEntries = (Array.isArray(entries) ? entries : []).filter(e => e && !e.isDeleted && !e.deletedAt && e.password);
    const results = { breached: [], clean: 0, errors: 0 };
    
    for (let i = 0; i < passwordEntries.length; i++) {
      if (scanSessionRef.current !== sessionId) return;
      const e = passwordEntries[i];
      setProgress({ current: i + 1, total: passwordEntries.length, currentSite: e.site || t('hibpUnknown') });
      const rawPw = typeof e.password === 'object' ? memDecrypt(e.password) : String(e.password || '');
      const count = await checkPwned(rawPw);
      if (scanSessionRef.current !== sessionId) return;
      if (count > 0) {
        results.breached.push({ site: e.site, username: e.username, count });
      } else if (count === 0) {
        results.clean++;
      } else {
        results.errors++;
      }
    }
    if (scanSessionRef.current !== sessionId) return;
    results.breached.sort((a, b) => b.count - a.count);
    setScanResults(results);
    setScanning(false);
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: Platform.OS === 'ios' ? 40 : StatusBar.currentHeight }}>
        {/* Header — same as Sistem Yedekleri */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity 
            onPress={onClose} 
            style={{ padding: 10, marginLeft: -10 }} 
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            delayPressIn={0}
          >
            <CustomText style={{ color: theme.text, fontSize: 28, lineHeight: 28 }}>×</CustomText>
          </TouchableOpacity>
          <CustomText style={{ flex: 1, textAlign: 'center', color: theme.text, fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>{t('healthTitle')}</CustomText>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={{ flex: 1, padding: 20 }} keyboardShouldPersistTaps="handled">
          {/* Info Card */}
          <View style={{
            backgroundColor: theme.card,
            padding: 20,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: theme.border,
            marginBottom: 20,
          }}>
            <CustomText style={{ color: theme.accent, fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>{t('healthKAnonymityTitle')}</CustomText>
            <CustomText style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
              {t('healthInfoBox')}
            </CustomText>
          </View>

          {/* Scan Button */}
          {!scanResults && !scanning && (
            <TouchableOpacity 
              style={{
                backgroundColor: theme.accent,
                padding: 16,
                borderRadius: 4,
                alignItems: 'center',
                marginBottom: 20,
              }} 
              onPress={startScan}
            >
              <CustomText style={{ color: theme.bg, fontWeight: 'bold', fontSize: 15, letterSpacing: 1 }}>{t('healthScanBtn')}</CustomText>
            </TouchableOpacity>
          )}

          {/* Scanning Progress */}
          {scanning && (
            <View style={{
              backgroundColor: theme.card,
              padding: 24,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: 'center',
              marginBottom: 20,
            }}>
              <ActivityIndicator size="large" color={theme.accent} style={{ marginBottom: 16 }} />
              <CustomText style={{ color: theme.accent, fontSize: 28, fontWeight: 'bold', marginBottom: 8 }}>{progressPercent}%</CustomText>
              <CustomText style={{ color: theme.text, fontSize: 14, marginBottom: 4 }}>
                {progress.current} / {progress.total}
              </CustomText>
              <CustomText style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>
                {progress.currentSite}
              </CustomText>
            </View>
          )}

          {/* Results */}
          {scanResults && !scanning && (
            <>
              {scanResults.breached.length > 0 ? (
                <>
                  {/* Warning Card */}
                  <View style={{
                    backgroundColor: theme.card,
                    padding: 20,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: 'rgba(255,80,80,0.3)',
                    marginBottom: 16,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="alert-triangle" size={18} color={theme.red} style={{ marginRight: 8 }} />
                      <CustomText style={{ color: theme.red, fontSize: 16, fontWeight: 'bold', textAlign: 'center' }}>
                        {scanResults.breached.length}{t('hibpBreachedWarning')}
                      </CustomText>
                    </View>
                    {scanResults.clean > 0 && (
                      <CustomText style={{ color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                        {scanResults.clean}{t('hibpCleanCount')}
                      </CustomText>
                    )}
                    {scanResults.errors > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
                        <Feather name="alert-circle" size={13} color={theme.muted} style={{ marginRight: 5 }} />
                        <CustomText style={{ color: theme.muted, fontSize: 11, textAlign: 'center' }}>
                          {scanResults.errors}{t('hibpNetworkError')}
                        </CustomText>
                      </View>
                    )}
                  </View>

                  {/* Breached Items — card style like backups */}
                  {scanResults.breached.map((b, i) => (
                    <View key={i} style={{
                      backgroundColor: theme.card,
                      padding: 20,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: theme.border,
                      marginBottom: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <CustomText style={{ color: theme.text, fontSize: 15, fontWeight: 'bold' }}>{b.site}</CustomText>
                        {b.username ? <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>{b.username}</CustomText> : null}
                      </View>
                      <CustomText style={{ color: theme.red, fontWeight: 'bold', fontSize: 13 }}>{b.count.toLocaleString('tr-TR')}×</CustomText>
                    </View>
                  ))}
                </>
              ) : (
                <View style={{
                  backgroundColor: theme.card,
                  padding: 30,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: 'rgba(61,107,79,0.3)',
                  alignItems: 'center',
                }}>
                  <Feather name="check-circle" size={44} color={theme.green || theme.accent} style={{ marginBottom: 14 }} />
                  <CustomText style={{ color: theme.green || theme.accent, fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>{t('hibpCleanCongrats')}</CustomText>
                  <CustomText style={{ color: theme.text, textAlign: 'center', fontSize: 14, lineHeight: 22 }}>
                    {t('hibpAllClean')}
                  </CustomText>
                  {scanResults.errors > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
                      <Feather name="alert-circle" size={13} color={theme.muted} style={{ marginRight: 5 }} />
                      <CustomText style={{ color: theme.muted, fontSize: 11 }}>
                        {scanResults.errors}{t('hibpNetworkError')}
                      </CustomText>
                    </View>
                  )}
                </View>
              )}

              {/* Scan Again */}
              <TouchableOpacity 
                style={{
                  backgroundColor: 'transparent',
                  padding: 16,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: theme.border,
                  alignItems: 'center',
                  marginTop: 16,
                  marginBottom: 40,
                }} 
                onPress={startScan}
              >
                <CustomText style={{ color: theme.text, fontWeight: '600', fontSize: 14, letterSpacing: 1 }}>{t('healthScanAgain')}</CustomText>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

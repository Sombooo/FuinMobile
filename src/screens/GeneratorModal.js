import CustomText from '../components/CustomText';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Switch, SafeAreaView, Platform, StatusBar, Animated, Alert } from 'react-native';
import { useTheme } from '../theme';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';

export default function GeneratorModal({ visible, onClose, onApply }) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const { t } = useI18n();
  const { showAlert } = useAlert();
  const [length, setLength] = useState(16);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useNumbers, setUseNumbers] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [excludeSimilar, setExcludeSimilar] = useState(true);

  const clipboardTimer = useRef(null);

  const [generatedPassword, setGeneratedPassword] = useState('');
  const [strength, setStrength] = useState('weak');
  const spinValue = useRef(new Animated.Value(0)).current;

  const generate = () => {
    let charset = '';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    const similar = 'il1Lo0O';

    if (useUpper) charset += upper;
    if (useLower) charset += lower;
    if (useNumbers) charset += numbers;
    if (useSymbols) charset += symbols;

    if (excludeSimilar) {
      charset = charset.split('').filter(c => !similar.includes(c)).join('');
    }

    if (!charset) {
      setGeneratedPassword('');
      setStrength('weak');
      return;
    }

    const crypto = require('react-native-quick-crypto');
    let pwd = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      pwd += charset.charAt(randomBytes[i] % charset.length);
    }
    setGeneratedPassword(pwd);

    // Calculate strength
    let score = 0;
    if (pwd.length >= 12) score += 1;
    if (pwd.length >= 16) score += 1;
    if (useUpper) score += 1;
    if (useNumbers) score += 1;
    if (useSymbols) score += 1;

    if (score >= 4) setStrength('strong');
    else if (score >= 2) setStrength('medium');
    else setStrength('weak');

    // Spin animation
    spinValue.setValue(0);
    Animated.timing(spinValue, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true
    }).start();
  };

  useEffect(() => {
    if (visible) generate();
  }, [visible, length, useUpper, useLower, useNumbers, useSymbols, excludeSimilar]);

  const copyToClipboard = async () => {
    if (generatedPassword) {
      await Clipboard.setStringAsync(generatedPassword);
      showAlert(t('alertCopied'), t('toastCopiedClipboard45s'));
      
      // Save copy time so AppState listener can clear it if app goes to background
      const SecureStore = require('expo-secure-store');
      await SecureStore.setItemAsync('fuin-clipboard-time', Date.now().toString());

      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      clipboardTimer.current = setTimeout(async () => {
        await Clipboard.setStringAsync('');
        clipboardTimer.current = null;
      }, 45000);
    }
  };

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <CustomText style={styles.cancelText}>{t('genCancel')}</CustomText>
          </TouchableOpacity>
          <CustomText style={styles.headerTitle}>{t('genTitle')}</CustomText>
          <TouchableOpacity onPress={() => onApply(generatedPassword)}>
            <CustomText style={styles.saveText}>{t('genApply')}</CustomText>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.resultBox}>
            <CustomText style={styles.pwdText} numberOfLines={1} ellipsizeMode="middle" selectable>{generatedPassword}</CustomText>
            <View style={styles.actionBox}>
              <TouchableOpacity style={styles.iconBtn} onPress={copyToClipboard}>
                <Feather name="copy" size={16} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={generate}>
                <Animated.View style={{transform: [{rotate: spin}]}}>
                  <Feather name="refresh-cw" size={16} color={theme.text} />
                </Animated.View>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.strengthBar}>
            <View style={[styles.strengthFill, { width: strength === 'weak' ? '33%' : strength === 'medium' ? '66%' : '100%', backgroundColor: strength === 'weak' ? theme.red : strength === 'medium' ? 'orange' : theme.accent }]} />
          </View>
          <CustomText style={styles.strengthLabel}>
            {t('strengthLabel')} {strength === 'weak' ? t('strengthWeak') : strength === 'medium' ? t('strengthMedium') : t('strengthStrong')}
          </CustomText>

          <View style={styles.settingsBox}>
            <View style={[styles.row, {flexDirection: 'column', alignItems: 'stretch', gap: 10}]}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                <CustomText style={styles.label}>{t('genLength')}</CustomText>
                <CustomText style={{color: theme.accent, fontWeight: 'bold'}}>{length}</CustomText>
              </View>
              <Slider
                style={{width: '100%', height: 40}}
                minimumValue={6}
                maximumValue={64}
                step={1}
                value={length}
                onValueChange={setLength}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
                thumbTintColor={theme.accent}
              />
            </View>

            <View style={styles.row}>
              <CustomText style={styles.label}>{t('genUpper')}</CustomText>
              <Switch value={useUpper} onValueChange={setUseUpper} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('genLower')}</CustomText>
              <Switch value={useLower} onValueChange={setUseLower} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('genNum')}</CustomText>
              <Switch value={useNumbers} onValueChange={setUseNumbers} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('genSym')}</CustomText>
              <Switch value={useSymbols} onValueChange={setUseSymbols} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('genExc')}</CustomText>
              <Switch value={excludeSimilar} onValueChange={setExcludeSimilar} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderColor: theme.border },
  headerTitle: { color: theme.text, fontSize: 15, fontWeight: 'bold', letterSpacing: 1 },
  cancelText: { color: theme.muted, fontSize: 14 },
  saveText: { color: theme.accent, fontSize: 14, fontWeight: 'bold' },
  content: { padding: 20 },
  resultBox: { position: 'relative', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.15)', borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 18, paddingLeft: 15, paddingRight: 90, marginBottom: 15 },
  pwdText: { color: theme.text, fontSize: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: 'bold' },
  actionBox: { position: 'absolute', right: 10, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  strengthBar: { height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  strengthFill: { height: '100%', borderRadius: 3 },
  strengthLabel: { color: theme.muted, fontSize: 12, textAlign: 'center', marginBottom: 30 },
  settingsBox: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border2 },
  label: { color: theme.text, fontSize: 13 },
  btnSmall: { backgroundColor: theme.border, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnSmallText: { color: theme.text, fontSize: 18, fontWeight: 'bold', marginTop: -2 }
});

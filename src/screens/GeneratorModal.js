import CustomText from '../components/CustomText';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Switch, SafeAreaView, Platform, StatusBar, Animated, Alert } from 'react-native';
import { useTheme } from '../theme';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';
import { copySecure } from '../clipboardManager';
import { generatePassword } from '../services/passwordGenerator';

export default function GeneratorModal({ visible, onClose, onApply }) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const { t, lang } = useI18n();
  const { showAlert } = useAlert();
  const [length, setLength] = useState(16);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useNumbers, setUseNumbers] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [excludeSimilar, setExcludeSimilar] = useState(true);

  const [generatedPassword, setGeneratedPassword] = useState('');
  const [strengthInfo, setStrengthInfo] = useState({
    score: 0,
    percent: 20,
    entropy: 0,
    crackTime: 'less than a second',
    crackTimeTr: '1 saniyeden az'
  });
  const spinValue = useRef(new Animated.Value(0)).current;

  const generate = () => {
    const res = generatePassword({
      length: length,
      includeUpper: useUpper,
      includeLower: useLower,
      includeDigits: useNumbers,
      includeSymbols: useSymbols,
      excludeSimilar: excludeSimilar
    });

    if (!res.password) {
      setGeneratedPassword('');
      setStrengthInfo({
        score: 0,
        percent: 0,
        entropy: 0,
        crackTime: 'less than a second',
        crackTimeTr: '1 saniyeden az'
      });
      return;
    }

    setGeneratedPassword(res.password);
    setStrengthInfo({
      score: res.score ?? 0,
      percent: res.percent ?? 20,
      entropy: res.entropy ?? 0,
      crackTime: res.crackTime || 'less than a second',
      crackTimeTr: res.crackTimeTr || '1 saniyeden az'
    });

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
      await copySecure(generatedPassword, 45000);
      showAlert(t('alertCopied'), t('toastCopiedClipboard45s'));
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
            <View
              style={[
                styles.strengthFill,
                {
                  width: `${strengthInfo.percent || 0}%`,
                  backgroundColor:
                    strengthInfo.score === 0
                      ? theme.red
                      : strengthInfo.score === 1
                      ? '#e67e22'
                      : strengthInfo.score === 2
                      ? '#f1c40f'
                      : strengthInfo.score === 3
                      ? '#5cb85c'
                      : theme.accent
                }
              ]}
            />
          </View>
          <View style={styles.strengthMetaRow}>
            <CustomText
              style={[
                styles.strengthTierText,
                {
                  color:
                    strengthInfo.score === 0
                      ? theme.red
                      : strengthInfo.score === 1
                      ? '#e67e22'
                      : strengthInfo.score === 2
                      ? '#f1c40f'
                      : strengthInfo.score === 3
                      ? '#5cb85c'
                      : theme.accent
                }
              ]}
            >
              {t('strengthLabel')}
              {strengthInfo.score === 0
                ? t('strengthVeryWeak')
                : strengthInfo.score === 1
                ? t('strengthWeak')
                : strengthInfo.score === 2
                ? t('strengthMedium')
                : strengthInfo.score === 3
                ? t('strengthStrong')
                : t('strengthVeryStrong')}
            </CustomText>
            <CustomText style={styles.strengthCrackText}>
              {Math.round(strengthInfo.entropy || 0)} {t('strengthBitsUnit')} · {t('strengthCrackPrefix')}{' '}
              {lang === 'en' ? strengthInfo.crackTime : strengthInfo.crackTimeTr}
            </CustomText>
          </View>

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
  strengthMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 8 },
  strengthTierText: { fontSize: 12, fontWeight: 'bold' },
  strengthCrackText: { color: theme.muted, fontSize: 11 },
  strengthLabel: { color: theme.muted, fontSize: 12, textAlign: 'center', marginBottom: 30 },
  settingsBox: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border2 },
  label: { color: theme.text, fontSize: 13 },
  btnSmall: { backgroundColor: theme.border, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnSmallText: { color: theme.text, fontSize: 18, fontWeight: 'bold', marginTop: -2 }
});

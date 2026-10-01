import CustomTextInput from '../components/CustomTextInput';
import CustomText from '../components/CustomText';
import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform, StatusBar, Alert, Modal } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTheme } from '../theme';
import { clearVault } from '../storage';
import * as SecureStore from 'expo-secure-store';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';
import { Buffer } from '@craftzdog/react-native-buffer';

export default function LockScreen({ password, setPassword, onLogin, onSync, onCreateVault, onVaultErased, hasVault }) {
  const { theme, themeMode } = useTheme();
  const styles = getStyles(theme);
  const toast = useToast();
  const { showAlert } = useAlert();
  const { t } = useI18n();
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [recoveryModalVisible, setRecoveryModalVisible] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [resetModalVisible, setResetModalVisible] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState('');

  const handleErase = () => {
    setResetConfirmInput('');
    setResetModalVisible(true);
  };

  const confirmErase = async () => {
    if (resetConfirmInput === t('hardResetConfirmWord')) {
      setResetModalVisible(false);
      await clearVault();
      onVaultErased();
    }
  };

  const handleCreate = () => {
    if (!password || password.length < 8) {
      showAlert(t('alertError'), t('toastMin8Chars'));
      return;
    }
    if (password !== confirmPassword) {
      showAlert(t('alertError'), t('toastPasswordsDoNotMatch'));
      return;
    }
    onCreateVault(password);
  };

  const handleRecovery = async () => {
    try {
      const crypto = require('react-native-quick-crypto');
      const savedHashHex = await SecureStore.getItemAsync('fuin-recovery-code-hash');
      const encryptedPassB64 = await SecureStore.getItemAsync('fuin-recovery-data');
      
      // Legacy fallback just in case the user hasn't updated their vault yet
      const legacyKey = await SecureStore.getItemAsync('fuin-recovery-code');
      const legacyPass = await SecureStore.getItemAsync('fuin-recovery-pass');
      
      if (!savedHashHex && !legacyKey) {
        toast.showToast(t('toastNoRecoveryFound'));
        return;
      }
      
      const input = recoveryInput.trim().toUpperCase();
      let isMatch = false;
      let recoveredPassword = null;

      if (savedHashHex && encryptedPassB64) {
        const inputHash = crypto.createHash('sha256').update(input).digest();
        const targetHash = Buffer.from(savedHashHex, 'hex');
        
        if (inputHash.length === targetHash.length && crypto.timingSafeEqual(inputHash, targetHash)) {
          isMatch = true;
          // Decrypt the password
          const { deriveLocalKey } = require('../crypto');
          const payload = Buffer.from(encryptedPassB64, 'base64');
          const recoverySalt = payload.subarray(0, 32);
          const iv = payload.subarray(32, 44);
          const authTag = payload.subarray(44, 60);
          const ciphertext = payload.subarray(60);
          
          const recoveryKey = await deriveLocalKey(input, recoverySalt);
          const decipher = crypto.createDecipheriv('aes-256-gcm', recoveryKey, iv);
          decipher.setAuthTag(authTag);
          let dec = decipher.update(ciphertext);
          dec = Buffer.concat([dec, decipher.final()]);
          recoveredPassword = dec.toString('utf8');
        }
      } else if (legacyKey && legacyPass) {
        const inputHash = crypto.createHash('sha256').update(input).digest();
        const targetHash = crypto.createHash('sha256').update(legacyKey.toUpperCase()).digest();
        if (inputHash.length === targetHash.length && crypto.timingSafeEqual(inputHash, targetHash)) {
          isMatch = true;
          recoveredPassword = legacyPass;
        }
      }
      
      if (isMatch && recoveredPassword) {
        setPassword(recoveredPassword);
        setRecoveryModalVisible(false);
        toast.showToast(t('toastPasswordRestored'));
      } else {
        toast.showToast(t('toastInvalidRecoveryKey'));
      }
    } catch (e) {
      toast.showToast(t('toastGenericError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={themeMode === 'light' ? 'dark-content' : 'light-content'} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.centerBox}>
          {/* Logo & Title */}
          <View style={styles.lockHead}>
            <Svg width="48" height="48" viewBox="0 0 38 38" fill="none" style={styles.logoSvg}>
              <Polygon points="19,2 35,10.5 35,27.5 19,36 3,27.5 3,10.5" stroke={theme.text} strokeWidth="1.5" fill="none" />
            </Svg>
            <CustomText style={styles.title}>FUIN</CustomText>
            <View style={styles.rule} />
            <CustomText style={styles.subtitle}>QUIETLY SECURE</CustomText>
          </View>

          {/* Input Boxes */}
          <View style={styles.inputWrap}>
            <CustomText style={styles.fieldLabel}>
              {hasVault ? t('lockMasterLabel') : t('lockNewMasterLabel')}
            </CustomText>
            <View style={styles.passwordContainer}>
              <CustomTextInput
                style={[styles.input, { flex: 1, borderRightWidth: 0 }]}
                placeholder="••••••••••••"
                placeholderTextColor={theme.border2}
                secureTextEntry={!isPasswordVisible}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity 
                style={styles.eyeBtn}
                onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                activeOpacity={0.7}
              >
                <View style={[styles.dotIcon, isPasswordVisible && { backgroundColor: theme.text }]} />
              </TouchableOpacity>
            </View>

            {!hasVault && (
              <>
                <CustomText style={[styles.fieldLabel, { marginTop: 15 }]}>{t('lockConfirmPasswordLabel')}</CustomText>
                <View style={styles.passwordContainer}>
                  <CustomTextInput
                    style={[styles.input, { flex: 1, borderRightWidth: 0 }]}
                    placeholder="••••••••••••"
                    placeholderTextColor={theme.border2}
                    secureTextEntry={!isConfirmVisible}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity 
                    style={styles.eyeBtn}
                    onPress={() => setIsConfirmVisible(!isConfirmVisible)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.dotIcon, isConfirmVisible && { backgroundColor: theme.text }]} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* Buttons */}
          <View style={styles.buttonGroup}>
            {hasVault ? (
              <TouchableOpacity style={styles.btnPrimary} onPress={() => onLogin(password)} activeOpacity={0.8}>
                <CustomText style={styles.btnPrimaryText}>{t('lockUnlockBtn')}</CustomText>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate} activeOpacity={0.8}>
                <CustomText style={styles.btnPrimaryText}>{t('lockCreateVaultBtn')}</CustomText>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.btnSecondary} onPress={onSync} activeOpacity={0.8}>
              <CustomText style={styles.btnSecondaryText}>{t('lockAirGapSyncBtn')}</CustomText>
            </TouchableOpacity>
          </View>

          {/* Erase / Forgot Password */}
          {hasVault && (
            <View style={styles.forgotContainer}>
              <TouchableOpacity style={styles.btnForgot} onPress={() => setRecoveryModalVisible(true)}>
                <CustomText style={styles.btnForgotText}>{t('lockForgot')}</CustomText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnForgot} onPress={handleErase}>
                <CustomText style={[styles.btnForgotText, { color: 'var(--red)', textDecorationLine: 'underline', textDecorationColor: 'var(--red)' }]}>{t('lockHardReset')}</CustomText>
              </TouchableOpacity>
            </View>
          )}

          <CustomText style={styles.hintText}>
            {t('lockHintFirstUse')}{"\n"}{t('lockHintPrefix')}<CustomText style={{color: theme.accent}}>{t('lockHintLocalOnly')}</CustomText>{t('lockHintLocalOnlySuffix')}
          </CustomText>
        </View>
      </KeyboardAvoidingView>

      {/* Recovery Modal */}
      <Modal visible={recoveryModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <CustomText style={styles.modalTitle}>{t('recoveryModalTitle')}</CustomText>
            <CustomText style={styles.modalDesc}>{t('recoveryModalDesc')}</CustomText>
            <CustomTextInput
              style={styles.modalInput}
              placeholder="A1B2-C3D4-E5F6-G7H8"
              placeholderTextColor={theme.border2}
              value={recoveryInput}
              onChangeText={setRecoveryInput}
              autoCapitalize="characters"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.btnSecondary, { flex: 1, marginRight: 10 }]} onPress={() => setRecoveryModalVisible(false)}>
                <CustomText style={styles.btnSecondaryText}>{t('btnCancelUpper')}</CustomText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleRecovery}>
                <CustomText style={styles.btnPrimaryText}>{t('btnRecoverUpper')}</CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hard Reset Modal */}
      <Modal visible={resetModalVisible} transparent animationType="fade" onRequestClose={() => setResetModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <CustomText style={[styles.modalTitle, { color: theme.red }]}>{t('hardResetTitle')}</CustomText>
            <CustomText style={[styles.modalDesc, { color: theme.red, fontWeight: '600', lineHeight: 20 }]}>
              {t('hardResetBody')}
            </CustomText>
            <CustomText style={[styles.modalDesc, { marginBottom: 12 }]}>
              {t('hardResetConfirmHint')}
            </CustomText>
            <CustomTextInput
              style={[styles.modalInput, { 
                borderColor: resetConfirmInput === t('hardResetConfirmWord') ? theme.red : theme.border,
              }]}
              placeholder={t('hardResetConfirmPh')}
              placeholderTextColor={theme.border2}
              value={resetConfirmInput}
              onChangeText={setResetConfirmInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.btnSecondary, { flex: 1, marginRight: 10 }]} onPress={() => setResetModalVisible(false)}>
                <CustomText style={styles.btnSecondaryText}>{t('btnCancelUpper')}</CustomText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btnPrimary, { 
                  flex: 1, 
                  backgroundColor: resetConfirmInput === t('hardResetConfirmWord') ? theme.red : theme.border,
                }]} 
                onPress={confirmErase}
                disabled={resetConfirmInput !== t('hardResetConfirmWord')}
              >
                <CustomText style={[styles.btnPrimaryText, { color: '#fff' }]}>{t('hardResetBtn')}</CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  keyboardView: {
    flex: 1,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  lockHead: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoSvg: {
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: 5,
    color: theme.text,
  },
  rule: {
    width: 32,
    height: 1,
    backgroundColor: theme.border2,
    marginVertical: 12,
  },
  subtitle: {
    fontSize: 11,
    color: theme.muted,
    letterSpacing: 2,
  },
  inputWrap: {
    width: '100%',
    marginBottom: 24,
  },
  fieldLabel: {
    fontSize: 11,
    color: theme.text,
    letterSpacing: 2,
    marginBottom: 8,
    fontWeight: '600',
    alignSelf: 'flex-start',
  },
  passwordContainer: {
    flexDirection: 'row',
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 2,
    backgroundColor: theme.bg,
  },
  input: {
    height: '100%',
    paddingHorizontal: 16,
    fontSize: 15,
    color: theme.text,
    textAlign: 'left',
  },
  eyeBtn: {
    width: 50,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: theme.border,
  },
  dotIcon: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.text,
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
    marginBottom: 20,
  },
  btnPrimary: {
    width: '100%',
    height: 48,
    backgroundColor: theme.accent,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
  },
  btnSecondary: {
    width: '100%',
    height: 48,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  forgotContainer: {
    marginTop: 10,
    marginBottom: 20,
    alignItems: 'center',
    gap: 12,
  },
  btnForgotText: {
    color: theme.muted,
    fontSize: 12,
    textDecorationLine: 'underline',
    letterSpacing: 1,
  },
  hintText: {
    fontSize: 11,
    color: theme.text,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
  },
  modalTitle: {
    fontSize: 16,
    color: theme.text,
    letterSpacing: 2,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalDesc: {
    fontSize: 12,
    color: theme.muted,
    lineHeight: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 2,
    paddingHorizontal: 16,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.bg,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalBtnRow: {
    flexDirection: 'row',
  }
});

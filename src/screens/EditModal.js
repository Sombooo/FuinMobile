import CustomTextInput from '../components/CustomTextInput';
import CustomText from '../components/CustomText';
import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal, ScrollView, Switch, KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, Alert } from 'react-native';
import { useTheme } from '../theme';
import GeneratorModal from './GeneratorModal';
import { Feather } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';
import { memDecrypt } from '../services/sessionSecurity';
import { copySecure } from '../clipboardManager';

export default function EditModal({ visible, entry, allCategories, onClose, onSave, onDelete, onRestore }) {
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const { t } = useI18n();
  const { showAlert } = useAlert();
  const [site, setSite] = useState('');
  const [category, setCategory] = useState(t('cat_other'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [totp, setTotp] = useState('');
  const [hasTotp, setHasTotp] = useState(false);
  const [fav, setFav] = useState(false);
  const [reprompt, setReprompt] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Modals state
  const [genVisible, setGenVisible] = useState(false);
  const [catVisible, setCatVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    if (visible) {
      if (entry) {
        setSite(entry.site || '');
        setCategory(entry.category || t('cat_other'));
        setUsername(entry.username || '');
        setPassword(entry.password ? memDecrypt(entry.password) : '');
        setUrl(entry.url || '');
        setNote(entry.note || '');
        setTotp(entry.totp ? memDecrypt(entry.totp) : '');
        setHasTotp(!!entry.totp);
        setFav(!!entry.fav);
        setReprompt(!!entry.reprompt);
      } else {
        setSite('');
        setCategory(t('cat_other'));
        setUsername('');
        setPassword('');
        setUrl('');
        setNote('');
        setTotp('');
        setHasTotp(false);
        setFav(false);
        setReprompt(false);
      }
      setNewCatName('');
      setShowPassword(false);
      setHistoryVisible(false);
    }
  }, [visible, entry]);

  const handleSave = () => {
    if (!site || !password) {
      showAlert(t('alertError'), t('toastSiteRequired'));
      return;
    }
    const finalCategory = category.trim() || t('cat_other');
    const now = Date.now();
    let history = entry && Array.isArray(entry.history) ? [...entry.history] : [];
    const oldPassword = entry && entry.password ? (typeof entry.password === 'object' ? memDecrypt(entry.password) : entry.password) : null;
    if (entry && oldPassword && oldPassword !== password) {
      history.unshift({
        password: oldPassword,
        date: now
      });
      if (history.length > 5) {
        history = history.slice(0, 5);
      }
    }
    onSave({
      id: entry ? entry.id : require('react-native-quick-crypto').randomUUID(),
      site, category: finalCategory, username, password, url, note, 
      totp: hasTotp ? totp : '', fav, 
      reprompt: !!reprompt,
      created: entry ? (entry.created || entry.createdAt || now) : now,
      createdAt: entry ? (entry.createdAt || entry.created || now) : now,
      updated: now,
      updatedAt: now,
      deletedAt: null,
      isDeleted: false,
      history
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} delayPressIn={0}>
            <CustomText style={styles.cancelText}>{t('btnCancel')}</CustomText>
          </TouchableOpacity>
          <CustomText style={styles.headerTitle}>{entry ? (entry.isDeleted ? t('modalDeletedEntry') : t('modalEditEntry')) : t('modalNewEntry')}</CustomText>
          <TouchableOpacity onPress={handleSave} activeOpacity={0.7} delayPressIn={0}>
            {!entry?.isDeleted && <CustomText style={styles.saveText}>{t('btnSave')}</CustomText>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : null}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <CustomText style={styles.label}>{t('fieldSite')}</CustomText>
            <CustomTextInput style={styles.input} value={site} onChangeText={setSite} placeholder={t('fieldSitePh')} placeholderTextColor={theme.border2} />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 15 }}>
                <CustomText style={styles.label}>{t('fieldCategory')}</CustomText>
                <TouchableOpacity style={styles.catPickerBtn} onPress={() => setCatVisible(true)} activeOpacity={0.7} delayPressIn={0}>
                  <CustomText style={{color: theme.text, fontSize: 15}}>{category}</CustomText>
                </TouchableOpacity>
              </View>
              <View style={{ alignItems: 'center' }}>
                <CustomText style={styles.label}>{t('toggleFavLabel')}</CustomText>
                <Switch value={fav} onValueChange={setFav} trackColor={{ false: theme.border, true: theme.accent }} />
              </View>
            </View>

            <CustomText style={styles.label}>{t('fieldUserLabel')}</CustomText>
            <CustomTextInput style={styles.input} value={username} onChangeText={setUsername} placeholderTextColor={theme.border2} autoCapitalize="none" />

            <View style={styles.rowBetween}>
              <CustomText style={styles.label}>{t('fieldPasswordLabel')}</CustomText>
              <TouchableOpacity onPress={() => setGenVisible(true)} style={styles.genBtn} activeOpacity={0.7} delayPressIn={0}>
                <Feather name="key" size={14} color={theme.accent} />
                <CustomText style={styles.genText}>{t('genPwTitle')}</CustomText>
              </TouchableOpacity>
            </View>
            <View style={styles.pwContainer}>
              <CustomTextInput style={styles.pwInput} value={password} onChangeText={setPassword} placeholderTextColor={theme.border2} autoCapitalize="none" secureTextEntry={!showPassword} />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn} hitSlop={{top: 15, bottom: 15, left: 15, right: 15}} activeOpacity={0.7} delayPressIn={0}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {entry && !entry.isDeleted && (
              <TouchableOpacity onPress={() => setHistoryVisible(true)} style={styles.historyBtn} activeOpacity={0.7} delayPressIn={0}>
                <Feather name="clock" size={13} color={theme.accent} />
                <CustomText style={styles.historyBtnText}>{t('btnPwHistory')} ({entry.history ? entry.history.length : 0})</CustomText>
              </TouchableOpacity>
            )}

            <CustomText style={styles.label}>{t('fieldUrl')}</CustomText>
            <CustomTextInput style={styles.input} value={url} onChangeText={setUrl} placeholderTextColor={theme.border2} autoCapitalize="none" keyboardType="url" />

            <View style={[styles.row, { justifyContent: 'space-between', marginTop: 10 }]}>
              <CustomText style={styles.label}>{t('section2FA')}</CustomText>
              <Switch value={hasTotp} onValueChange={setHasTotp} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>

            {hasTotp && (
              <>
                <CustomText style={[styles.label, { marginTop: 10 }]}>{t('toggle2FASub')}</CustomText>
                <CustomTextInput style={styles.input} value={totp} onChangeText={setTotp} placeholder="JBSWY3DPEHPK3PXP" placeholderTextColor={theme.border2} autoCapitalize="none" />
              </>
            )}

            <CustomText style={styles.label}>{t('fieldNote')}</CustomText>
            <CustomTextInput style={[styles.input, styles.textArea]} value={note} onChangeText={setNote} placeholderTextColor={theme.border2} multiline numberOfLines={4} textAlignVertical="top" />

            <View style={[styles.row, { justifyContent: 'space-between', marginTop: 10, marginBottom: 15 }]}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Feather name="shield" size={13} color={theme.accent} />
                  <CustomText style={styles.label}>{t('toggleRepromptLabel')}</CustomText>
                </View>
                <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>{t('toggleRepromptSub')}</CustomText>
              </View>
              <Switch value={reprompt} onValueChange={setReprompt} trackColor={{ false: theme.border, true: theme.accent }} />
            </View>

            {entry && !entry.isDeleted && (
              <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.7} delayPressIn={0} onPress={() => {
                showAlert(t('alertAreYouSure'), t('alertMoveToTrash'), [
                  { text: t('btnCancel'), style: 'cancel' },
                  { text: t('btnDelete'), style: 'destructive', onPress: () => onDelete(entry.id) }
                ]);
              }}>
                <CustomText style={styles.deleteText}>{t('btnDeleteEntry')}</CustomText>
              </TouchableOpacity>
            )}

            {entry && entry.isDeleted && (
              <View style={{flexDirection: 'column', gap: 10, marginTop: 20}}>
                <TouchableOpacity style={[styles.deleteBtn, {backgroundColor: theme.accent, borderColor: theme.accent}]} activeOpacity={0.7} delayPressIn={0} onPress={() => onRestore(entry.id)}>
                  <CustomText style={[styles.deleteText, {color: theme.bg}]}>{t('btnRestoreEntry')}</CustomText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.7} delayPressIn={0} onPress={() => {
                  showAlert(t('alertPermanentDeleteTitle'), t('alertPermanentDeleteMsg'), [
                    { text: t('btnCancel'), style: 'cancel' },
                    { text: t('btnDelete'), style: 'destructive', onPress: () => onDelete(entry.id) }
                  ]);
                }}>
                  <CustomText style={styles.deleteText}>{t('btnDeletePermanently')}</CustomText>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <GeneratorModal visible={genVisible} onClose={() => setGenVisible(false)} onApply={(pwd) => { setPassword(pwd); setGenVisible(false); }} />

      <Modal visible={catVisible} transparent animationType="fade" onRequestClose={() => setCatVisible(false)}>
        <View style={styles.catOverlay}>
          <View style={styles.catModal}>
            <CustomText style={styles.catTitle}>{t('selectCategoryTitle')}</CustomText>
            <ScrollView style={{maxHeight: 250, marginVertical: 15}} keyboardShouldPersistTaps="handled">
              {allCategories && allCategories.map(c => (
                <TouchableOpacity key={c} style={styles.catItem} activeOpacity={0.7} delayPressIn={0} onPress={() => { setCategory(c); setCatVisible(false); }}>
                  <CustomText style={[styles.catItemText, category === c && {color: theme.accent}]}>{c}</CustomText>
                  {category === c && <CustomText style={{color: theme.accent}}>✓</CustomText>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={{marginTop: 20, alignItems: 'center'}} activeOpacity={0.7} delayPressIn={0} onPress={() => setCatVisible(false)}>
              <CustomText style={{color: theme.muted}}>{t('btnClose')}</CustomText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={historyVisible} transparent animationType="fade" onRequestClose={() => setHistoryVisible(false)}>
        <View style={styles.catOverlay}>
          <View style={styles.catModal}>
            <CustomText style={styles.catTitle}>{t('pwHistoryTitle')}</CustomText>
            <ScrollView style={{maxHeight: 280, marginVertical: 15}} keyboardShouldPersistTaps="handled">
              {entry?.history && entry.history.length > 0 ? (
                entry.history.map((hist, idx) => {
                  const histPw = typeof hist.password === 'object' ? memDecrypt(hist.password) : hist.password;
                  const d = new Date(hist.date);
                  const dateFormatted = isNaN(d.getTime()) ? '' : d.toLocaleString();
                  return (
                    <View key={idx} style={styles.histItem}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <CustomText style={{ color: theme.muted, fontSize: 11, marginBottom: 2 }}>{dateFormatted}</CustomText>
                        <CustomText style={{ color: theme.text, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                          {histPw ? (histPw.length > 4 ? histPw.slice(0, 2) + '••••' + histPw.slice(-2) : '••••') : '••••'}
                        </CustomText>
                      </View>
                      <TouchableOpacity
                        style={styles.copyHistBtn}
                        activeOpacity={0.7}
                        delayPressIn={0}
                        onPress={async () => {
                          if (histPw) {
                            await copySecure(histPw, 45000);
                            showAlert(t('alertCopied'), t('pwHistoryCopied'));
                          }
                        }}
                      >
                        <CustomText style={{ color: theme.accent, fontSize: 11, fontWeight: 'bold' }}>{t('btnCopyUpper') || 'KOPYALA'}</CustomText>
                      </TouchableOpacity>
                    </View>
                  );
                })
              ) : (
                <CustomText style={{ color: theme.muted, fontSize: 13, textAlign: 'center', padding: 20 }}>{t('pwHistoryEmpty')}</CustomText>
              )}
            </ScrollView>
            <TouchableOpacity style={{marginTop: 10, alignItems: 'center'}} activeOpacity={0.7} delayPressIn={0} onPress={() => setHistoryVisible(false)}>
              <CustomText style={{color: theme.muted, fontWeight: 'bold'}}>{t('btnClose')}</CustomText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </Modal>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderColor: theme.border },
  headerTitle: { color: theme.text, fontSize: 15, fontWeight: 'bold', letterSpacing: 1 },
  cancelText: { color: theme.muted, fontSize: 14 },
  saveText: { color: theme.accent, fontSize: 14, fontWeight: 'bold' },
  content: { padding: 20, paddingBottom: 50 },
  label: { color: theme.muted, fontSize: 11, marginBottom: 6, fontWeight: 'bold', letterSpacing: 0.5 },
  input: { backgroundColor: theme.card, color: theme.text, padding: 12, borderRadius: 6, fontSize: 15, marginBottom: 15, borderWidth: 1, borderColor: theme.border },
  textArea: { height: 100 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  
  genBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.border, gap: 4 },
  genText: { color: theme.accent, fontSize: 12, fontWeight: 'bold' },
  
  pwContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 6, borderWidth: 1, borderColor: theme.border, marginBottom: 15 },
  pwInput: { flex: 1, color: theme.text, padding: 12, fontSize: 15 },
  eyeBtn: { padding: 12, justifyContent: 'center', alignItems: 'center' },
  
  historyBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.border, gap: 6, marginBottom: 15, alignSelf: 'flex-start' },
  historyBtnText: { color: theme.accent, fontSize: 11, fontWeight: 'bold' },
  histItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border2 },
  copyHistBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: theme.accent, backgroundColor: 'transparent' },

  deleteBtn: { marginTop: 20, padding: 15, borderRadius: 6, borderWidth: 1, borderColor: theme.red, alignItems: 'center' },
  deleteText: { color: theme.red, fontWeight: 'bold' },
  
  // Custom Category Picker Styles
  catPickerBtn: { backgroundColor: theme.card, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: theme.border, marginBottom: 15, height: 46, justifyContent: 'center' },
  catOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  catModal: { backgroundColor: theme.card, width: '100%', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: theme.border },
  catTitle: { color: theme.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  catItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border2 },
  catItemText: { color: theme.text, fontSize: 16 }
});

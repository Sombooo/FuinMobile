import CustomTextInput from '../components/CustomTextInput';
import CustomText from '../components/CustomText';
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal, ScrollView, Switch, KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, Alert } from 'react-native';
import { useTheme } from '../theme';
import GeneratorModal from './GeneratorModal';
import { Feather } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { useAlert } from '../components/CustomAlert';

export default function EditModal({ visible, entry, allCategories, onClose, onSave, onDelete, onRestore }) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
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
  const [showPassword, setShowPassword] = useState(false);

  // Modals state
  const [genVisible, setGenVisible] = useState(false);
  const [catVisible, setCatVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    if (visible) {
      if (entry) {
        setSite(entry.site || '');
        setCategory(entry.category || t('cat_other'));
        setUsername(entry.username || '');
        setPassword(entry.password || '');
        setUrl(entry.url || '');
        setNote(entry.note || '');
        setTotp(entry.totp || '');
        setHasTotp(!!entry.totp);
        setFav(!!entry.fav);
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
      }
      setNewCatName('');
      setShowPassword(false);
    }
  }, [visible, entry]);

  const handleSave = () => {
    if (!site || !password) {
      showAlert(t('alertError'), t('toastSiteRequired'));
      return;
    }
    const finalCategory = category.trim() || t('cat_other');
    onSave({
      id: entry ? entry.id : require('react-native-quick-crypto').randomUUID(),
      site, category: finalCategory, username, password, url, note, 
      totp: hasTotp ? totp : '', fav, 
      created: entry ? entry.created : Date.now(),
      updated: Date.now()
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <CustomText style={styles.cancelText}>{t('btnCancel')}</CustomText>
          </TouchableOpacity>
          <CustomText style={styles.headerTitle}>{entry ? (entry.isDeleted ? t('modalDeletedEntry') : t('modalEditEntry')) : t('modalNewEntry')}</CustomText>
          <TouchableOpacity onPress={handleSave}>
            {!entry?.isDeleted && <CustomText style={styles.saveText}>{t('btnSave')}</CustomText>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : null}>
          <ScrollView contentContainerStyle={styles.content}>
            <CustomText style={styles.label}>{t('fieldSite')}</CustomText>
            <CustomTextInput style={styles.input} value={site} onChangeText={setSite} placeholder={t('fieldSitePh')} placeholderTextColor={theme.border2} />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 15 }}>
                <CustomText style={styles.label}>{t('fieldCategory')}</CustomText>
                <TouchableOpacity style={styles.catPickerBtn} onPress={() => setCatVisible(true)}>
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
              <TouchableOpacity onPress={() => setGenVisible(true)} style={styles.genBtn}>
                <Feather name="zap" size={14} color={theme.accent} />
                <CustomText style={styles.genText}>{t('genPwTitle')}</CustomText>
              </TouchableOpacity>
            </View>
            <View style={styles.pwContainer}>
              <CustomTextInput style={styles.pwInput} value={password} onChangeText={setPassword} placeholderTextColor={theme.border2} autoCapitalize="none" secureTextEntry={!showPassword} />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn} hitSlop={{top: 15, bottom: 15, left: 15, right: 15}}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

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

            {entry && !entry.isDeleted && (
              <TouchableOpacity style={styles.deleteBtn} onPress={() => {
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
                <TouchableOpacity style={[styles.deleteBtn, {backgroundColor: theme.accent, borderColor: theme.accent}]} onPress={() => onRestore(entry.id)}>
                  <CustomText style={[styles.deleteText, {color: theme.bg}]}>{t('btnRestoreEntry')}</CustomText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => {
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
            <ScrollView style={{maxHeight: 250, marginVertical: 15}}>
              {allCategories && allCategories.map(c => (
                <TouchableOpacity key={c} style={styles.catItem} onPress={() => { setCategory(c); setCatVisible(false); }}>
                  <CustomText style={[styles.catItemText, category === c && {color: theme.accent}]}>{c}</CustomText>
                  {category === c && <CustomText style={{color: theme.accent}}>✓</CustomText>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={{marginTop: 20, alignItems: 'center'}} onPress={() => setCatVisible(false)}>
              <CustomText style={{color: theme.muted}}>{t('btnClose')}</CustomText>
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

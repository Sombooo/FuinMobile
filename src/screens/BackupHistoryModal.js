import React from 'react';
import { Modal, View, ScrollView, TouchableOpacity, Platform, StatusBar } from 'react-native';
import CustomText from '../components/CustomText';
import { restoreVaultBackup } from '../storage';

export default function BackupHistoryModal({
  visible,
  backups,
  onClose,
  onRestored,
  theme,
  styles,
  lang,
  t,
  showAlert,
}) {
  const locale = lang === 'en' ? 'en-US' : 'tr-TR';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          paddingTop: Platform.OS === 'ios' ? 40 : StatusBar.currentHeight,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 20,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={{ padding: 10, marginLeft: -10 }}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            delayPressIn={0}
          >
            <CustomText style={{ color: theme.text, fontSize: 28, lineHeight: 28 }}>×</CustomText>
          </TouchableOpacity>
          <CustomText
            style={{
              flex: 1,
              textAlign: 'center',
              color: theme.text,
              fontSize: 16,
              fontWeight: 'bold',
              letterSpacing: 2,
            }}
          >
            {t('backupModalTitle')}
          </CustomText>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={{ flex: 1, padding: 20 }} keyboardShouldPersistTaps="handled">
          <CustomText style={{ color: theme.muted, fontSize: 13, marginBottom: 20, lineHeight: 20 }}>
            {t('backupModalDesc')}
          </CustomText>

          {!backups || backups.length === 0 ? (
            <CustomText style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}>
              {t('backupEmpty')}
            </CustomText>
          ) : (
            backups.map((b) => {
              const date = new Date(b.timestamp);
              const isToday = new Date().toDateString() === date.toDateString();
              const dStr = isToday
                ? t('dateToday') + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

              return (
                <TouchableOpacity
                  key={b.fileName}
                  style={[
                    styles.settingsCard,
                    {
                      marginBottom: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    },
                  ]}
                  onPress={() => {
                    showAlert(t('alertRestoreTitle'), `${dStr}${t('alertRestoreBody')}`, [
                      { text: t('btnCancel'), style: 'cancel' },
                      {
                        text: t('btnRestoreConfirm'),
                        style: 'destructive',
                        onPress: async () => {
                          const success = await restoreVaultBackup(b.fileName);
                          if (success) {
                            showAlert(t('alertSuccess'), t('alertRestoreSuccessRelogin'));
                            if (onClose) onClose();
                            if (onRestored) onRestored();
                          } else {
                            showAlert(t('alertError'), t('alertRestoreFailed'));
                          }
                        },
                      },
                    ]);
                  }}
                >
                  <View>
                    <CustomText style={{ color: theme.text, fontSize: 15, fontWeight: 'bold' }}>
                      {dStr}
                    </CustomText>
                    <CustomText style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>
                      {b.fileName}
                    </CustomText>
                  </View>
                  <CustomText style={{ color: theme.accent, fontWeight: 'bold' }}>
                    {t('btnRestoreAction')}
                  </CustomText>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

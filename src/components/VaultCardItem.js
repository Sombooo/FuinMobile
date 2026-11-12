import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import CustomText from './CustomText';
import { memDecrypt } from '../services/sessionSecurity';

const VaultCardItem = React.memo(function VaultCardItem({
  item,
  isPwVisible,
  onTogglePw,
  onCopy,
  onOpenEdit,
  onOpenUrl,
  theme,
  styles,
  t
}) {
  const type = item.type || 'login';
  const isCard = item.type === 'card';
  const isNote = item.type === 'note';

  // Format card number preview or decrypted value
  const rawNum = (item.cardNumber && typeof item.cardNumber === 'string')
    ? item.cardNumber.replace(/\D/g, '')
    : '';
  const cardLast4 = item.cardLastFour || (rawNum ? rawNum.slice(-4) : '••••');
  const cardBrand = item.cardBrand ? item.cardBrand.toUpperCase() : '';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      delayPressIn={0}
      onPress={() => onOpenEdit(item)}
      style={styles.card}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          {isCard ? (
            <View style={[localStyles.typeIconWrap, { backgroundColor: 'rgba(200, 128, 64, 0.16)' }]}>
              <Feather name="credit-card" size={13} color={theme.amber || '#c88040'} />
            </View>
          ) : isNote ? (
            <View style={[localStyles.typeIconWrap, { backgroundColor: 'rgba(90, 154, 110, 0.16)' }]}>
              <Feather name="file-text" size={13} color={theme.accent} />
            </View>
          ) : (
            <View style={[localStyles.typeIconWrap, { backgroundColor: 'rgba(166, 157, 146, 0.12)' }]}>
              <Feather name="key" size={13} color={theme.muted} />
            </View>
          )}

          {item.fav && <Feather name="star" size={13} color={theme.accent} style={{ marginRight: 2 }} />}
          <CustomText style={styles.cardTitle}>{item.site}</CustomText>
          {item.reprompt && <Feather name="shield" size={12} color={theme.accent} style={{ marginLeft: 2 }} />}
          {item.url && /^http:\/\//i.test(item.url.trim()) && (
            <View style={{ backgroundColor: 'rgba(176, 112, 32, 0.15)', borderWidth: 1, borderColor: 'rgba(176, 112, 32, 0.4)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, marginLeft: 4 }}>
              <CustomText style={{ fontSize: 9, fontWeight: 'bold', color: theme.amber || '#b07020' }}>HTTP</CustomText>
            </View>
          )}
        </View>
        <CustomText style={styles.cardCategory}>{item.category || (isCard ? t('cat_finance') : t('cat_other'))}</CustomText>
      </View>

      {/* ── CARD VIEW ── */}
      {isCard && (
        <>
          {item.cardholderName || item.username ? (
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('fieldCardholder')}</CustomText>
              <TouchableOpacity
                activeOpacity={0.6}
                delayPressIn={0}
                onPress={() => onCopy(item.cardholderName || item.username, t('fieldCardholder'))}
              >
                <CustomText style={styles.value}>{item.cardholderName || item.username}</CustomText>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.row}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <CustomText style={styles.label}>{t('fieldCardNumber')}</CustomText>
              {cardBrand ? (
                <View style={localStyles.badge}>
                  <CustomText style={[localStyles.badgeText, { color: theme.amber || '#c88040' }]}>{cardBrand}</CustomText>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={() => onTogglePw(item)}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={{ padding: 4 }}
                activeOpacity={0.6}
                delayPressIn={0}
              >
                <Feather name={isPwVisible ? "eye-off" : "eye"} size={16} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.6}
                delayPressIn={0}
                onPress={() => onCopy(item.cardNumber, t('fieldCardNumber'), item, 30000)}
              >
                <CustomText style={[styles.value, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                  {isPwVisible
                    ? (typeof item.cardNumber === 'object' ? memDecrypt(item.cardNumber) : item.cardNumber)
                    : `•••• ${cardLast4}`}
                </CustomText>
              </TouchableOpacity>
            </View>
          </View>

          {(item.cardExpiry || item.cardCvv) && (
            <View style={[styles.row, { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.border }]}>
              {item.cardExpiry ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CustomText style={[styles.label, { fontSize: 11 }]}>{t('fieldCardExpiry')}:</CustomText>
                  <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>{item.cardExpiry}</CustomText>
                </View>
              ) : <View />}

              {item.cardCvv ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={localStyles.actionBtn}
                  onPress={() => onCopy(item.cardCvv, t('fieldCardCvv'), item, 20000)}
                >
                  <Feather name="shield" size={12} color={theme.accent} />
                  <CustomText style={[localStyles.actionBtnText, { color: theme.accent }]}>{t('btnCopyCvv')}</CustomText>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </>
      )}

      {/* ── NOTE VIEW ── */}
      {isNote && (
        <>
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <CustomText style={[styles.label, { marginTop: 4 }]}>{t('typeNote')}</CustomText>
            <View style={{ flex: 1, alignItems: 'flex-end', marginLeft: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <TouchableOpacity
                  onPress={() => onTogglePw(item)}
                  hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                  style={{ padding: 4 }}
                  activeOpacity={0.6}
                  delayPressIn={0}
                >
                  <Feather name={isPwVisible ? "eye-off" : "eye"} size={16} color={theme.muted} />
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={localStyles.actionBtn}
                  onPress={() => onCopy(item.secureNote, t('fieldNote'), item, 45000)}
                >
                  <Feather name="copy" size={12} color={theme.accent} />
                  <CustomText style={[localStyles.actionBtnText, { color: theme.accent }]}>{t('btnCopyNote')}</CustomText>
                </TouchableOpacity>
              </View>
              <CustomText
                style={[
                  styles.value,
                  { color: isPwVisible ? theme.text : theme.muted, fontSize: 13, textAlign: 'right' }
                ]}
                numberOfLines={isPwVisible ? 4 : 1}
              >
                {isPwVisible
                  ? (typeof item.secureNote === 'object' ? memDecrypt(item.secureNote) : item.secureNote)
                  : '••••••••••••••••'}
              </CustomText>
            </View>
          </View>
        </>
      )}

      {/* ── LOGIN VIEW ── */}
      {!isCard && !isNote && (
        <>
          {item.username ? (
            <View style={styles.row}>
              <CustomText style={styles.label}>{t('fieldUser')}</CustomText>
              <TouchableOpacity
                activeOpacity={0.6}
                delayPressIn={0}
                onPress={() => onCopy(item.username, t('fieldUser'))}
              >
                <CustomText style={styles.value}>{item.username}</CustomText>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.row}>
            <CustomText style={styles.label}>{t('fieldPassword')}</CustomText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                onPress={() => onTogglePw(item)}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={{ padding: 5 }}
                activeOpacity={0.6}
                delayPressIn={0}
              >
                <Feather name={isPwVisible ? "eye-off" : "eye"} size={16} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.6}
                delayPressIn={0}
                onPress={() => onCopy(item.password, t('fieldPassword'), item)}
              >
                <CustomText style={styles.value}>{isPwVisible ? (typeof item.password === 'object' ? memDecrypt(item.password) : item.password) : '••••••••'}</CustomText>
              </TouchableOpacity>
            </View>
          </View>

          {item.url && !/^androidapp:\/\//i.test(String(item.url).trim()) ? (
            <View style={[styles.row, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }]}>
              <CustomText style={styles.label}>{t('fieldUrl')}</CustomText>
              <TouchableOpacity
                activeOpacity={0.7}
                delayPressIn={0}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 }}
                onPress={() => onOpenUrl(item.url)}
              >
                <Feather name="external-link" size={14} color={theme.bg} />
                <CustomText style={{ color: theme.bg, fontSize: 12, fontWeight: 'bold' }}>{t('btnOpenInBrowser')}</CustomText>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.item === next.item &&
    prev.isPwVisible === next.isPwVisible &&
    prev.theme === next.theme;
});

const localStyles = StyleSheet.create({
  typeIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badge: {
    backgroundColor: 'rgba(200, 128, 64, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(200, 128, 64, 0.4)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3
  },
  badgeText: {
    fontSize: 9,
    fontWeight: 'bold'
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(90, 154, 110, 0.35)',
    backgroundColor: 'rgba(90, 154, 110, 0.08)'
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: 'bold'
  }
});

export default VaultCardItem;

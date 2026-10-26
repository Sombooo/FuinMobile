import React from 'react';
import { View, TouchableOpacity } from 'react-native';
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
  return (
    <TouchableOpacity 
      activeOpacity={0.7} 
      delayPressIn={0}
      onPress={() => onOpenEdit(item)} 
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          {item.fav && <Feather name="star" size={13} color={theme.accent} style={{ marginRight: 2 }} />}
          <CustomText style={styles.cardTitle}>{item.site}</CustomText>
          {item.reprompt && <Feather name="shield" size={12} color={theme.accent} style={{ marginLeft: 2 }} />}
          {item.url && /^http:\/\//i.test(item.url.trim()) && (
            <View style={{ backgroundColor: 'rgba(176, 112, 32, 0.15)', borderWidth: 1, borderColor: 'rgba(176, 112, 32, 0.4)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, marginLeft: 4 }}>
              <CustomText style={{ fontSize: 9, fontWeight: 'bold', color: theme.amber || '#b07020' }}>HTTP</CustomText>
            </View>
          )}
        </View>
        <CustomText style={styles.cardCategory}>{item.category || t('cat_other')}</CustomText>
      </View>

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
            hitSlop={{top: 15, bottom: 15, left: 15, right: 15}} 
            style={{padding: 5}}
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
      
      {item.url ? (
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
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.item === next.item &&
         prev.isPwVisible === next.isPwVisible &&
         prev.theme === next.theme;
});

export default VaultCardItem;

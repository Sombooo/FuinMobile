import React, { useState } from 'react';
import { View, Modal, TouchableOpacity, ScrollView, Platform, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import CustomText from '../components/CustomText';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHANGELOG_ENTRIES, getEntryByVersion } from '../services/changelogData';

export default function WhatsNewModal({ visible, onClose }) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const [selectedVer, setSelectedVer] = useState(CHANGELOG_ENTRIES[0].version);

  if (!visible) return null;

  const currentEntry = getEntryByVersion(selectedVer);
  const isEn = (lang || 'tr').toLowerCase() === 'en';

  const handleDismiss = async () => {
    try {
      await AsyncStorage.setItem('fuin_last_seen_changelog', CHANGELOG_ENTRIES[0].version);
    } catch {}
    if (onClose) onClose();
  };

  const getFeatherIconName = (icon) => {
    switch (icon) {
      case 'file-text':
      case 'scroll':
        return 'file-text';
      case 'download':
      case 'download-cloud':
        return 'download';
      case 'smartphone':
        return 'smartphone';
      case 'cpu':
      case 'puzzle':
        return 'cpu';
      case 'sliders':
        return 'sliders';
      case 'shield':
      case 'shield-check':
        return 'shield';
      case 'package':
        return 'package';
      case 'database':
        return 'database';
      case 'key':
        return 'key';
      case 'wifi':
        return 'wifi';
      case 'lock':
      default:
        return 'lock';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: Platform.OS === 'ios' ? 40 : StatusBar.currentHeight }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity 
            onPress={onClose} 
            style={{ padding: 6, marginLeft: -6 }} 
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            delayPressIn={0}
          >
            <CustomText style={{ color: theme.text, fontSize: 26, lineHeight: 26 }}>×</CustomText>
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Feather name="zap" size={16} color={theme.accent} />
            <CustomText style={{ textAlign: 'center', color: theme.text, fontSize: 15, fontWeight: 'bold', letterSpacing: 1.5 }}>
              {t('whatsNewModalTitle') || 'NELER YENİ?'}
            </CustomText>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Version Tabs */}
        <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CHANGELOG_ENTRIES.map((entry) => {
              const isSelected = entry.version === selectedVer;
              return (
                <TouchableOpacity
                  key={entry.version}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  onPress={() => setSelectedVer(entry.version)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 4,
                    backgroundColor: isSelected ? 'rgba(90, 154, 110, 0.14)' : theme.card,
                    borderWidth: 1,
                    borderColor: isSelected ? theme.accent : theme.border,
                  }}
                >
                  <CustomText style={{
                    fontSize: 11,
                    fontWeight: isSelected ? 'bold' : '500',
                    color: isSelected ? theme.accent : theme.muted,
                    letterSpacing: 0.5,
                  }}>
                    {entry.tag}{entry.isCurrent ? (isEn ? ' (Latest)' : ' (Güncel)') : ''}
                  </CustomText>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Content Body */}
        <ScrollView 
          style={{ flex: 1 }} 
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Release Overview Card */}
          <View style={{
            backgroundColor: theme.card,
            padding: 16,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: theme.border,
            marginBottom: 14,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{
                backgroundColor: 'rgba(90, 154, 110, 0.14)',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 3,
                borderWidth: 1,
                borderColor: 'rgba(90, 154, 110, 0.3)',
              }}>
                <CustomText style={{ color: theme.accent, fontSize: 11, fontWeight: 'bold' }}>
                  {currentEntry.tag}
                </CustomText>
              </View>
              <CustomText style={{ color: theme.muted, fontSize: 11 }}>
                {isEn ? (currentEntry.dateEn || currentEntry.date) : currentEntry.date}
              </CustomText>
            </View>

            <CustomText style={{ color: theme.text, fontSize: 14, fontWeight: 'bold', marginBottom: 6, lineHeight: 20 }}>
              {isEn ? (currentEntry.titleEn || currentEntry.title) : currentEntry.title}
            </CustomText>
            <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {isEn ? (currentEntry.summaryEn || currentEntry.summary) : currentEntry.summary}
            </CustomText>
          </View>

          {/* Highlights List */}
          <View style={{ gap: 12 }}>
            {currentEntry.highlights.map((item, index) => {
              const itemTitle = isEn ? (item.titleEn || item.title) : item.title;
              const itemDesc = isEn ? (item.descEn || item.desc) : item.desc;
              const badgeText = isEn ? (item.badgeTextEn || item.badgeText) : item.badgeText;
              const iconName = getFeatherIconName(item.icon);

              return (
                <View 
                  key={index}
                  style={{
                    backgroundColor: theme.card,
                    padding: 14,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: theme.border,
                    flexDirection: 'row',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={{
                    width: 32,
                    height: 32,
                    borderRadius: 4,
                    backgroundColor: 'rgba(90, 154, 110, 0.12)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 2,
                  }}>
                    <Feather name={iconName} size={15} color={theme.accent} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <View style={{
                        backgroundColor: 'rgba(90, 154, 110, 0.14)',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 3,
                        borderWidth: 1,
                        borderColor: 'rgba(90, 154, 110, 0.25)',
                      }}>
                        <CustomText style={{ color: theme.accent, fontSize: 9.5, fontWeight: 'bold', letterSpacing: 0.5 }}>
                          {badgeText}
                        </CustomText>
                      </View>
                      <CustomText style={{ color: theme.text, fontSize: 13, fontWeight: 'bold' }}>
                        {itemTitle}
                      </CustomText>
                    </View>

                    <CustomText style={{ color: theme.muted, fontSize: 12, lineHeight: 17 }}>
                      {itemDesc}
                    </CustomText>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={{ 
          paddingHorizontal: 20, 
          paddingTop: 16, 
          paddingBottom: Platform.OS === 'ios' ? 24 : 16, 
          borderTopWidth: 1, 
          borderTopColor: theme.border, 
          backgroundColor: theme.bg 
        }}>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <CustomText style={{ color: theme.muted, fontSize: 11, letterSpacing: 0.5 }}>
              {t('whatsNewOfflineFooter') || 'Fuin — %100 Çevrimdışı & Güvenli'}
            </CustomText>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleDismiss}
            style={{
              backgroundColor: theme.accent,
              height: 46,
              borderRadius: 4,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CustomText style={{ color: theme.bg, fontSize: 14, fontWeight: 'bold', letterSpacing: 0.5 }}>
              {t('whatsNewGotIt') || 'Harika, Anladım'}
            </CustomText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

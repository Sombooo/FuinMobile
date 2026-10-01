import CustomText from '../components/CustomText';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, Animated } from 'react-native';
import { useTheme } from '../theme';
import Svg, { Path } from 'react-native-svg';
import { useI18n } from '../i18n';

export default function SuccessScreen({ onComplete }) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const { t } = useI18n();
  const scale = new Animated.Value(0);

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      useNativeDriver: true,
    }).start();

    // 2 saniye sonra otomatik olarak kasaya geç
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centerBox}>
        <Animated.View style={[styles.iconBox, { transform: [{ scale }] }]}>
          <Svg width="60" height="60" viewBox="0 0 24 24" fill="none">
            <Path d="M20 6L9 17L4 12" stroke={theme.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
        <CustomText style={styles.title}>{t('syncSuccessTitle')}</CustomText>
        <CustomText style={styles.subtitle}>{t('syncSuccessSubtitle')}</CustomText>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  iconBox: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(90, 154, 110, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    letterSpacing: 2,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    color: theme.muted,
  }
});

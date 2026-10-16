import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, Modal, TouchableOpacity, Platform, StatusBar, Animated } from 'react-native';
import CustomText from './CustomText';
import { useTheme } from '../theme';

const AlertContext = createContext();

export function AlertProvider({ children }) {
  const [alertConfig, setAlertConfig] = useState(null);

  const showAlert = useCallback((title, message, buttons) => {
    setAlertConfig({ title, message, buttons: buttons || [{ text: 'OK' }] });
  }, []);

  const dismiss = useCallback(() => {
    setAlertConfig(null);
  }, []);

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      {alertConfig && (
        <AlertModal config={alertConfig} onDismiss={dismiss} />
      )}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  return useContext(AlertContext);
}

function AlertModal({ config, onDismiss }) {
  const { theme } = useTheme();
  const { title, message, buttons } = config;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 55,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  // Determine alert type from title content for styling
  const isError = title?.includes('⚠') || title?.includes('Hata') || title?.includes('Error') || title?.includes('Dikkat') || title?.includes('Warning');
  const isSuccess = title?.includes('Başarılı') || title?.includes('Success') || title?.includes('Kopyalandı') || title?.includes('Copied') || title?.includes('Kaydedildi') || title?.includes('Saved');
  
  const accentColor = isError ? (theme.red || '#E55050') : isSuccess ? (theme.green || '#5A9A6E') : theme.accent;

  const handlePress = (btn) => {
    onDismiss();
    if (btn.onPress) btn.onPress();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
      }}>
        <Animated.View style={{
          width: '100%',
          maxWidth: 340,
          backgroundColor: theme.bg,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 4,
          overflow: 'hidden',
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        }}>
          {/* Accent top bar */}
          <View style={{ height: 3, backgroundColor: accentColor }} />
          
          <View style={{ padding: 24 }}>
            {/* Title */}
            {title ? (
              <CustomText style={{
                fontSize: 16,
                fontWeight: 'bold',
                color: accentColor,
                letterSpacing: 1,
                marginBottom: 12,
                textAlign: 'center',
              }}>
                {title}
              </CustomText>
            ) : null}

            {/* Message */}
            {message ? (
              <CustomText style={{
                fontSize: 13,
                color: theme.text,
                lineHeight: 20,
                textAlign: message?.includes('\n') ? 'left' : 'center',
                marginBottom: 24,
              }}>
                {message}
              </CustomText>
            ) : null}

            {/* Buttons */}
            {(() => {
              const hasLongText = buttons.some(b => (b.text || '').length > 14);
              const isColumn = buttons.length > 2 || hasLongText;
              const hasExplicitPrimary = buttons.some(b => b.style === 'primary');

              return (
                <View style={{
                  flexDirection: isColumn ? 'column' : 'row',
                  gap: 10,
                }}>
                  {buttons.map((btn, i) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    const isPrimary = btn.style === 'primary' || (!hasExplicitPrimary && !isCancel && !isDestructive && (buttons.length === 1 || i === buttons.length - 1));
                    
                    let bgColor = 'transparent';
                    let textColor = theme.text;
                    let borderColor = theme.border;

                    if (isDestructive) {
                      bgColor = theme.red || '#E55050';
                      textColor = '#fff';
                      borderColor = bgColor;
                    } else if (isPrimary) {
                      bgColor = accentColor;
                      textColor = theme.bg;
                      borderColor = accentColor;
                    } else if (isCancel) {
                      bgColor = 'transparent';
                      textColor = theme.muted;
                      borderColor = theme.border;
                    }

                    return (
                      <TouchableOpacity
                        key={i}
                        style={{
                          flex: isColumn ? undefined : 1,
                          width: isColumn ? '100%' : undefined,
                          minHeight: 44,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          backgroundColor: bgColor,
                          borderWidth: 1,
                          borderColor: borderColor,
                          borderRadius: 4,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onPress={() => handlePress(btn)}
                        activeOpacity={0.7}
                      >
                        <CustomText style={{
                          color: textColor,
                          fontSize: 12,
                          fontWeight: '600',
                          letterSpacing: 0.5,
                          textAlign: 'center',
                        }}>
                          {btn.text}
                        </CustomText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

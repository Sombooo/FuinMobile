import React, { createContext, useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

const ToastContext = createContext({
  showToast: (message) => {},
});

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toastMessage, setToastMessage] = useState(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [translateY] = useState(new Animated.Value(50));

  useEffect(() => {
    if (toastMessage) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        hideToast();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const hideToast = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 50,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastMessage(null);
    });
  };

  const showToast = (message) => {
    setToastMessage(message);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastContainer,
            { opacity: fadeAnim, transform: [{ translateY }] },
          ]}
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: '#1C1C1E',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    zIndex: 9999,
  },
  toastText: {
    color: '#E0E0E0',
    fontSize: 14,
    fontFamily: 'JetBrains Mono',
    textAlign: 'center',
  },
});

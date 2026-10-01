export const lightTheme = {
  bg: '#f5f0e8',
  paper: '#ede8df',
  card: '#e8e2d8',
  border: '#c8c0b0',
  border2: '#b0a898',
  text: '#2a2520',
  muted: '#8a8078',
  accent: '#3d6b4f',
  accent2: '#8b4513',
  red: '#a0342a',
  green: '#3d6b4f',
  amber: '#b07020',
};

export const darkTheme = {
  bg: '#1a1816',
  paper: '#222019',
  card: '#2a2720',
  border: '#3d3830',
  border2: '#5a5248',
  text: '#e8e2d8',
  muted: '#8a8078',
  accent: '#5a9a6e',
  accent2: '#c88040',
  red: '#d45a4a',
  green: '#5a9a6e',
  amber: '#d4982a',
};

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Varsayılan theme objesini geriye dönük uyumluluk (migration süreci) için tutuyoruz
export const theme = darkTheme;

export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState('dark'); // 'light', 'dark', 'system'
  const [currentTheme, setCurrentTheme] = useState(darkTheme);

  useEffect(() => {
    loadTheme();
  }, []);

  useEffect(() => {
    if (themeMode === 'system') {
      setCurrentTheme(systemColorScheme === 'light' ? lightTheme : darkTheme);
    } else {
      setCurrentTheme(themeMode === 'light' ? lightTheme : darkTheme);
    }
  }, [themeMode, systemColorScheme]);

  const loadTheme = async () => {
    try {
      const savedTheme = await SecureStore.getItemAsync('fuin-theme');
      if (savedTheme) {
        setThemeMode(savedTheme);
      }
    } catch (e) {
      console.log('Error loading theme:', e);
    }
  };

  const changeTheme = async (mode) => {
    setThemeMode(mode);
    try {
      await SecureStore.setItemAsync('fuin-theme', mode);
    } catch (e) {}
  };

  return (
    <ThemeContext.Provider value={{ theme: currentTheme, themeMode, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { clearIfExpired } from '../clipboardManager';

/**
 * Hook to manage app lifecycle, background inactivity timeouts, and clipboard clearing.
 * @param {Object} options
 * @param {Function} options.onLock - Callback invoked when background timeout expires
 * @param {Function} [options.onCheckLocalVault] - Callback to check local vault existence
 */
export function useVaultLifecycle({ onLock, onCheckLocalVault }) {
  const appState = useRef(AppState.currentState);
  const backgroundTime = useRef(null);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    if (onCheckLocalVault) onCheckLocalVault();

    const subscription = AppState.addEventListener('change', async nextAppState => {
      setIsAppActive(nextAppState === 'active');
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        backgroundTime.current = Date.now();
      } else if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (backgroundTime.current) {
          const elapsed = Date.now() - backgroundTime.current;
          try {
            const timeoutStr = await SecureStore.getItemAsync('fuin-bg-timeout');
            const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 60000; // default 1 min
            if (timeout > 0 && elapsed > timeout) {
              if (onLock) onLock();
            }
          } catch (e) {}
        }
        
        try {
          await clearIfExpired();
        } catch (e) {}

        backgroundTime.current = null;
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [onLock, onCheckLocalVault]);

  return { isAppActive };
}

export default useVaultLifecycle;

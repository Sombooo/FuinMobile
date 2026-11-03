import { useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { unprotectEntries } from '../services/sessionSecurity';
import { autofillService } from '../services/autofillService';
import { mergePendingAutofillSaves } from '../services/autofillMerge';

const DEFAULT_BG_TIMEOUT_MS = 60_000;

async function readConfiguredTimeoutMs() {
  try {
    const raw = await SecureStore.getItemAsync('fuin-bg-timeout');
    if (raw === null || raw === undefined) return DEFAULT_BG_TIMEOUT_MS;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BG_TIMEOUT_MS;
  } catch (_) {
    return DEFAULT_BG_TIMEOUT_MS;
  }
}

/**
 * Coordinates Android Autofill vault cache synchronization, lock-timeout alignment,
 * and two-phase atomic ingestion of credentials captured via Android's Save dialog.
 */
export default function useAutofillSync({
  vaultData,
  mode,
  isAppActive,
  password,
  onUpdateVaultData,
  onSavedToast,
}) {
  const isConsumingRef = useRef(false);

  useEffect(() => {
    if (vaultData && mode === 'vault' && isAppActive) {
      let cancelled = false;

      (async () => {
        try {
          const parsed = typeof vaultData === 'string' ? JSON.parse(vaultData) : vaultData;
          const baseObj = parsed && !Array.isArray(parsed) ? parsed : { type: 'fuin/vault', categories: [] };
          const entries = parsed?.entries || (Array.isArray(parsed) ? parsed : []);
          const unprotected = unprotectEntries(entries);

          if (!isConsumingRef.current && password) {
            isConsumingRef.current = true;
            try {
              const pendingSaves = await autofillService.peekPendingSaves();
              if (!cancelled && pendingSaves.length > 0) {
                const { entries: mergedEntries, changed, acknowledgedIds } =
                  mergePendingAutofillSaves(unprotected, pendingSaves);

                if (changed) {
                  const savedOk = await onUpdateVaultData(
                    JSON.stringify({ ...baseObj, entries: mergedEntries })
                  );
                  if (savedOk) {
                    await autofillService.ackPendingSaves(acknowledgedIds);
                    if (onSavedToast) onSavedToast();
                    return; // Re-render with updated vaultData triggers syncVault cleanly
                  }
                } else if (acknowledgedIds.length > 0) {
                  await autofillService.ackPendingSaves(acknowledgedIds);
                }
              }
            } finally {
              isConsumingRef.current = false;
            }
          }

          if (!cancelled) {
            const timeoutMs = await readConfiguredTimeoutMs();
            if (!cancelled) {
              await autofillService.syncVault(unprotected, timeoutMs);
            }
          }
        } catch (_) {}
      })();

      return () => {
        cancelled = true;
      };
    } else if (mode === 'lock') {
      autofillService.lockSession().catch(() => {});
    }
  }, [vaultData, mode, isAppActive, password]);
}

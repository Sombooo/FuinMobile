import { NativeModules, Platform } from 'react-native';
import { extractNormalizedDomain } from './autofillMerge';

const { FuinAutofillModule } = NativeModules;
const DEFAULT_AUTOFILL_TIMEOUT_MS = 60_000;

export const autofillService = {
  /**
   * Check if autofill is supported on this platform/OS version.
   */
  isSupported() {
    return Platform.OS === 'android' && Platform.Version >= 26 && !!FuinAutofillModule;
  },

  /**
   * Check if Fuin is currently selected as the active Autofill Provider in OS settings.
   */
  async isEnabled() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAutofillModule.isAutofillEnabled();
    } catch (e) {
      console.warn('[AutofillService] isAutofillEnabled failed:', e);
      return false;
    }
  },

  /**
   * Open the Android system settings allowing the user to select Fuin as their Autofill Provider.
   */
  async openSettings() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAutofillModule.openAutofillSettings();
    } catch (e) {
      console.warn('[AutofillService] openAutofillSettings failed:', e);
      return false;
    }
  },

  /**
   * Synchronize active decrypted entries to the native autofill cache with session timeout (ms).
   * @param {Array} entries - Vault items array
   * @param {number} timeoutMs - Session validity in ms (default 60000 = 1 min)
   */
  async syncVault(entries, timeoutMs = DEFAULT_AUTOFILL_TIMEOUT_MS) {
    if (!this.isSupported() || !Array.isArray(entries)) return false;

    try {
      const sanitized = entries
        .filter((e) => e && !e.isDeleted && !e.deletedAt && (e.password || e.username))
        .map((e, index) => {
          let domain = '';
          const urls = [];

          const pushUrlCandidate = (rawCandidate) => {
            if (typeof rawCandidate !== 'string' || !rawCandidate.trim()) return;
            const trimmed = rawCandidate.trim();
            if (trimmed.toLowerCase().startsWith('androidapp://')) {
              const lower = trimmed.toLowerCase();
              if (!urls.includes(lower)) urls.push(lower);
            } else {
              const d = extractNormalizedDomain(trimmed);
              if (d) {
                if (!domain) domain = d;
                if (!urls.includes(d)) urls.push(d);
              }
            }
          };

          pushUrlCandidate(e.url);
          if (Array.isArray(e.urls)) {
            e.urls.forEach(pushUrlCandidate);
          }

          const rawTitle = String(e.site || e.name || e.title || '').trim();
          if (!domain && rawTitle.includes('.') && !rawTitle.includes(' ')) {
            pushUrlCandidate(rawTitle);
          }

          const resolvedUser = String(e.username || e.login || e.email || '');
          const resolvedId = String(e.id || '').trim() || `idx-${index}-${domain || rawTitle}-${resolvedUser}`;

          return {
            id: resolvedId,
            title: rawTitle || domain || '',
            username: resolvedUser,
            password: String(e.password || ''),
            domain,
            urls,
            reprompt: !!e.reprompt,
            totp: e.totp || null,
          };
        });

      const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs >= 0
        ? Math.min(Math.floor(timeoutMs), 86_400_000)
        : DEFAULT_AUTOFILL_TIMEOUT_MS;

      return await FuinAutofillModule.syncAutofillVault(JSON.stringify(sanitized), safeTimeout);
    } catch (e) {
      console.warn('[AutofillService] syncVault failed:', e?.message || 'error');
      return false;
    }
  },

  /**
   * Phase 1 of two-phase commit: read pending captured saves without deleting them.
   */
  async peekPendingSaves() {
    if (!this.isSupported() || typeof FuinAutofillModule.peekPendingSaves !== 'function') {
      return [];
    }
    try {
      const rawJson = await FuinAutofillModule.peekPendingSaves();
      if (!rawJson) return [];
      const parsed = JSON.parse(rawJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[AutofillService] peekPendingSaves failed:', e?.message || 'error');
      return [];
    }
  },

  /**
   * Phase 2 of two-phase commit: remove ONLY save IDs confirmed encrypted into fuin.enc.
   */
  async ackPendingSaves(ids) {
    if (!this.isSupported() || typeof FuinAutofillModule.ackPendingSaves !== 'function') {
      return false;
    }
    if (!Array.isArray(ids) || ids.length === 0) return true;
    const cleanIds = ids
      .filter((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 128)
      .slice(0, 50);
    if (cleanIds.length === 0) return true;
    try {
      return await FuinAutofillModule.ackPendingSaves(JSON.stringify(cleanIds));
    } catch (e) {
      console.warn('[AutofillService] ackPendingSaves failed:', e?.message || 'error');
      return false;
    }
  },

  /**
   * Wipe all cached credentials from native storage (e.g. on full vault erase).
   */
  async clearAll() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAutofillModule.clearAutofillVault();
    } catch (e) {
      console.warn('[AutofillService] clearAll failed:', e);
      return false;
    }
  },

  /**
   * Lock the session, requiring Biometric / Device Credential prompt for subsequent autofill.
   */
  async lockSession() {
    if (!this.isSupported()) return false;
    try {
      return await FuinAutofillModule.lockAutofillSession();
    } catch (e) {
      console.warn('[AutofillService] lockSession failed:', e);
      return false;
    }
  },
};

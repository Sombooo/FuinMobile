import { NativeModules, Platform } from 'react-native';

const { FuinAutofillModule } = NativeModules;

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
   * Synchronize active decrypted entries to the native autofill cache with session timeout.
   * @param {Array} entries - Vault items array
   * @param {number} timeoutMinutes - Session validity in minutes (default 15)
   */
  async syncVault(entries, timeoutMinutes = 15) {
    if (!this.isSupported()) return false;
    if (!Array.isArray(entries)) return false;

    try {
      const sanitized = entries
        .filter((e) => e && (e.password || e.username))
        .map((e) => {
          let domain = '';
          const urls = [];
          if (e.url) {
            try {
              const u = e.url.startsWith('http') ? e.url : `https://${e.url}`;
              domain = u.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
              urls.push(domain);
            } catch (_) {}
          }
          if (Array.isArray(e.urls)) {
            e.urls.forEach((u) => {
              if (typeof u === 'string') {
                const d = u.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
                if (d && !urls.includes(d)) urls.push(d);
              }
            });
          }

          const rawTitle = String(e.site || e.name || e.title || '');
          if (!domain && rawTitle.includes('.')) {
            try {
              const u = rawTitle.startsWith('http') ? rawTitle : `https://${rawTitle}`;
              const guessedDomain = u.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
              if (guessedDomain && !urls.includes(guessedDomain)) {
                domain = guessedDomain;
                urls.push(guessedDomain);
              }
            } catch (_) {}
          }

          return {
            id: String(e.id || ''),
            title: rawTitle || domain || '',
            username: String(e.username || e.login || e.email || ''),
            password: String(e.password || ''),
            domain: domain,
            urls: urls,
            reprompt: !!e.reprompt,
            totp: e.totp || null,
          };
        });

      return await FuinAutofillModule.syncAutofillVault(JSON.stringify(sanitized), timeoutMinutes);
    } catch (e) {
      console.warn('[AutofillService] syncVault failed:', e);
      return false;
    }
  },

  /**
   * Wipe all cached credentials from native storage (e.g. on full vault logout/clear).
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
   * Lock the session, requiring Master Password or Biometric prompt for subsequent autofill.
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

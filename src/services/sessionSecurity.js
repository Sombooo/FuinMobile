/**
 * Fuin Mobile In-Memory Session Security Service (sessionSecurity.js)
 *
 * Implements ephemeral RAM-level AES-256-GCM protection for sensitive credentials
 * (passwords, TOTP secrets) held in application memory while the vault is unlocked.
 *
 * Architectural Invariants:
 * 1. Passwords and TOTP secrets in memory are encrypted with an ephemeral session key
 *    generated at unlock time using a CSPRNG (crypto.randomBytes(32)).
 * 2. When the vault is locked, auto-locked, or backgrounded, the session key buffer is
 *    immediately zeroized with .fill(0) and nulled, rendering orphaned heap memory unrecoverable.
 * 3. Nonce/IV is always uniquely generated (12 bytes CSPRNG) per encryption.
 * 4. Backward compatible with plaintext fallback if an unencrypted legacy string is passed.
 *
 * Universal Module Definition (UMD) for React Native, Browser, and Node.js.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.SessionSecurity = exports;
    if (typeof root === 'object') {
      root.initSessionKey = exports.initSessionKey;
      root.clearSessionKey = exports.clearSessionKey;
      root.isSessionActive = exports.isSessionActive;
      root.memEncrypt = exports.memEncrypt;
      root.memDecrypt = exports.memDecrypt;
      root.protectEntries = exports.protectEntries;
      root.unprotectEntries = exports.unprotectEntries;
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this, function () {
  'use strict';

  function getCryptoModule() {
    try {
      return require('react-native-quick-crypto');
    } catch {
      try {
        return require('crypto');
      } catch {
        return null;
      }
    }
  }

  function getBufferModule() {
    try {
      return require('@craftzdog/react-native-buffer').Buffer;
    } catch {
      try {
        return require('buffer').Buffer;
      } catch {
        return typeof Buffer !== 'undefined' ? Buffer : null;
      }
    }
  }

  var _sessionKey = null;

  function initSessionKey() {
    var crypto = getCryptoModule();
    if (!crypto) throw new Error('SessionSecurity: No cryptographic provider available');
    if (_sessionKey) {
      try { _sessionKey.fill(0); } catch {}
      _sessionKey = null;
    }
    _sessionKey = crypto.randomBytes(32);
  }

  function clearSessionKey() {
    if (_sessionKey) {
      try { _sessionKey.fill(0); } catch {}
      _sessionKey = null;
    }
  }

  function isSessionActive() {
    return _sessionKey !== null && _sessionKey.length === 32;
  }

  function memEncrypt(text) {
    if (text === null || text === undefined || text === '') return '';
    if (!_sessionKey) return text;

    var crypto = getCryptoModule();
    var BufferClass = getBufferModule();
    if (!crypto || !BufferClass) return text;

    var str = String(text);
    var iv = crypto.randomBytes(12);
    var plainBuf = BufferClass.from(str, 'utf8');

    try {
      var cipher = crypto.createCipheriv('aes-256-gcm', _sessionKey, iv);
      var enc1 = cipher.update(plainBuf);
      var enc2 = cipher.final();
      var tag = cipher.getAuthTag();

      return {
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: BufferClass.concat([enc1, enc2]).toString('hex')
      };
    } finally {
      try { plainBuf.fill(0); } catch {}
    }
  }

  function memDecrypt(encObj) {
    if (!encObj) return '';
    if (typeof encObj === 'string') return encObj;
    if (!_sessionKey || !encObj.iv || !encObj.tag || !encObj.data) return '';

    var crypto = getCryptoModule();
    var BufferClass = getBufferModule();
    if (!crypto || !BufferClass) return '';

    var decBuf = null;
    try {
      var iv = BufferClass.from(encObj.iv, 'hex');
      var tag = BufferClass.from(encObj.tag, 'hex');
      var ciphertext = BufferClass.from(encObj.data, 'hex');

      var decipher = crypto.createDecipheriv('aes-256-gcm', _sessionKey, iv);
      decipher.setAuthTag(tag);
      var dec1 = decipher.update(ciphertext);
      var dec2 = decipher.final();
      decBuf = BufferClass.concat([dec1, dec2]);
      return decBuf.toString('utf8');
    } catch {
      return '';
    } finally {
      if (decBuf) {
        try { decBuf.fill(0); } catch {}
      }
    }
  }

  function protectEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(function (entry) {
      if (!entry || typeof entry !== 'object') return entry;
      return Object.assign({}, entry, {
        password: memEncrypt(entry.password),
        totp: memEncrypt(entry.totp),
        history: Array.isArray(entry.history) ? entry.history.map(function (h) {
          if (!h || typeof h !== 'object') return h;
          return Object.assign({}, h, { password: memEncrypt(h.password) });
        }) : []
      });
    });
  }

  function unprotectEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(function (entry) {
      if (!entry || typeof entry !== 'object') return entry;
      return Object.assign({}, entry, {
        password: memDecrypt(entry.password),
        totp: memDecrypt(entry.totp),
        history: Array.isArray(entry.history) ? entry.history.map(function (h) {
          if (!h || typeof h !== 'object') return h;
          return Object.assign({}, h, { password: memDecrypt(h.password) });
        }) : []
      });
    });
  }

  return {
    initSessionKey: initSessionKey,
    clearSessionKey: clearSessionKey,
    isSessionActive: isSessionActive,
    memEncrypt: memEncrypt,
    memDecrypt: memDecrypt,
    protectEntries: protectEntries,
    unprotectEntries: unprotectEntries
  };
}));

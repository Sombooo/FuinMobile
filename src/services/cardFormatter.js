/**
 * Fuin Mobile Card Formatter & Brand Detector (cardFormatter.js)
 *
 * Implements card brand detection and input masking for credit and debit cards.
 * Zero-dependency pure domain service.
 *
 * Architectural Invariants:
 * - Detects TROY, VISA, MASTERCARD, AMEX, DISCOVER, JCB, and MAESTRO brands.
 * - Formats card numbers with standard spacing (4-6-5 for AMEX, 4-digit groups for others).
 * - Formats expiration dates as MM/YY with automatic slash insertion and bounds checking.
 * - Adheres strictly to Universal Module Definition (UMD).
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.CardFormatter = exports;
    if (typeof root === 'object') {
      root.detectCardBrand = exports.detectCardBrand;
      root.formatCardNumber = exports.formatCardNumber;
      root.formatCardExpiry = exports.formatCardExpiry;
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this, function () {
  'use strict';

  function detectCardBrand(digits) {
    if (!digits) return null;
    var d = String(digits).replace(/\D/g, '');
    if (!d) return null;
    if (/^9792/.test(d)) return { name: 'TROY', brand: 'troy', maxLen: 16, format: [4, 4, 4, 4] };
    if (/^4/.test(d)) return { name: 'VISA', brand: 'visa', maxLen: 16, format: [4, 4, 4, 4] };
    if (/^(5[1-5]|2[2-7])/.test(d)) return { name: 'MASTERCARD', brand: 'mastercard', maxLen: 16, format: [4, 4, 4, 4] };
    if (/^3[47]/.test(d)) return { name: 'AMEX', brand: 'amex', maxLen: 15, format: [4, 6, 5] };
    if (/^(6011|65|64[4-9])/.test(d)) return { name: 'DISCOVER', brand: 'discover', maxLen: 16, format: [4, 4, 4, 4] };
    if (/^35(2[89]|[3-8][0-9])/.test(d)) return { name: 'JCB', brand: 'jcb', maxLen: 16, format: [4, 4, 4, 4] };
    if (/^(50|5[6-8]|6)/.test(d)) return { name: 'MAESTRO', brand: 'maestro', maxLen: 19, format: [4, 4, 4, 4, 3] };
    return { name: '', brand: 'generic', maxLen: 19, format: [4, 4, 4, 4, 3] };
  }

  function formatCardNumber(val) {
    var digits = String(val || '').replace(/\D/g, '');
    var info = detectCardBrand(digits);
    var maxDigits = (info && info.maxLen) ? info.maxLen : 19;
    var cleanDigits = digits.slice(0, maxDigits);

    var formatted = '';
    if (info && info.brand === 'amex') {
      var p1 = cleanDigits.slice(0, 4);
      var p2 = cleanDigits.slice(4, 10);
      var p3 = cleanDigits.slice(10, 15);
      formatted = [p1, p2, p3].filter(Boolean).join(' ');
    } else {
      var parts = [];
      for (var i = 0; i < cleanDigits.length; i += 4) {
        parts.push(cleanDigits.slice(i, i + 4));
      }
      formatted = parts.join(' ');
    }
    return { formatted: formatted, brandInfo: info, rawDigits: cleanDigits };
  }

  function formatCardExpiry(val) {
    var digits = String(val || '').replace(/\D/g, '').slice(0, 4);
    if (!digits) return '';
    if (digits.length === 1 && parseInt(digits[0], 10) > 1) {
      return '0' + digits + '/';
    }
    if (digits.length >= 2) {
      var month = parseInt(digits.slice(0, 2), 10);
      if (month > 12) month = 12;
      if (month === 0) month = 1;
      var mm = month.toString().padStart(2, '0');
      var yy = digits.slice(2);
      return yy ? (mm + '/' + yy) : (mm + '/');
    }
    return digits;
  }

  return {
    detectCardBrand: detectCardBrand,
    formatCardNumber: formatCardNumber,
    formatCardExpiry: formatCardExpiry
  };
}));

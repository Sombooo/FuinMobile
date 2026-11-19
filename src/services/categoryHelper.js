/**
 * Fuin Mobile Category Normalization & Localization Helper (categoryHelper.js)
 *
 * Maps Desktop and Mobile Turkish/English standard category names to shared
 * i18n keys and canonical storage names so synced entries always display in the
 * active UI language without fragmenting category buckets or breaking custom
 * user-defined categories.
 *
 * Adheres strictly to Universal Module Definition (UMD).
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.FuinCategoryHelper = exports;
    if (typeof root === 'object') {
      root.getCategoryKey = exports.getCategoryKey;
      root.canonicalizeCategory = exports.canonicalizeCategory;
      root.getCategoryLabel = exports.getCategoryLabel;
      root.isSameCategory = exports.isSameCategory;
      root.resolveCategoryPillLabel = exports.resolveCategoryPillLabel;
      root.STANDARD_CATEGORY_KEYS = exports.STANDARD_CATEGORY_KEYS;
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this, function () {
  'use strict';

  function normalizeToken(raw) {
    if (raw === null || raw === undefined) return '';
    // Strip Unicode combining dot above (\u0307) produced by Turkish 'İ'.toLowerCase()
    return String(raw).trim().toLowerCase().replace(/\u0307/g, '');
  }

  var STANDARD_CATEGORIES = [
    { key: 'cat_social', canonical: 'Sosyal Medya', aliases: ['sosyal medya', 'sosyal', 'social media', 'social'] },
    { key: 'cat_email', canonical: 'E-posta', aliases: ['e-posta', 'eposta', 'email', 'e-mail'] },
    { key: 'cat_work', canonical: 'İş / Kurumsal', aliases: ['iş / kurumsal', 'is / kurumsal', 'iş', 'work / corporate', 'work'] },
    { key: 'cat_shopping', canonical: 'Alışveriş', aliases: ['alışveriş', 'alisveris', 'e-ticaret', 'eticaret', 'shopping'] },
    { key: 'cat_finance', canonical: 'Finans', aliases: ['finans', 'finance'] },
    { key: 'cat_gaming', canonical: 'Oyun', aliases: ['oyun', 'gaming', 'games'] },
    { key: 'cat_dev', canonical: 'Geliştirici / Araçlar', aliases: ['geliştirici / araçlar', 'gelistirici / araclar', 'geliştirici', 'gelistirici', 'developer / tools', 'developer'] },
    { key: 'cat_education', canonical: 'Eğitim', aliases: ['eğitim', 'egitim', 'education'] },
    { key: 'cat_other', canonical: 'Diğer', aliases: ['diğer', 'diger', 'other'] }
  ];

  var SPECIAL_FILTER_ALIASES = {
    'hepsi': 'cat_all',
    'all': 'cat_all',
    'girişler': 'navLogins',
    'girisler': 'navLogins',
    'logins': 'navLogins',
    'kartlar': 'navCards',
    'cards': 'navCards',
    'notlar': 'navNotes',
    'notes': 'navNotes',
    'favoriler': 'cat_fav',
    'favorites': 'cat_fav',
    'çöp kutusu': 'cat_trash',
    'cop kutusu': 'cat_trash',
    'trash': 'cat_trash'
  };

  var STANDARD_CATEGORY_KEYS = STANDARD_CATEGORIES.map(function (c) { return c.key; });

  var ALIAS_MAP = Object.create(null);
  STANDARD_CATEGORIES.forEach(function (def) {
    ALIAS_MAP[normalizeToken(def.canonical)] = def;
    def.aliases.forEach(function (alias) {
      ALIAS_MAP[normalizeToken(alias)] = def;
    });
  });

  function findCategoryDef(raw) {
    var norm = normalizeToken(raw);
    return norm ? (ALIAS_MAP[norm] || null) : null;
  }

  function getCategoryKey(raw) {
    var def = findCategoryDef(raw);
    return def ? def.key : null;
  }

  function canonicalizeCategory(raw) {
    var trimmed = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!trimmed) return '';
    var def = findCategoryDef(trimmed);
    return def ? def.canonical : trimmed;
  }

  function getCategoryLabel(raw, t) {
    var trimmed = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!trimmed) return '';
    var def = findCategoryDef(trimmed);
    if (def && typeof t === 'function') {
      var translated = t(def.key);
      if (translated && translated !== def.key) return translated;
    }
    return trimmed;
  }

  function resolveCategoryPillLabel(raw, t) {
    var norm = normalizeToken(raw);
    if (norm && SPECIAL_FILTER_ALIASES[norm] && typeof t === 'function') {
      var specialKey = SPECIAL_FILTER_ALIASES[norm];
      var specialLabel = t(specialKey);
      if (specialLabel && specialLabel !== specialKey) return specialLabel;
    }
    return getCategoryLabel(raw, t);
  }

  function isSameCategory(a, b) {
    var keyA = getCategoryKey(a);
    var keyB = getCategoryKey(b);
    if (keyA && keyB) return keyA === keyB;
    return normalizeToken(a) === normalizeToken(b);
  }

  return {
    STANDARD_CATEGORY_KEYS: STANDARD_CATEGORY_KEYS,
    findCategoryDef: findCategoryDef,
    getCategoryKey: getCategoryKey,
    canonicalizeCategory: canonicalizeCategory,
    getCategoryLabel: getCategoryLabel,
    resolveCategoryPillLabel: resolveCategoryPillLabel,
    isSameCategory: isSameCategory
  };
}));

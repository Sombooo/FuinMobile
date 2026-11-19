import { useState, useMemo, useEffect, useRef } from 'react';
import crypto from 'react-native-quick-crypto';

import { getCategoryKey, getCategoryLabel, isSameCategory, resolveCategoryPillLabel } from '../services/categoryHelper';

const SPECIAL_CAT_KEYS = ['cat_all', 'navLogins', 'navCards', 'navNotes', 'cat_fav', 'cat_trash'];

/**
 * Hook to manage vault entry parsing, deduplication, search filtering, and category selection.
 * @param {Object} options
 * @param {string|null} options.vaultData - Raw encrypted/decrypted vault JSON string
 * @param {Function} options.t - i18n translation function
 */
export function useVaultSearch({ vaultData, t }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(t('cat_all'));
  const prevTRef = useRef(t);

  useEffect(() => {
    const prevT = prevTRef.current;
    if (prevT === t) return;
    prevTRef.current = t;
    for (const key of SPECIAL_CAT_KEYS) {
      if (activeCategory === prevT(key)) {
        setActiveCategory(t(key));
        break;
      }
    }
  }, [t, activeCategory]);

  const DEFAULT_CATEGORIES = useMemo(() => [
    t('navLogins'),
    t('navCards'),
    t('navNotes'),
    t('cat_fav'),
    t('cat_trash'),
    t('cat_social'),
    t('cat_email'),
    t('cat_work'),
    t('cat_shopping'),
    t('cat_finance'),
    t('cat_gaming'),
    t('cat_dev'),
    t('cat_education'),
    t('cat_other')
  ], [t]);

  useEffect(() => {
    const stdKey = getCategoryKey(activeCategory);
    if (stdKey && activeCategory !== t(stdKey)) {
      setActiveCategory(t(stdKey));
    }
  }, [t]);

  const parsedVault = useMemo(() => {
    try {
      const parsed = JSON.parse(vaultData);
      let rawEntries = [];
      let rawCategories = [];

      if (Array.isArray(parsed)) {
        rawEntries = parsed;
      } else {
        rawCategories = parsed.categories || [];
        rawEntries = parsed.entries || [];
      }

      // İçerik çakışmalarını temizle (aynı tip, başlık ve kimlik/şifreye sahipse sadece 1 tanesini tut)
      const seenContent = new Set();
      const deduplicatedEntries = rawEntries.filter(e => {
        const type = e.type || 'login';
        let secretKey = '';
        if (type === 'card') {
          const cardKey = typeof e.cardNumber === 'object' && e.cardNumber ? e.cardNumber.data : String(e.cardNumber || '');
          secretKey = `${e.cardholderName || e.username || ''}||${cardKey}`;
        } else if (type === 'note') {
          const noteKey = typeof e.secureNote === 'object' && e.secureNote ? e.secureNote.data : String(e.secureNote || '');
          secretKey = noteKey;
        } else {
          const pwKey = typeof e.password === 'object' && e.password ? e.password.data : String(e.password || '');
          secretKey = `${e.username || ''}||${pwKey}`;
        }
        const key = `${type}||${e.site || ''}||${secretKey}`;
        if (seenContent.has(key)) return false;
        seenContent.add(key);
        return true;
      });

      // Mevcut kaydedilmiş verilerdeki ID çakışmalarını temizle
      const seenIds = new Set();
      const cleanedEntries = deduplicatedEntries.map(e => {
        let id = e.id;
        while (seenIds.has(id) || !id) {
          id = crypto.randomUUID();
        }
        seenIds.add(id);
        return { ...e, id };
      });

      return {
        categories: rawCategories,
        entries: cleanedEntries
      };
    } catch (e) {
      return { categories: [], entries: [] };
    }
  }, [vaultData]);

  const allCategories = useMemo(() => {
    const localizedParsed = (parsedVault.categories || [])
      .map(c => resolveCategoryPillLabel(c, t))
      .filter(Boolean);
    return [t('cat_all'), ...new Set([...DEFAULT_CATEGORIES, ...localizedParsed])];
  }, [DEFAULT_CATEGORIES, parsedVault.categories, t]);

  const entries = parsedVault.entries;

  const filteredEntries = useMemo(() => {
    let filtered = entries;
    if (activeCategory === t('cat_trash')) {
      filtered = filtered.filter(e => e.isDeleted);
    } else {
      filtered = filtered.filter(e => !e.isDeleted);
      if (activeCategory === t('cat_fav')) {
        filtered = filtered.filter(e => e.fav);
      } else if (activeCategory === t('navLogins')) {
        filtered = filtered.filter(e => !e.type || e.type === 'login');
      } else if (activeCategory === t('navCards')) {
        filtered = filtered.filter(e => e.type === 'card');
      } else if (activeCategory === t('navNotes')) {
        filtered = filtered.filter(e => e.type === 'note');
      } else if (activeCategory !== t('cat_all')) {
        filtered = filtered.filter(e => isSameCategory(e.category || (e.type === 'card' ? 'Finans' : 'Diğer'), activeCategory));
      }
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        (e.site || '').toLowerCase().includes(q) ||
        (e.username || '').toLowerCase().includes(q) ||
        (e.cardholderName || '').toLowerCase().includes(q) ||
        (e.cardBrand || '').toLowerCase().includes(q) ||
        (e.cardLastFour || '').toLowerCase().includes(q) ||
        (e.note || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        getCategoryLabel(e.category || (e.type === 'card' ? 'Finans' : 'Diğer'), t).toLowerCase().includes(q)
      );
    }

    return filtered.sort((a, b) => (a.site || '').localeCompare(b.site || ''));
  }, [entries, activeCategory, searchQuery, t]);

  return {
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    parsedVault,
    DEFAULT_CATEGORIES,
    allCategories,
    entries,
    filteredEntries
  };
}

export default useVaultSearch;

import { useState, useMemo } from 'react';
import crypto from 'react-native-quick-crypto';

/**
 * Hook to manage vault entry parsing, deduplication, search filtering, and category selection.
 * @param {Object} options
 * @param {string|null} options.vaultData - Raw encrypted/decrypted vault JSON string
 * @param {Function} options.t - i18n translation function
 */
export function useVaultSearch({ vaultData, t }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(t('cat_all'));

  const DEFAULT_CATEGORIES = useMemo(() => [
    t('cat_fav'),
    t('cat_trash'),
    t('cat_social'),
    t('cat_work'),
    t('cat_shopping'),
    t('cat_finance'),
    t('cat_education'),
    t('cat_other')
  ], [t]);

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

      // İçerik çakışmalarını temizle (aynı site, kullanıcı adı ve şifreye sahipse sadece 1 tanesini tut)
      const seenContent = new Set();
      const deduplicatedEntries = rawEntries.filter(e => {
        const pwKey = typeof e.password === 'object' && e.password ? e.password.data : String(e.password || '');
        const key = `${e.site}||${e.username}||${pwKey}`;
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
    return [t('cat_all'), ...new Set([...DEFAULT_CATEGORIES, ...parsedVault.categories])];
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
      } else if (activeCategory !== t('cat_all')) {
        filtered = filtered.filter(e => (e.category || t('cat_other')) === activeCategory);
      }
    }
    
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        (e.site || '').toLowerCase().includes(q) ||
        (e.username || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q)
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

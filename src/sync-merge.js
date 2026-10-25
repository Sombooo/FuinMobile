/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUIN MOBILE: Two-Way Conflict-Free Deterministic Merge Engine (sync-merge.js)
 *
 * Implements R3 Deterministic Merge for Mobile:
 *   1. Preserves local-only entries without silent overwrites.
 *   2. Adds remote-only entries.
 *   3. Resolves conflicts by updatedAt timestamp:
 *      - Newer version becomes active record.
 *      - Older version is archived into `history` array.
 *   4. Supports tombstone deletions (deletedAt / isDeleted).
 *   5. Deterministic tie-breaking if timestamps match.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

function parseTimestamp(val) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
    const num = Number(val);
    if (!isNaN(num)) return num;
  }
  return null;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const now = Date.now();
  const maxAllowedTs = now + 300000; // +5 min clock-skew ceiling (blocks future timestamp poisoning)
  const id = entry.id || `${now}-${Math.random().toString(36).substring(2, 9)}`;

  let rawUpdatedAt = parseTimestamp(entry.updatedAt) ??
                     parseTimestamp(entry.updated) ??
                     parseTimestamp(entry.createdAt) ??
                     parseTimestamp(entry.created) ??
                     now;
  let updatedAt = Math.min(rawUpdatedAt, maxAllowedTs);

  let rawDeletedAt = parseTimestamp(entry.deletedAt);
  let deletedAt = rawDeletedAt !== null ? Math.min(rawDeletedAt, maxAllowedTs) : null;
  if (deletedAt === null && entry.isDeleted) {
    deletedAt = updatedAt;
  }

  if (deletedAt !== null && deletedAt > updatedAt) {
    updatedAt = deletedAt;
  }

  const isDeleted = deletedAt !== null;

  const safeBase = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      safeBase[k] = v;
    }
  }

  const sanitized = {
    ...safeBase,
    id,
    updatedAt,
    updated: updatedAt,
    deletedAt,
    isDeleted,
    history: Array.isArray(entry.history) ? [...entry.history] : []
  };
  return sanitized;
}

function createHistorySnapshot(entry) {
  const { history, ...snapshot } = entry;
  return {
    ...snapshot,
    archivedAt: Date.now()
  };
}

function mergeHistories(winnerHistory, loserHistory, loserEntry) {
  const combined = [];
  const seen = new Set();

  function addSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    const key = `${snap.updatedAt || snap.updated || 0}_${snap.site || ''}_${snap.username || ''}_${snap.password || ''}_${snap.note || ''}_${snap.totp || ''}_${snap.deletedAt || (snap.isDeleted ? 'del' : 'act')}`;
    if (!seen.has(key)) {
      seen.add(key);
      const { history: _ignored, ...cleanSnap } = snap;
      combined.push(cleanSnap);
    }
  }

  if (Array.isArray(winnerHistory)) {
    for (const h of winnerHistory) addSnapshot(h);
  }
  if (Array.isArray(loserHistory)) {
    for (const h of loserHistory) addSnapshot(h);
  }
  if (loserEntry) {
    addSnapshot(createHistorySnapshot(loserEntry));
  }

  combined.sort((a, b) => (b.updatedAt || b.updated || 0) - (a.updatedAt || a.updated || 0));
  return combined;
}

function areCoreFieldsEqual(a, b) {
  return (
    (a.site || '') === (b.site || '') &&
    (a.username || '') === (b.username || '') &&
    (a.password || '') === (b.password || '') &&
    ((a.category || '').trim() || 'Diğer') === ((b.category || '').trim() || 'Diğer') &&
    (a.note || '') === (b.note || '') &&
    (a.url || '') === (b.url || '') &&
    (a.totp || '') === (b.totp || '') &&
    Boolean(a.fav) === Boolean(b.fav) &&
    (a.deletedAt || null) === (b.deletedAt || null) &&
    Boolean(a.isDeleted) === Boolean(b.isDeleted)
  );
}

function normalizeSite(s) {
  return (s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

function getCredentialKey(e) {
  if (!e || e.isDeleted || e.deletedAt) return '';
  const site = normalizeSite(e.site);
  const user = (e.username || '').trim().toLowerCase();
  return (site && user) ? `${site}||${user}` : '';
}

export function mergeVaultEntries(localEntries, remoteEntries) {
  const normLocal = (Array.isArray(localEntries) ? localEntries : []).map(normalizeEntry).filter(Boolean);
  const normRemote = (Array.isArray(remoteEntries) ? remoteEntries : []).map(normalizeEntry).filter(Boolean);

  const localMap = new Map();
  const localKeyMap = new Map();
  for (const e of normLocal) {
    const credKey = getCredentialKey(e);
    if (credKey && localKeyMap.has(credKey)) {
      const existingId = localKeyMap.get(credKey);
      const existing = localMap.get(existingId);
      if (existing && e.updatedAt > existing.updatedAt) {
        localMap.delete(existingId);
        localMap.set(e.id, e);
        localKeyMap.set(credKey, e.id);
      }
      continue;
    }

    if (localMap.has(e.id)) {
      const prev = localMap.get(e.id);
      if (e.updatedAt > prev.updatedAt) localMap.set(e.id, e);
    } else {
      localMap.set(e.id, e);
      if (credKey) localKeyMap.set(credKey, e.id);
    }
  }

  const remoteMap = new Map();
  const remoteKeyMap = new Map();
  for (const e of normRemote) {
    const credKey = getCredentialKey(e);
    if (credKey && remoteKeyMap.has(credKey)) {
      const existingId = remoteKeyMap.get(credKey);
      const existing = remoteMap.get(existingId);
      if (existing && e.updatedAt > existing.updatedAt) {
        remoteMap.delete(existingId);
        remoteMap.set(e.id, e);
        remoteKeyMap.set(credKey, e.id);
      }
      continue;
    }

    // Semantic match: if remote entry matches a local credential by site+username with different ID, unify ID!
    if (credKey && localKeyMap.has(credKey) && !localMap.has(e.id)) {
      const matchedLocalId = localKeyMap.get(credKey);
      const unifiedEntry = { ...e, id: matchedLocalId };
      remoteMap.set(matchedLocalId, unifiedEntry);
      remoteKeyMap.set(credKey, matchedLocalId);
      continue;
    }

    if (remoteMap.has(e.id)) {
      const prev = remoteMap.get(e.id);
      if (e.updatedAt > prev.updatedAt) remoteMap.set(e.id, e);
    } else {
      remoteMap.set(e.id, e);
      if (credKey) remoteKeyMap.set(credKey, e.id);
    }
  }

  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const mergedEntries = [];

  let addedFromRemote = 0;
  let addedFromLocal = 0;
  let conflictsResolved = 0;
  let identicalMatches = 0;

  for (const id of allIds) {
    const loc = localMap.get(id);
    const rem = remoteMap.get(id);

    if (loc && !rem) {
      mergedEntries.push(loc);
      addedFromLocal++;
    } else if (!loc && rem) {
      mergedEntries.push(rem);
      addedFromRemote++;
    } else {
      if (areCoreFieldsEqual(loc, rem)) {
        const mergedHistory = mergeHistories(loc.history, rem.history, null);
        mergedEntries.push({
          ...loc,
          history: mergedHistory
        });
        identicalMatches++;
      } else {
        let winner, loser;

        if (loc.updatedAt > rem.updatedAt) {
          winner = loc;
          loser = rem;
        } else if (rem.updatedAt > loc.updatedAt) {
          winner = rem;
          loser = loc;
        } else {
          // Tie-breaker: canonical JSON comparison
          const canonical = (o) => JSON.stringify([
            o.id || '',
            o.site || '',
            o.username || '',
            o.password || '',
            o.category || '',
            o.note || '',
            o.url || '',
            o.totp || '',
            o.updatedAt || 0,
            o.deletedAt || 0
          ]);
          if (canonical(loc) >= canonical(rem)) {
            winner = loc;
            loser = rem;
          } else {
            winner = rem;
            loser = loc;
          }
        }

        const mergedHistory = mergeHistories(winner.history, loser.history, loser);
        mergedEntries.push({
          ...winner,
          history: mergedHistory
        });
        conflictsResolved++;
      }
    }
  }

  mergedEntries.sort((a, b) => {
    const sA = (a.site || '').toLowerCase();
    const sB = (b.site || '').toLowerCase();
    if (sA !== sB) return sA.localeCompare(sB);
    return (a.id || '').localeCompare(b.id || '');
  });

  return {
    mergedEntries,
    stats: {
      total: mergedEntries.length,
      addedFromRemote,
      addedFromLocal,
      conflictsResolved,
      identicalMatches
    }
  };
}

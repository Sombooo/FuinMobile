/**
 * Pure domain normalization, ccTLD/multi-tenant equivalence, and pending save merger
 * for Fuin Mobile Autofill. Kept free of React Native runtime imports so unit tests
 * can verify exact production logic directly in Node.js.
 */

const COMPOUND_PUBLIC_SUFFIXES = new Set([
  'com.tr', 'org.tr', 'edu.tr', 'gov.tr', 'net.tr', 'bel.tr', 'k12.tr',
  'gen.tr', 'av.tr', 'dr.tr', 'pol.tr', 'tsk.tr',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'co.in', 'co.nz', 'co.za', 'co.kr',
]);

const STANDARD_CCTLD_SLDS = new Set([
  'co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go',
  'gob', 'mil', 'biz', 'info', 'gen', 'web', 'nom', 'bel', 'pol', 'k12',
  'av', 'bbs', 'dr', 'firm', 'ind', 'kep', 'me', 'tsk',
]);

const MULTI_TENANT_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev',
  'firebaseapp.com', 'web.app', 'blogspot.com', 'herokuapp.com',
  'onrender.com', 'workers.dev', 'fly.dev', 'railway.app',
  'wordpress.com', 'tumblr.com', 'azurewebsites.net', 'appspot.com',
  'cloudfront.net', 'run.app', 'replit.app', 'hf.space',
  'webflow.io', 'notion.site', 'itch.io',
  'trycloudflare.com', 'pythonanywhere.com',
  '000webhostapp.com', 'amplifyapp.com', 'azureedge.net', 'b-cdn.net',
  'blob.core.windows.net', 'deno.dev', 'elasticbeanstalk.com', 'fastly.net',
  'ghost.io', 'glitch.me', 'myshopify.com', 'ngrok-free.app',
  'ngrok.io', 'pantheonsite.io', 'pipedream.net', 'render.com',
  's3.amazonaws.com', 'substack.com', 'surge.sh', 'trafficmanager.net',
  'up.railway.app', 'wixsite.com',
]);

function isIpLiteral(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h.includes(':')) {
    return /^[0-9a-f:.]+$/.test(h);
  }
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    return true;
  }
  return parts.length >= 2 && parts.every((p) => /^\d+$/.test(p));
}

/**
 * Extracts a clean lowercase hostname while stripping userinfo (`user:pass@`) BEFORE port (`:port`)
 * to prevent `https://google.com:443@evil.com/login` host-confusion attacks.
 * Supports bracketed and bare IPv6 literals as well as IPv4 literals.
 */
function extractNormalizedDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith('androidapp://')) return '';

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const authorityPart = withoutScheme.split(/[/?#]/)[0] || '';
  const atIdx = authorityPart.lastIndexOf('@');
  const hostPort = atIdx >= 0 ? authorityPart.slice(atIdx + 1) : authorityPart;

  if (hostPort.startsWith('[')) {
    const endBracket = hostPort.indexOf(']');
    if (endBracket > 1) {
      const ipv6 = hostPort.slice(1, endBracket).trim();
      return ipv6.includes(':') && /^[0-9a-f:.]+$/.test(ipv6) ? ipv6 : '';
    }
    return '';
  }

  const colonCount = (hostPort.match(/:/g) || []).length;
  if (colonCount > 1 && /^[0-9a-f:.]+$/.test(hostPort)) {
    return hostPort.trim();
  }

  const host = hostPort
    .split(':')[0]
    .replace(/^www\./, '')
    .replace(/\.+$/, '')
    .trim();

  return host.includes('.') ? host : '';
}

function getRegistrableDomain(host) {
  const clean = String(host || '').toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!clean) return null;
  if (isIpLiteral(clean)) return clean;

  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const lastTwo = `${sld}.${tld}`;
  const isCompoundSuffix =
    COMPOUND_PUBLIC_SUFFIXES.has(lastTwo) ||
    (tld.length === 2 && /^[a-z]{2}$/.test(tld) && STANDARD_CCTLD_SLDS.has(sld));

  if (isCompoundSuffix) {
    if (parts.length < 3) return null;
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }
  return lastTwo;
}

function areDomainsEquivalent(domainA, domainB) {
  const q = extractNormalizedDomain(domainA);
  const e = extractNormalizedDomain(domainB);
  if (!q || !e) return false;
  if (q === e) return true;
  if (isIpLiteral(q) || isIpLiteral(e)) return false;

  let matchedMt = null;
  for (const mt of MULTI_TENANT_SUFFIXES) {
    if (q === mt || e === mt || q.endsWith(`.${mt}`) || e.endsWith(`.${mt}`)) {
      if (!matchedMt || mt.length > matchedMt.length) {
        matchedMt = mt;
      }
    }
  }
  if (matchedMt) {
    if (q === matchedMt || e === matchedMt) return false;
    const minLenHost = q.length <= e.length ? q : e;
    return (
      (q.endsWith(`.${e}`) || e.endsWith(`.${q}`)) &&
      minLenHost.split('.').length > matchedMt.split('.').length
    );
  }

  const qReg = getRegistrableDomain(q);
  const eReg = getRegistrableDomain(e);
  return qReg !== null && qReg === eReg;
}

/**
 * Merges captured Android Autofill saves into decrypted vault entries without substring collisions.
 * Returns `{ entries, changed, acknowledgedIds }`.
 */
function mergePendingAutofillSaves(entries, pendingSaves) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safePending = Array.isArray(pendingSaves) ? pendingSaves : [];

  if (safePending.length === 0) {
    return { entries: safeEntries, changed: false, acknowledgedIds: [] };
  }

  const updatedList = [...safeEntries];
  const acknowledgedIds = [];
  let changed = false;

  for (const saved of safePending) {
    if (!saved || typeof saved !== 'object') continue;
    const savedId = String(saved.id || '').trim();
    const savedPass = String(saved.password || '');
    if (!savedPass) {
      if (savedId) acknowledgedIds.push(savedId);
      continue;
    }

    const savedUser = String(saved.username || '').trim();
    const savedDomain = extractNormalizedDomain(saved.domain || saved.url || '');
    const savedUrl = String(saved.url || '').trim();
    const savedSite = String(saved.site || saved.title || savedDomain || 'Yeni Kayıt').trim();
    const now = Number(saved.createdAt) || Date.now();

    const existingIdx = updatedList.findIndex((item) => {
      if (!item || item.isDeleted || item.deletedAt) return false;
      const itemUser = String(item.username || '').trim().toLowerCase();
      if (itemUser !== savedUser.toLowerCase()) return false;

      const itemUrl = String(item.url || '').trim();
      const itemSite = String(item.site || item.title || '').trim();

      if (savedDomain) {
        const itemDomain = extractNormalizedDomain(itemUrl) || extractNormalizedDomain(itemSite);
        if (itemDomain && areDomainsEquivalent(itemDomain, savedDomain)) {
          return true;
        }
      }

      if (savedUrl && itemUrl.toLowerCase() === savedUrl.toLowerCase()) {
        return true;
      }

      return false;
    });

    if (existingIdx >= 0) {
      const prev = updatedList[existingIdx];
      if (prev.password !== savedPass) {
        let history = Array.isArray(prev.history) ? [...prev.history] : [];
        if (prev.password) {
          history.unshift({ password: prev.password, date: now });
          if (history.length > 5) history = history.slice(0, 5);
        }
        updatedList[existingIdx] = {
          ...prev,
          password: savedPass,
          history,
          updated: now,
          updatedAt: now,
        };
        changed = true;
      }
    } else {
      updatedList.unshift({
        id: savedId || `${now}-${Math.random().toString(36).slice(2, 8)}`,
        site: savedSite,
        title: savedSite,
        username: savedUser,
        password: savedPass,
        url: savedUrl,
        notes: '',
        note: '',
        category: 'Diğer',
        fav: false,
        isDeleted: false,
        deletedAt: null,
        created: now,
        updated: now,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }

    if (savedId) {
      acknowledgedIds.push(savedId);
    }
  }

  return { entries: updatedList, changed, acknowledgedIds };
}

module.exports = {
  extractNormalizedDomain,
  getRegistrableDomain,
  areDomainsEquivalent,
  mergePendingAutofillSaves,
};

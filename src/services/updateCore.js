/**
 * Pure, dependency-free version comparison, URL allowlisting, and GitHub Release
 * APK asset/SHA-256 parser for Fuin Mobile Self-Updater.
 * Kept free of React Native runtime imports so Node.js unit tests can verify exact production logic.
 */

const GITHUB_MOBILE_RELEASES_URL = 'https://api.github.com/repos/Sombooo/FuinMobile/releases';
const TRUSTED_REPO_PATH_PREFIX = '/Sombooo/FuinMobile/releases/download/';

function normalizeVersion(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

function isNewerVersion(latest, current) {
  const l = normalizeVersion(latest);
  const c = normalizeVersion(current);
  if (!l || !c || l === c) return false;

  const [lCore, lPre] = l.split('-');
  const [cCore, cPre] = c.split('-');

  const lParts = lCore.split('.').map((x) => parseInt(x, 10) || 0);
  const cParts = cCore.split('.').map((x) => parseInt(x, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const lp = lParts[i] || 0;
    const cp = cParts[i] || 0;
    if (lp > cp) return true;
    if (lp < cp) return false;
  }

  // Stable release is newer than prerelease of same core version (e.g. 1.0.0 > 1.0.0-beta.5)
  if (!lPre && cPre) return true;
  if (lPre && !cPre) return false;

  if (lPre && cPre) {
    const lPreParts = lPre.split('.');
    const cPreParts = cPre.split('.');
    for (let i = 0; i < Math.max(lPreParts.length, cPreParts.length); i++) {
      const lp = lPreParts[i];
      const cp = cPreParts[i];
      if (lp === undefined) return false;
      if (cp === undefined) return true;
      const ln = parseInt(lp, 10);
      const cn = parseInt(cp, 10);
      if (!Number.isNaN(ln) && !Number.isNaN(cn)) {
        if (ln > cn) return true;
        if (ln < cn) return false;
      } else if (lp > cp) {
        return true;
      } else if (lp < cp) {
        return false;
      }
    }
  }

  return false;
}

/**
 * Strictly validates that an APK download URL belongs to the official
 * https://github.com/Sombooo/FuinMobile/releases/download/... namespace over HTTPS.
 */
function isTrustedApkAssetUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.hostname !== 'github.com') return false;
    if (!parsed.pathname.startsWith(TRUSTED_REPO_PATH_PREFIX)) return false;
    if (!parsed.pathname.toLowerCase().endsWith('.apk')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts a 64-char hex SHA-256 digest from GitHub's native `asset.digest` field
 * (`"sha256:<64-hex>"`) or from an explicit `SHA256: <64-hex>` entry in the release notes.
 */
function extractExpectedSha256(apkAsset, releaseBody) {
  if (apkAsset && typeof apkAsset.digest === 'string') {
    const rawDigest = apkAsset.digest.trim().toLowerCase();
    const withoutPrefix = rawDigest.startsWith('sha256:') ? rawDigest.slice(7).trim() : rawDigest;
    if (/^[0-9a-f]{64}$/.test(withoutPrefix)) {
      return withoutPrefix;
    }
  }

  if (typeof releaseBody === 'string' && releaseBody.trim()) {
    const assetName = apkAsset && typeof apkAsset.name === 'string' ? apkAsset.name.trim() : '';
    const lines = releaseBody.split(/\r?\n/);
    for (const line of lines) {
      if (assetName && line.includes(assetName)) {
        const m = line.match(/\b([0-9a-fA-F]{64})\b/);
        if (m) return m[1].toLowerCase();
      }
    }
    const genericMatch = releaseBody.match(/sha-?256\s*[:=]\s*`?([0-9a-fA-F]{64})`?/i);
    if (genericMatch) {
      return genericMatch[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Selects the newest valid, non-draft release from GitHub Releases array that is newer than
 * `currentVersion` and contains a trusted `.apk` binary asset.
 */
function selectLatestApkRelease(releases, currentVersion) {
  if (!Array.isArray(releases) || releases.length === 0) return null;

  for (const rel of releases) {
    if (!rel || typeof rel !== 'object' || rel.draft) continue;
    const tag = String(rel.tag_name || '').trim();
    if (!tag || !isNewerVersion(tag, currentVersion)) continue;

    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const apkAsset = assets.find(
      (a) =>
        a &&
        typeof a.name === 'string' &&
        a.name.toLowerCase().endsWith('.apk') &&
        isTrustedApkAssetUrl(a.browser_download_url)
    );

    if (!apkAsset) continue;

    return {
      version: normalizeVersion(tag),
      tagName: tag,
      apkUrl: new URL(apkAsset.browser_download_url.trim()).href,
      apkName: apkAsset.name,
      apkSize: Number.isFinite(Number(apkAsset.size)) && Number(apkAsset.size) > 0 ? Number(apkAsset.size) : 0,
      expectedSha256: extractExpectedSha256(apkAsset, rel.body),
      publishedAt: rel.published_at || null,
    };
  }

  return null;
}

module.exports = {
  GITHUB_MOBILE_RELEASES_URL,
  TRUSTED_REPO_PATH_PREFIX,
  normalizeVersion,
  isNewerVersion,
  isTrustedApkAssetUrl,
  extractExpectedSha256,
  selectLatestApkRelease,
};

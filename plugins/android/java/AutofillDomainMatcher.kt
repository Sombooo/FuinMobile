package com.sombooosteam.fuin

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest
import java.util.Locale

data class PinnedPackageRecord(
    val packageName: String,
    val certSha256: String,
    val linkedEntryIds: Set<String>
)

/**
 * Handles URL/domain normalization, compound ccTLD & multi-tenant domain isolation,
 * untrusted WebView setWebDomain spoofing defenses, and APK signing-certificate verification.
 */
object AutofillDomainMatcher {

    private val COMPOUND_PUBLIC_SUFFIXES = setOf(
        "com.tr", "org.tr", "edu.tr", "gov.tr", "net.tr", "bel.tr", "k12.tr",
        "gen.tr", "av.tr", "dr.tr", "pol.tr", "tsk.tr",
        "co.uk", "org.uk", "gov.uk", "ac.uk",
        "com.au", "net.au", "org.au",
        "co.jp", "ne.jp", "or.jp",
        "com.br", "com.mx", "co.in", "co.nz", "co.za", "co.kr"
    )

    private val REVERSED_COMPOUND_TLDS = setOf(
        "tr.com", "tr.org", "tr.gov", "tr.edu", "tr.net", "tr.bel", "tr.k12",
        "uk.co", "uk.org", "uk.gov", "au.com", "jp.co", "br.com"
    )

    private val MULTI_TENANT_SUFFIXES = setOf(
        "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev",
        "firebaseapp.com", "web.app", "blogspot.com", "herokuapp.com",
        "onrender.com", "workers.dev", "fly.dev", "railway.app"
    )

    private val GENERIC_TLDS = setOf(
        "com", "net", "org", "io", "co", "app", "dev", "tv", "me", "ai", "info", "biz",
        "tr", "uk", "de", "fr", "nl", "jp", "ru", "br", "in", "au", "ca", "us", "gov", "edu"
    )

    /**
     * Extracts a clean lowercase hostname while stripping userinfo (`user:pass@`) BEFORE port (`:port`)
     * to prevent `https://google.com:443@evil.com/login` host-confusion attacks.
     */
    fun normalizeDomain(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        val trimmed = raw.trim().lowercase(Locale.ROOT)
        if (trimmed.startsWith("androidapp://")) return ""

        val withoutScheme = trimmed.replace(Regex("^[a-z][a-z0-9+.-]*://"), "")
        val authority = withoutScheme
            .split('/', '?', '#')
            .firstOrNull()
            ?.substringAfterLast('@')
            ?.substringBefore(':')
            ?.removePrefix("www.")
            ?.trimEnd('.')
            ?.trim()
            ?: ""

        return if (authority.contains('.')) authority else ""
    }

    /**
     * Neutralizes Android ViewStructure.setWebDomain() spoofing from untrusted native apps:
     * Strictly isolates `https://` webDomains to verified browser packages (`BROWSER_PACKAGES`).
     * Non-browser native apps (including hybrid WebView apps like Netflix) are always matched and
     * saved under the `androidapp://<package>` namespace so no native app can ever forge or overwrite
     * an `https://` web origin.
     */
    fun resolveTrustedWebDomain(packageName: String?, rawWebDomain: String?): String? {
        if (!AutofillStructureParser.isBrowserPackage(packageName)) {
            return null
        }
        return normalizeDomain(rawWebDomain).ifEmpty { null }
    }

    /**
     * Extracts ONLY the organization/brand segment from a reverse-DNS Android package name
     * (e.g. `com.spotify.music` -> `spotify`, `tr.com.ziraatbank.mobil` -> `ziraatbank`,
     * `com.google.android.youtube` -> `youtube`, `com.randomdev.spotify_saver` -> `randomdev`).
     */
    fun extractReverseDomainOwner(packageName: String?): String? {
        if (packageName.isNullOrBlank()) return null
        val lower = packageName.lowercase(Locale.ROOT).trim()
        if (AutofillStructureParser.isBrowserPackage(lower) || AutofillStructureParser.isBlockedPackage(lower)) {
            return null
        }
        if (lower == "com.google.android.gms" || lower == "com.google.android.gm") {
            return "google"
        }

        // Strip shared OS/OEM umbrellas where sub-packages are distinct first-party apps
        val stripped = lower
            .removePrefix("com.google.android.apps.")
            .removePrefix("com.google.android.")
            .removePrefix("com.samsung.android.app.")
            .removePrefix("com.samsung.android.")
            .removePrefix("com.sec.android.app.")
        if (stripped != lower) {
            val firstSeg = stripped.substringBefore('.').trim()
            return firstSeg.takeIf { it.length >= 3 && !GENERIC_TLDS.contains(it) }
        }

        val parts = lower.split('.').filter { it.isNotBlank() }
        if (parts.size < 2) return null

        val firstTwo = "${parts[0]}.${parts[1]}"
        if (REVERSED_COMPOUND_TLDS.contains(firstTwo)) {
            return parts.getOrNull(2)?.takeIf { it.length >= 3 && !GENERIC_TLDS.contains(it) }
        }

        if (GENERIC_TLDS.contains(parts[0])) {
            return parts[1].takeIf { it.length >= 3 && !GENERIC_TLDS.contains(it) }
        }

        return parts[0].takeIf { it.length >= 3 }
    }

    fun extractPackageDisplayName(packageName: String): String {
        val owner = extractReverseDomainOwner(packageName) ?: packageName.substringAfterLast('.')
        return owner.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
    }

    /**
     * Multi-tenant & compound-ccTLD safe domain comparison.
     */
    fun isDomainMatch(queryDomain: String, entryDomain: String): Boolean {
        val q = normalizeDomain(queryDomain).ifEmpty { queryDomain.lowercase(Locale.ROOT).trim().trimEnd('.') }
        val e = normalizeDomain(entryDomain).ifEmpty { entryDomain.lowercase(Locale.ROOT).trim().trimEnd('.') }
        if (q.isEmpty() || e.isEmpty()) return false
        if (q == e) return true

        for (mt in MULTI_TENANT_SUFFIXES) {
            if (q == mt || e == mt || q.endsWith(".$mt") || e.endsWith(".$mt")) {
                if (q == mt || e == mt) return false
                if (q == e) return true
                val minHost = if (q.length <= e.length) q else e
                return (q.endsWith(".$e") || e.endsWith(".$q")) &&
                    minHost.split('.').size > mt.split('.').size
            }
        }

        val qReg = getRegistrableDomain(q)
        val eReg = getRegistrableDomain(e)
        return qReg != null && qReg == eReg
    }

    fun getRegistrableDomain(host: String): String? {
        val parts = host.lowercase(Locale.ROOT).trim().split('.').filter { it.isNotEmpty() }
        if (parts.size < 2) return null

        val lastTwo = "${parts[parts.size - 2]}.${parts[parts.size - 1]}"
        if (COMPOUND_PUBLIC_SUFFIXES.contains(lastTwo)) {
            if (parts.size < 3) return null
            return "${parts[parts.size - 3]}.$lastTwo"
        }

        return lastTwo
    }

    fun getRegistrableBrandLabel(host: String): String? {
        val reg = getRegistrableDomain(host) ?: return null
        return reg.substringBefore('.')
    }

    /**
     * Computes lowercase SHA-256 hex digest of the target package's signing certificate.
     */
    @Suppress("DEPRECATION")
    fun getApkSignatureSha256(context: Context, packageName: String?): String? {
        if (packageName.isNullOrBlank()) return null
        return try {
            val pm = context.packageManager
            val certBytes: ByteArray? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val pkgInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.getPackageInfo(
                        packageName,
                        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
                    )
                } else {
                    pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                }
                val signingInfo = pkgInfo.signingInfo
                val signers = if (signingInfo != null) {
                    if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners
                    else signingInfo.signingCertificateHistory
                } else {
                    null
                }
                signers?.firstOrNull()?.toByteArray()
            } else {
                val pkgInfo = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                pkgInfo.signatures?.firstOrNull()?.toByteArray()
            }

            if (certBytes == null || certBytes.isEmpty()) return null
            val digest = MessageDigest.getInstance("SHA-256").digest(certBytes)
            digest.joinToString("") { "%02x".format(Locale.ROOT, it) }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Matches vault entries against a verified browser webDomain or a native Android package
     * with APK signing-certificate pinning (TOFU + explicit androidapp:// URI support).
     */
    fun findMatches(
        context: Context,
        entries: List<AutofillVaultEntry>,
        rawWebDomain: String?,
        packageName: String?,
        pinnedPackages: Map<String, PinnedPackageRecord>
    ): List<AutofillVaultEntry> {
        if (entries.isEmpty()) return emptyList()
        if (AutofillStructureParser.isBlockedPackage(packageName)) return emptyList()

        val isBrowser = AutofillStructureParser.isBrowserPackage(packageName)
        val trustedDomain = resolveTrustedWebDomain(packageName, rawWebDomain)

        // Browser rule: inside Chrome/Firefox/Brave/Samsung Internet, match STRICTLY on webDomain
        if (isBrowser) {
            if (trustedDomain.isNullOrEmpty()) return emptyList()
            return matchEntriesByDomain(entries, trustedDomain)
        }

        val pkgLower = packageName?.lowercase(Locale.ROOT)?.trim().orEmpty()
        if (pkgLower.isEmpty()) {
            return if (!trustedDomain.isNullOrEmpty()) matchEntriesByDomain(entries, trustedDomain) else emptyList()
        }

        // Verify APK signing certificate against any pinned record (blocks sideloaded package-name clones!)
        val liveCertSha256 = getApkSignatureSha256(context, pkgLower)
        val pinned = pinnedPackages[pkgLower]
        if (pinned != null && pinned.certSha256.isNotEmpty()) {
            if (liveCertSha256 == null || !pinned.certSha256.equals(liveCertSha256, ignoreCase = true)) {
                return emptyList()
            }
        }

        // 1. Trusted hybrid WebView domain owned by the package itself
        if (!trustedDomain.isNullOrEmpty()) {
            val domainMatches = matchEntriesByDomain(entries, trustedDomain)
            if (domainMatches.isNotEmpty()) {
                return domainMatches
            }
        }

        // 2. Native Android app matching (explicit androidapp:// URI, user-pinned entry IDs, or exact reverse-domain owner)
        val pkgOwner = extractReverseDomainOwner(pkgLower)
        val results = mutableListOf<AutofillVaultEntry>()

        for (entry in entries) {
            // 2a. User-linked entry via manual picker (verified by pinned APK cert above)
            if (pinned != null && pinned.linkedEntryIds.contains(entry.id)) {
                results.add(entry)
                continue
            }

            // 2b. Explicit androidapp://<pkg> or androidapp://<pkg>#<sha256> URI in vault entry
            val matchedAndroidUri = entry.urls.firstOrNull { rawU ->
                val u = rawU.lowercase(Locale.ROOT).trim()
                if (u == pkgLower || u == "androidapp://$pkgLower") {
                    true
                } else if (u.startsWith("androidapp://$pkgLower#")) {
                    val expectedHash = u.substringAfter('#').trim()
                    liveCertSha256 != null && expectedHash == liveCertSha256
                } else {
                    false
                }
            }
            if (matchedAndroidUri != null) {
                results.add(entry)
                continue
            }

            // 2c. Exact reverse-domain organization match (e.g. com.spotify.music <-> spotify.com)
            // Never uses prefix/substring guessing, so com.randomdev.spotifydownloader cannot match!
            if (pkgOwner != null) {
                val entryBrands = mutableSetOf<String>()
                val normEntryDomain = normalizeDomain(entry.domain)
                if (normEntryDomain.isNotEmpty()) {
                    getRegistrableBrandLabel(normEntryDomain)?.let { entryBrands.add(it) }
                }
                for (u in entry.urls) {
                    val normU = normalizeDomain(u)
                    if (normU.isNotEmpty()) {
                        getRegistrableBrandLabel(normU)?.let { entryBrands.add(it) }
                    }
                }
                if (entryBrands.isEmpty() && entry.title.isNotBlank()) {
                    val cleanTitle = foldTurkishAscii(entry.title).trim()
                    if (cleanTitle.length >= 3 && !cleanTitle.contains(' ')) {
                        entryBrands.add(cleanTitle)
                    }
                }
                if (entryBrands.contains(pkgOwner)) {
                    results.add(entry)
                }
            }
        }

        return results
    }

    private fun foldTurkishAscii(text: String): String {
        return text
            .replace('İ', 'i')
            .lowercase(Locale.ROOT)
            .replace("\u0307", "")
            .replace('ı', 'i')
            .replace('ş', 's')
            .replace('ğ', 'g')
            .replace('ü', 'u')
            .replace('ö', 'o')
            .replace('ç', 'c')
    }

    private fun matchEntriesByDomain(
        entries: List<AutofillVaultEntry>,
        cleanDomain: String
    ): List<AutofillVaultEntry> {
        return entries.filter { entry ->
            val entryDomain = normalizeDomain(entry.domain)
            val entryUrls = entry.urls.map { normalizeDomain(it) }
            (entryDomain.isNotEmpty() && isDomainMatch(cleanDomain, entryDomain)) ||
                entryUrls.any { it.isNotEmpty() && isDomainMatch(cleanDomain, it) }
        }
    }
}

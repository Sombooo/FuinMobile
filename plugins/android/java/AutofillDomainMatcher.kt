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

    private val COMPOUND_CCTLD_SLDS = setOf(
        "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob",
        "mil", "biz", "info", "gen", "web", "nom", "bel", "pol", "k12", "av",
        "dr", "bbs", "tsk", "kep", "me", "firm", "ind"
    )

    private val REVERSED_COMPOUND_TLDS = setOf(
        "tr.com", "tr.org", "tr.gov", "tr.edu", "tr.net", "tr.bel", "tr.k12",
        "uk.co", "uk.org", "uk.gov", "au.com", "jp.co", "br.com"
    )

    private val MULTI_TENANT_SUFFIXES = setOf(
        "github.io",
        "pages.dev",
        "vercel.app",
        "netlify.app",
        "gitlab.io",
        "herokuapp.com",
        "firebaseapp.com",
        "fly.dev",
        "render.com",
        "onrender.com",
        "workers.dev",
        "web.app",
        "azurewebsites.net",
        "cloudfront.net",
        "railway.app",
        "up.railway.app",
        "deno.dev",
        "appspot.com",
        "surge.sh",
        "amplifyapp.com",
        "elasticbeanstalk.com",
        "s3.amazonaws.com",
        "fastly.net",
        "b-cdn.net",
        "ngrok-free.app",
        "ngrok.io",
        "glitch.me",
        "myshopify.com",
        "000webhostapp.com",
        "pipedream.net",
        "pantheonsite.io",
        "wixsite.com",
        "ghost.io",
        "substack.com",
        "azureedge.net",
        "trafficmanager.net",
        "blob.core.windows.net",
        "wordpress.com",
        "blogspot.com",
        "tumblr.com",
        "itch.io",
        "notion.site",
        "webflow.io",
        "replit.app",
        "run.app",
        "hf.space",
        "trycloudflare.com",
        "pythonanywhere.com"
    )

    /**
     * Official release APK signing-certificate SHA-256 digests (lowercase hex) for major Android browsers
     * (sourced from Google's privileged browser registry). Any browser package not in this map is treated
     * as unverified and requires TOFU certificate pinning + explicit package disclosure in AutofillAuthActivity.
     */
    private val TRUSTED_BROWSER_CERT_SHA256: Map<String, Set<String>> = mapOf(
        "com.android.chrome" to setOf("f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83"),
        "com.chrome.beta" to setOf(
            "da633d34b69e63ae2103b49d53ce052fc5f7f3c53aab94fdc2a208bdfd14249c",
            "3d7a1223019aa39d9ea0e3436ab7c0896bfb4fb679f4de5fe7c23f326c8f994a"
        ),
        "com.chrome.dev" to setOf(
            "9044ee5fee4bbc5e21dd44665431c4eb1f1f71a32716a0bc927bcbb39233cabf",
            "3d7a1223019aa39d9ea0e3436ab7c0896bfb4fb679f4de5fe7c23f326c8f994a"
        ),
        "com.chrome.canary" to setOf("2019dfa1fb23efbf70c5bcd1443c5beab04f3f2ff4366e9ac1e3457639a24cfc"),
        "org.mozilla.firefox" to setOf("a78b62a5165b4494b2fead9e76a280d22d937fee6251aece599446b2ea319b04"),
        "org.mozilla.firefox_beta" to setOf("a78b62a5165b4494b2fead9e76a280d22d937fee6251aece599446b2ea319b04"),
        "org.mozilla.focus" to setOf("6203a473be36d64ee37f87fa500edbc79eab930610ab9b9fa4ca7d5c1f1b4ffc"),
        "org.mozilla.fenix" to setOf("5004779088e7f988d5bc5cc5f8798febf4f8cd084a1b2a46efd4c8ee4aeaf211"),
        "com.brave.browser" to setOf("9c2db70513515fdbfbbc585b3edf3d7123d4dc67c94ffd306361c1d79bbf18ac"),
        "com.brave.browser_beta" to setOf("9c2db70513515fdbfbbc585b3edf3d7123d4dc67c94ffd306361c1d79bbf18ac"),
        "com.brave.browser_nightly" to setOf("9c2db70513515fdbfbbc585b3edf3d7123d4dc67c94ffd306361c1d79bbf18ac"),
        "com.microsoft.emmx" to setOf("01e1999710a82c2749b4d50c445dc85d670b6136089d0a766a73827c82a1eac9"),
        "com.opera.browser" to setOf("5d6afbf87f652af04647ada0df634cf22370900b164b09d50bd23aa2cb5285b8"),
        "com.opera.mini.native" to setOf("57acbc525f1b2ebd19196cd6f014397cc910fd18841e0ae850febc3e1e593ff2"),
        "com.sec.android.app.sbrowser" to setOf("34df0e7a9f1cf1892e45c056b4973cd81ccf148a4050d11aea4ac5a65f900a42"),
        "com.sec.android.app.sbrowser.beta" to setOf("34df0e7a9f1cf1892e45c056b4973cd81ccf148a4050d11aea4ac5a65f900a42"),
        "com.duckduckgo.mobile.android" to setOf("bb7bb31c573c46a1da7fc5c528a6acf432108456feec50810c7f33694eb3d2d4"),
        "com.vivaldi.browser" to setOf("e8a78544655ba8c09817f732768f5689b1662ec4b2bc5a0bc0ec138d33ca3d1e"),
        "com.yandex.browser" to setOf("aca405ded8b25cb2e8c6da69425d2b4307d087c1276fc06ad5942731ccc51dba"),
        "net.waterfox.android.release" to setOf("2939997a2d8f07303ceb37ad6810afef0bda710be2116476e3525a7379ec2e1a"),
        "app.vanadium.browser" to setOf("c6adb8b83c6d4c17d292afde56fd488a51d316ff8f2c11c5410223bff8a7dbb3")
    )

    private val GENERIC_TLDS = setOf(
        "com", "net", "org", "io", "co", "app", "dev", "tv", "me", "ai", "info", "biz",
        "tr", "uk", "de", "fr", "nl", "jp", "ru", "br", "in", "au", "ca", "us", "gov", "edu"
    )

    private fun stripIpv6Brackets(host: String): String {
        val h = host.lowercase(Locale.ROOT).trim().trimEnd('.')
        return if (h.startsWith("[") && h.endsWith("]")) h.substring(1, h.length - 1) else h
    }

    fun isIpAddressLiteral(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val clean = stripIpv6Brackets(host)
        if (clean.isEmpty()) return false

        // IPv6 literal (contains ':' and only hex digits, ':', or '.' for IPv4-mapped IPv6)
        if (clean.contains(':')) {
            return clean.all { it in '0'..'9' || it in 'a'..'f' || it == ':' || it == '.' }
        }

        // IPv4 literal (4 dot-separated numeric octets, including leading-zero variants)
        val parts = clean.split('.')
        if (parts.size == 4 && parts.all { p -> p.isNotEmpty() && p.all { it.isDigit() } }) {
            return true
        }
        return false
    }

    /**
     * Extracts a clean lowercase hostname while stripping userinfo (`user:pass@`) BEFORE port (`:port`)
     * to prevent `https://google.com:443@evil.com/login` host-confusion attacks.
     */
    fun normalizeDomain(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        val trimmed = raw.trim().lowercase(Locale.ROOT)
        if (trimmed.startsWith("androidapp://")) return ""

        val withoutScheme = trimmed.replace(Regex("^[a-z][a-z0-9+.-]*://"), "")
        val hostPort = withoutScheme
            .split('/', '?', '#')
            .firstOrNull()
            ?.substringAfterLast('@')
            ?.trim()
            ?: ""

        if (hostPort.startsWith("[")) {
            val ipv6 = hostPort.substringAfter('[').substringBefore(']').substringBefore('%').trim()
            return if (isIpAddressLiteral(ipv6)) ipv6 else ""
        }
        if (hostPort.count { it == ':' } >= 2) {
            val ipv6 = hostPort.substringBefore('%').trim()
            return if (isIpAddressLiteral(ipv6)) ipv6 else ""
        }

        val authority = hostPort
            .substringBefore(':')
            .removePrefix("www.")
            .trimEnd('.')
            .trim()

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

        // Unknown first segment: fail closed rather than guessing parts[0] (MOB-05)
        return null
    }

    fun extractPackageDisplayName(packageName: String): String {
        val owner = extractReverseDomainOwner(packageName) ?: packageName.substringAfterLast('.')
        return owner.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
    }

    /**
     * Multi-tenant, IP-literal, & compound-ccTLD safe domain comparison.
     */
    fun isDomainMatch(queryDomain: String, entryDomain: String): Boolean {
        val q = normalizeDomain(queryDomain).ifEmpty { stripIpv6Brackets(queryDomain) }
        val e = normalizeDomain(entryDomain).ifEmpty { stripIpv6Brackets(entryDomain) }
        if (q.isEmpty() || e.isEmpty()) return false
        if (q == e) return true

        // IPv4 / IPv6 literals must match strictly on full literal (never tail-octet registrable domain)
        if (isIpAddressLiteral(q) || isIpAddressLiteral(e)) {
            return stripIpv6Brackets(q) == stripIpv6Brackets(e)
        }

        val matchedMt = MULTI_TENANT_SUFFIXES
            .filter { mt -> q == mt || e == mt || q.endsWith(".$mt") || e.endsWith(".$mt") }
            .maxByOrNull { it.length }
        if (matchedMt != null) {
            if (q == matchedMt || e == matchedMt) return false
            if (q == e) return true
            val minHost = if (q.length <= e.length) q else e
            return (q.endsWith(".$e") || e.endsWith(".$q")) &&
                minHost.split('.').size > matchedMt.split('.').size
        }

        val qReg = getRegistrableDomain(q)
        val eReg = getRegistrableDomain(e)
        return qReg != null && qReg == eReg
    }

    fun getRegistrableDomain(host: String): String? {
        val clean = stripIpv6Brackets(host)
        if (clean.isEmpty()) return null

        // Return IPv4 and IPv6 literals unchanged so 192.168.1.1 never collapses to "1.1"
        if (isIpAddressLiteral(clean)) {
            return clean
        }

        val parts = clean.split('.').filter { it.isNotEmpty() }
        if (parts.size < 2) return null

        val matchedMt = MULTI_TENANT_SUFFIXES
            .filter { mt -> clean.endsWith(".$mt") }
            .maxByOrNull { it.length }
        if (matchedMt != null) {
            val mtPartsCount = matchedMt.split('.').size
            if (parts.size <= mtPartsCount) return null
            return parts.takeLast(mtPartsCount + 1).joinToString(".")
        }

        val last = parts[parts.size - 1]
        val secondLast = parts[parts.size - 2]
        val lastTwo = "$secondLast.$last"
        val isCompoundCcTld = last.length == 2 &&
            last.all { it in 'a'..'z' } &&
            COMPOUND_CCTLD_SLDS.contains(secondLast)

        if (COMPOUND_PUBLIC_SUFFIXES.contains(lastTwo) || isCompoundCcTld) {
            if (parts.size < 3) return null
            return "${parts[parts.size - 3]}.$lastTwo"
        }

        return lastTwo
    }

    fun getRegistrableBrandLabel(host: String): String? {
        val clean = stripIpv6Brackets(host)
        if (clean.isEmpty() || isIpAddressLiteral(clean)) return null
        if (MULTI_TENANT_SUFFIXES.any { clean == it || clean.endsWith(".$it") }) {
            return null
        }
        val reg = getRegistrableDomain(clean) ?: return null
        return reg.substringBefore('.')
    }

    /**
     * Returns true ONLY when the package is in BROWSER_PACKAGES AND its live APK signing certificate
     * matches an official digest in TRUSTED_BROWSER_CERT_SHA256.
     */
    fun isVerifiedBrowserPackage(
        context: Context,
        packageName: String?,
        precomputedCertSha256: String? = null
    ): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkgLower = packageName.lowercase(Locale.ROOT).trim()
        if (!AutofillStructureParser.isBrowserPackage(pkgLower)) return false
        val expectedCerts = TRUSTED_BROWSER_CERT_SHA256[pkgLower] ?: return false
        val liveCert = precomputedCertSha256 ?: getApkSignatureSha256(context, pkgLower) ?: return false
        return expectedCerts.any { it.equals(liveCert, ignoreCase = true) }
    }

    /**
     * Returns true when a package claims a known major browser package ID in TRUSTED_BROWSER_CERT_SHA256
     * but its live APK signing certificate does NOT match the official vendor certificate (impostor APK).
     */
    fun isKnownBrowserCertMismatch(
        context: Context,
        packageName: String?,
        precomputedCertSha256: String? = null
    ): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkgLower = packageName.lowercase(Locale.ROOT).trim()
        val expectedCerts = TRUSTED_BROWSER_CERT_SHA256[pkgLower] ?: return false
        val liveCert = precomputedCertSha256 ?: getApkSignatureSha256(context, pkgLower) ?: return true
        return expectedCerts.none { it.equals(liveCert, ignoreCase = true) }
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

        val pkgLower = packageName?.lowercase(Locale.ROOT)?.trim().orEmpty()
        val isBrowser = AutofillStructureParser.isBrowserPackage(pkgLower)
        val trustedDomain = resolveTrustedWebDomain(pkgLower, rawWebDomain)

        val liveCertSha256 = if (pkgLower.isNotEmpty()) getApkSignatureSha256(context, pkgLower) else null
        val pinned = if (pkgLower.isNotEmpty()) pinnedPackages[pkgLower] else null

        // Browser rule: verify APK signing certificate / TOFU pin BEFORE trusting webDomain (MOB-02)
        if (isBrowser) {
            if (trustedDomain.isNullOrEmpty()) return emptyList()
            val isVerifiedBrowser = isVerifiedBrowserPackage(context, pkgLower, liveCertSha256)
            if (!isVerifiedBrowser) {
                // Fail closed on impostor APKs squatting known vendor browser package IDs
                if (isKnownBrowserCertMismatch(context, pkgLower, liveCertSha256)) {
                    return emptyList()
                }
                // Unlisted browser package: require readable APK cert and enforce TOFU continuity
                if (liveCertSha256.isNullOrEmpty()) {
                    return emptyList()
                }
                if (pinned != null && pinned.certSha256.isNotEmpty() &&
                    !pinned.certSha256.equals(liveCertSha256, ignoreCase = true)
                ) {
                    return emptyList()
                }
            }
            return matchEntriesByDomain(entries, trustedDomain)
        }

        if (pkgLower.isEmpty()) {
            return if (!trustedDomain.isNullOrEmpty()) matchEntriesByDomain(entries, trustedDomain) else emptyList()
        }

        // Verify APK signing certificate against any pinned record (blocks sideloaded package-name clones!)
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
                if (entryBrands.contains(pkgOwner)) {
                    results.add(entry)
                }
            }
        }

        return results
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

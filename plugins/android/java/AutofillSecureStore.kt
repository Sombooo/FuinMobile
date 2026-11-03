package com.sombooosteam.fuin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AutofillVaultEntry(
    val id: String,
    val title: String,
    val username: String,
    val password: String,
    val domain: String,
    val urls: List<String>,
    val reprompt: Boolean,
    val totp: String?
)

data class AutofillSnapshot(
    val isSessionUnlocked: Boolean,
    val timeoutMs: Long,
    val entries: List<AutofillVaultEntry>,
    val pinnedPackages: Map<String, PinnedPackageRecord>
)

/**
 * Hardware-backed AndroidKeyStore AES-256-GCM storage for Autofill cache,
 * authenticated session expiration, APK certificate pins, and two-phase pending saves.
 *
 * Stored inside `context.noBackupFilesDir` so Android BackupManager NEVER uploads
 * autofill cache ciphertexts to Google Drive (upholding Fuin's Zero-Cloud invariant).
 */
object AutofillSecureStore {

    private const val STORE_FILE_NAME = "fuin_autofill_vault_v2.enc"
    private const val STORE_TMP_NAME = "fuin_autofill_vault_v2.tmp"

    // Legacy SharedPreferences scrubbed automatically on first access
    private const val LEGACY_PREFS_NAME = "fuin_autofill_storage"
    private const val LEGACY_KEY_ENVELOPE = "vault_envelope_enc"
    private const val LEGACY_KEY_ENTRIES_ENC = "vault_entries_enc"
    private const val LEGACY_KEY_ENTRIES_PLAIN = "vault_entries_json"
    private const val LEGACY_KEY_PENDING = "pending_saves_enc"

    private const val KEYSTORE_ALIAS = "fuin_autofill_aes256_gcm_v1"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val ENC_PREFIX = "v1:"

    private const val DEFAULT_TIMEOUT_MS = 60_000L // Aligns with FuinMobile's default 1-minute lock timeout
    private const val MAX_TIMEOUT_MS = 60 * 60 * 1000L // Hard cap: 60 minutes

    private fun getStoreFile(context: Context): File = File(context.noBackupFilesDir, STORE_FILE_NAME)
    private fun getTmpFile(context: Context): File = File(context.noBackupFilesDir, STORE_TMP_NAME)

    private fun getOrCreateSecretKey(): SecretKey? {
        return try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val existing = keyStore.getEntry(KEYSTORE_ALIAS, null) as? KeyStore.SecretKeyEntry
            if (existing != null) {
                return existing.secretKey
            }
            val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            val spec = KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .setKeySize(256)
                .build()
            keyGenerator.init(spec)
            keyGenerator.generateKey()
        } catch (_: Exception) {
            null
        }
    }

    private fun encryptPayload(plaintext: String): String? {
        val secretKey = getOrCreateSecretKey() ?: return null
        return try {
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)
            val iv = cipher.iv
            val cipherBytes = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
            val ctB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
            "$ENC_PREFIX$ivB64:$ctB64"
        } catch (_: Exception) {
            null
        }
    }

    private fun decryptPayload(encoded: String?): String? {
        if (encoded.isNullOrBlank() || !encoded.startsWith(ENC_PREFIX)) return null
        val secretKey = getOrCreateSecretKey() ?: return null
        return try {
            val parts = encoded.removePrefix(ENC_PREFIX).split(":", limit = 2)
            if (parts.size != 2) return null
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    @Synchronized
    private fun readRootState(context: Context): JSONObject {
        val storeFile = getStoreFile(context)
        if (storeFile.exists()) {
            val raw = try {
                decryptPayload(storeFile.readText(Charsets.UTF_8).trim())
            } catch (_: Exception) {
                null
            }
            if (!raw.isNullOrBlank()) {
                try {
                    return JSONObject(raw)
                } catch (_: Exception) {
                }
            }
        }
        return migrateLegacyPrefsIfNeeded(context)
    }

    @Synchronized
    private fun writeRootState(context: Context, root: JSONObject): Boolean {
        val encrypted = encryptPayload(root.toString()) ?: return false
        return try {
            val tmp = getTmpFile(context)
            val dst = getStoreFile(context)
            tmp.writeText(encrypted, Charsets.UTF_8)
            if (!tmp.renameTo(dst)) {
                dst.writeText(encrypted, Charsets.UTF_8)
                tmp.delete()
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun migrateLegacyPrefsIfNeeded(context: Context): JSONObject {
        val root = createEmptyRoot()
        try {
            val prefs = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.all.isNotEmpty()) {
                val envRaw = decryptPayload(prefs.getString(LEGACY_KEY_ENVELOPE, null))
                if (!envRaw.isNullOrBlank()) {
                    val envObj = JSONObject(envRaw)
                    root.put("entries", envObj.optJSONArray("entries") ?: JSONArray())
                    root.put("timeoutMs", envObj.optLong("timeoutMs", DEFAULT_TIMEOUT_MS))
                } else {
                    val entriesRaw = decryptPayload(prefs.getString(LEGACY_KEY_ENTRIES_ENC, null))
                        ?: prefs.getString(LEGACY_KEY_ENTRIES_PLAIN, null)
                    if (!entriesRaw.isNullOrBlank()) {
                        root.put("entries", JSONArray(entriesRaw))
                    }
                }

                val pendingRaw = decryptPayload(prefs.getString(LEGACY_KEY_PENDING, null))
                if (!pendingRaw.isNullOrBlank()) {
                    root.put("pendingSaves", JSONArray(pendingRaw))
                }

                writeRootState(context, root)
                prefs.edit().clear().commit()
                context.deleteSharedPreferences(LEGACY_PREFS_NAME)
            }
        } catch (_: Exception) {
        }
        return root
    }

    private fun createEmptyRoot(): JSONObject {
        return JSONObject().apply {
            put("unlockedUntil", 0L)
            put("timeoutMs", DEFAULT_TIMEOUT_MS)
            put("entries", JSONArray())
            put("pendingSaves", JSONArray())
            put("pinnedPackages", JSONObject())
        }
    }

    @Synchronized
    fun saveVaultEntries(context: Context, entriesJson: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS) {
        val entriesArray = try {
            JSONArray(entriesJson)
        } catch (_: Exception) {
            return
        }
        val clampedTimeout = timeoutMs.coerceIn(0L, MAX_TIMEOUT_MS)
        val now = System.currentTimeMillis()
        val unlockedUntil = if (clampedTimeout > 0L) now + clampedTimeout else 0L

        val root = readRootState(context)
        root.put("unlockedUntil", unlockedUntil)
        root.put("timeoutMs", clampedTimeout)
        root.put("entries", entriesArray)
        writeRootState(context, root)
    }

    /**
     * Single-pass authenticated read of session state, vault entries, and pinned APK certificates.
     */
    @Synchronized
    fun loadSnapshot(context: Context): AutofillSnapshot {
        val root = readRootState(context)
        val now = System.currentTimeMillis()

        val unlockedUntil = root.optLong("unlockedUntil", 0L)
        val timeoutMs = root.optLong("timeoutMs", DEFAULT_TIMEOUT_MS).coerceIn(0L, MAX_TIMEOUT_MS)
        val entries = parseEntriesArray(root.optJSONArray("entries") ?: JSONArray())
        val pinned = parsePinnedPackages(root.optJSONObject("pinnedPackages"))

        return AutofillSnapshot(
            isSessionUnlocked = now < unlockedUntil,
            timeoutMs = timeoutMs,
            entries = entries,
            pinnedPackages = pinned
        )
    }

    fun getAllEntries(context: Context): List<AutofillVaultEntry> = loadSnapshot(context).entries

    @Synchronized
    fun extendSession(context: Context) {
        val root = readRootState(context)
        val timeoutMs = root.optLong("timeoutMs", DEFAULT_TIMEOUT_MS).coerceIn(0L, MAX_TIMEOUT_MS)
        val now = System.currentTimeMillis()
        root.put("unlockedUntil", if (timeoutMs > 0L) now + timeoutMs else 0L)
        writeRootState(context, root)
    }

    @Synchronized
    fun clearSession(context: Context) {
        val root = readRootState(context)
        root.put("unlockedUntil", 0L)
        writeRootState(context, root)
    }

    @Synchronized
    fun clearAll(context: Context) {
        try {
            getTmpFile(context).delete()
            getStoreFile(context).delete()
            context.deleteSharedPreferences(LEGACY_PREFS_NAME)
        } catch (_: Exception) {
        }
    }

    /**
     * Pins an APK's SHA-256 signing certificate on verified fill or manual picker selection (TOFU).
     * Returns false if the package was previously pinned with a different signing certificate.
     */
    @Synchronized
    fun recordVerifiedPackageFill(
        context: Context,
        packageName: String?,
        linkEntryId: String? = null
    ): Boolean {
        if (packageName.isNullOrBlank()) return true
        val pkgLower = packageName.lowercase(Locale.ROOT).trim()
        if (AutofillStructureParser.isBrowserPackage(pkgLower) || AutofillStructureParser.isBlockedPackage(pkgLower)) {
            return true
        }

        val liveCert = AutofillDomainMatcher.getApkSignatureSha256(context, pkgLower)
        val root = readRootState(context)
        val pinnedMap = parsePinnedPackages(root.optJSONObject("pinnedPackages")).toMutableMap()
        val existing = pinnedMap[pkgLower]

        // Fail closed if package was previously pinned with a valid cert that now mismatches or disappeared
        if (existing != null && existing.certSha256.isNotEmpty()) {
            if (liveCert.isNullOrEmpty() || !existing.certSha256.equals(liveCert, ignoreCase = true)) {
                return false
            }
        }

        val updatedIds = existing?.linkedEntryIds?.toMutableSet() ?: mutableSetOf()
        if (!linkEntryId.isNullOrBlank()) {
            updatedIds.add(linkEntryId)
        }

        val certToStore = liveCert ?: existing?.certSha256.orEmpty()
        if (certToStore.isNotEmpty() || updatedIds.isNotEmpty()) {
            pinnedMap[pkgLower] = PinnedPackageRecord(
                packageName = pkgLower,
                certSha256 = certToStore,
                linkedEntryIds = updatedIds
            )
            root.put("pinnedPackages", serializePinnedPackages(pinnedMap))
            writeRootState(context, root)
        }
        return true
    }

    /**
     * Enqueues a newly captured credential from Android onSaveRequest and reflects it in active cache.
     */
    @Synchronized
    fun enqueuePendingSave(
        context: Context,
        username: String,
        password: String,
        webDomain: String?,
        packageName: String?
    ) {
        if (password.isBlank()) return
        if (AutofillStructureParser.isBlockedPackage(packageName)) return

        val pkgLower = packageName?.lowercase(Locale.ROOT)?.trim().orEmpty()
        val isBrowser = AutofillStructureParser.isBrowserPackage(pkgLower)
        val trustedDomain = AutofillDomainMatcher.resolveTrustedWebDomain(pkgLower, webDomain).orEmpty()

        if (isBrowser && trustedDomain.isEmpty()) return

        val effectiveUrl = when {
            trustedDomain.isNotEmpty() -> "https://$trustedDomain"
            pkgLower.isNotEmpty() && !isBrowser -> "androidapp://$pkgLower"
            else -> ""
        }

        val derivedTitle = when {
            trustedDomain.isNotEmpty() -> trustedDomain
            pkgLower.isNotEmpty() -> AutofillDomainMatcher.extractPackageDisplayName(pkgLower)
            else -> "Yeni Kayıt"
        }

        val root = readRootState(context)
        val entries = parseEntriesArray(root.optJSONArray("entries") ?: JSONArray())
        val pinned = parsePinnedPackages(root.optJSONObject("pinnedPackages"))

        val existingMatches = AutofillDomainMatcher.findMatches(
            context = context,
            entries = entries,
            rawWebDomain = trustedDomain.ifEmpty { null },
            packageName = pkgLower.ifEmpty { null },
            pinnedPackages = pinned
        )
        if (existingMatches.any { it.username == username && it.password == password }) {
            return
        }

        val pendingArr = root.optJSONArray("pendingSaves") ?: JSONArray()
        val updatedPending = JSONArray()
        for (i in 0 until pendingArr.length()) {
            val item = pendingArr.optJSONObject(i) ?: continue
            val sameTarget = item.optString("domain") == trustedDomain &&
                item.optString("packageName") == pkgLower &&
                item.optString("username") == username
            if (!sameTarget) {
                updatedPending.put(item)
            }
        }

        val newId = UUID.randomUUID().toString()
        val newObj = JSONObject().apply {
            put("id", newId)
            put("site", derivedTitle)
            put("title", derivedTitle)
            put("username", username)
            put("password", password)
            put("domain", trustedDomain)
            put("url", effectiveUrl)
            put("packageName", pkgLower)
            put("createdAt", System.currentTimeMillis())
        }
        updatedPending.put(newObj)
        root.put("pendingSaves", updatedPending)

        val entriesArr = root.optJSONArray("entries") ?: JSONArray()
        val cacheEntry = JSONObject().apply {
            put("id", newId)
            put("title", derivedTitle)
            put("username", username)
            put("password", password)
            put("domain", trustedDomain)
            put("urls", JSONArray().apply {
                if (trustedDomain.isNotEmpty()) put(trustedDomain)
                if (pkgLower.isNotEmpty() && !isBrowser) put("androidapp://$pkgLower")
            })
            put("reprompt", false)
        }
        entriesArr.put(cacheEntry)
        root.put("entries", entriesArr)
        writeRootState(context, root)

        if (pkgLower.isNotEmpty() && !isBrowser) {
            recordVerifiedPackageFill(context, pkgLower, newId)
        }
    }

    /**
     * Phase 1 of two-phase commit: reads pending captured saves WITHOUT deleting them.
     */
    @Synchronized
    fun peekPendingSavesJson(context: Context): String {
        val root = readRootState(context)
        return (root.optJSONArray("pendingSaves") ?: JSONArray()).toString()
    }

    /**
     * Phase 2 of two-phase commit: removes ONLY the save IDs durably encrypted into fuin.enc.
     */
    @Synchronized
    fun ackPendingSaves(context: Context, consumedIdsJson: String) {
        val ackIds = mutableSetOf<String>()
        try {
            val arr = JSONArray(consumedIdsJson)
            for (i in 0 until arr.length()) {
                val id = arr.optString(i, "")
                if (id.isNotBlank()) ackIds.add(id)
            }
        } catch (_: Exception) {
            return
        }
        if (ackIds.isEmpty()) return

        val root = readRootState(context)
        val currentArr = root.optJSONArray("pendingSaves") ?: return
        val remaining = JSONArray()
        for (i in 0 until currentArr.length()) {
            val item = currentArr.optJSONObject(i) ?: continue
            if (!ackIds.contains(item.optString("id", ""))) {
                remaining.put(item)
            }
        }
        root.put("pendingSaves", remaining)
        writeRootState(context, root)
    }

    private fun parsePinnedPackages(obj: JSONObject?): Map<String, PinnedPackageRecord> {
        if (obj == null) return emptyMap()
        val map = mutableMapOf<String, PinnedPackageRecord>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val pkg = keys.next()
            val rec = obj.optJSONObject(pkg) ?: continue
            val cert = rec.optString("certSha256", "")
            val ids = mutableSetOf<String>()
            val idsArr = rec.optJSONArray("linkedEntryIds")
            if (idsArr != null) {
                for (i in 0 until idsArr.length()) {
                    val id = idsArr.optString(i, "")
                    if (id.isNotBlank()) ids.add(id)
                }
            }
            if (pkg.isNotBlank() && (cert.isNotBlank() || ids.isNotEmpty())) {
                map[pkg] = PinnedPackageRecord(pkg, cert, ids)
            }
        }
        return map
    }

    private fun serializePinnedPackages(map: Map<String, PinnedPackageRecord>): JSONObject {
        val root = JSONObject()
        for ((pkg, rec) in map) {
            val recObj = JSONObject().apply {
                put("certSha256", rec.certSha256)
                put("linkedEntryIds", JSONArray().apply {
                    rec.linkedEntryIds.forEach { put(it) }
                })
            }
            root.put(pkg, recObj)
        }
        return root
    }

    private fun parseEntriesArray(array: JSONArray): List<AutofillVaultEntry> {
        val list = mutableListOf<AutofillVaultEntry>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val title = obj.optString("title", "")
            val username = obj.optString("username", "")
            val password = obj.optString("password", "")
            val domain = obj.optString("domain", "")
            val id = obj.optString("id", "").ifBlank { "fallback-$i-$domain-$username" }
            val reprompt = obj.optBoolean("reprompt", false)
            val totp = if (obj.has("totp") && !obj.isNull("totp")) obj.optString("totp", "") else null

            val urls = mutableListOf<String>()
            val urlArr = obj.optJSONArray("urls")
            if (urlArr != null) {
                for (u in 0 until urlArr.length()) {
                    val item = urlArr.optString(u, "")
                    if (item.isNotBlank()) urls.add(item)
                }
            }
            if (domain.isNotEmpty() && !urls.contains(domain)) {
                urls.add(domain)
            }

            if (username.isNotEmpty() || password.isNotEmpty()) {
                list.add(AutofillVaultEntry(id, title, username, password, domain, urls, reprompt, totp))
            }
        }
        return list
    }
}

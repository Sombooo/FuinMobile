package com.sombooosteam.fuin

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

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

object AutofillSecureStore {

    private const val PREFS_NAME = "fuin_autofill_storage"
    private const val KEY_ENTRIES = "vault_entries_json"
    private const val KEY_UNLOCKED_UNTIL = "unlocked_until_ts"
    private const val DEFAULT_TIMEOUT_MINUTES = 15L

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun saveVaultEntries(context: Context, entriesJson: String, timeoutMinutes: Long = DEFAULT_TIMEOUT_MINUTES) {
        val now = System.currentTimeMillis()
        val timeoutMs = timeoutMinutes * 60 * 1000L
        getPrefs(context).edit()
            .putString(KEY_ENTRIES, entriesJson)
            .putLong(KEY_UNLOCKED_UNTIL, now + timeoutMs)
            .apply()
    }

    fun isSessionUnlocked(context: Context): Boolean {
        val unlockedUntil = getPrefs(context).getLong(KEY_UNLOCKED_UNTIL, 0L)
        return System.currentTimeMillis() < unlockedUntil
    }

    fun extendSession(context: Context, timeoutMinutes: Long = DEFAULT_TIMEOUT_MINUTES) {
        val now = System.currentTimeMillis()
        val timeoutMs = timeoutMinutes * 60 * 1000L
        getPrefs(context).edit()
            .putLong(KEY_UNLOCKED_UNTIL, now + timeoutMs)
            .apply()
    }

    fun clearSession(context: Context) {
        getPrefs(context).edit()
            .putLong(KEY_UNLOCKED_UNTIL, 0L)
            .apply()
    }

    fun clearAll(context: Context) {
        getPrefs(context).edit().clear().apply()
    }

    fun getAllEntries(context: Context): List<AutofillVaultEntry> {
        val raw = getPrefs(context).getString(KEY_ENTRIES, null) ?: return emptyList()
        val list = mutableListOf<AutofillVaultEntry>()
        try {
            val array = JSONArray(raw)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val id = obj.optString("id", "")
                val title = obj.optString("title", "")
                val username = obj.optString("username", "")
                val password = obj.optString("password", "")
                val domain = obj.optString("domain", "")
                val reprompt = obj.optBoolean("reprompt", false)
                val totp = if (obj.has("totp") && !obj.isNull("totp")) obj.optString("totp", "") else null

                val urls = mutableListOf<String>()
                if (obj.has("urls")) {
                    val urlArr = obj.optJSONArray("urls")
                    if (urlArr != null) {
                        for (u in 0 until urlArr.length()) {
                            urls.add(urlArr.getString(u))
                        }
                    }
                }
                if (domain.isNotEmpty() && !urls.contains(domain)) {
                    urls.add(domain)
                }

                if (username.isNotEmpty() || password.isNotEmpty()) {
                    list.add(AutofillVaultEntry(id, title, username, password, domain, urls, reprompt, totp))
                }
            }
        } catch (e: Exception) {
            // Malformed JSON ignored safely
        }
        return list
    }

    fun findMatches(context: Context, webDomain: String?, packageName: String?): List<AutofillVaultEntry> {
        val all = getAllEntries(context)
        if (all.isEmpty()) return emptyList()

        val cleanDomain = webDomain?.let { AutofillStructureParser.normalizeDomain(it) }
        val cleanPkg = packageName?.lowercase()?.trim()

        val exactMatches = mutableListOf<AutofillVaultEntry>()
        val looseMatches = mutableListOf<AutofillVaultEntry>()

        for (entry in all) {
            val entryDomain = AutofillStructureParser.normalizeDomain(entry.domain)
            val entryUrls = entry.urls.map { AutofillStructureParser.normalizeDomain(it) }

            // 1. Direct Web Domain Match
            if (cleanDomain != null) {
                if (entryDomain.isNotEmpty() && isDomainMatch(cleanDomain, entryDomain)) {
                    exactMatches.add(entry)
                    continue
                }
                if (entryUrls.any { isDomainMatch(cleanDomain, it) }) {
                    exactMatches.add(entry)
                    continue
                }
            }

            // 2. Package Name Match (for Android Native Apps)
            if (cleanPkg != null && cleanPkg.isNotEmpty()) {
                // If package contains entry title or domain keyword (e.g. com.twitter.android contains "twitter")
                val keyword = if (entryDomain.isNotEmpty()) entryDomain.split(".")[0] else entry.title.lowercase().trim()
                if (keyword.length >= 3 && cleanPkg.contains(keyword)) {
                    looseMatches.add(entry)
                    continue
                }
            }
        }

        return if (exactMatches.isNotEmpty()) exactMatches else looseMatches
    }

    private fun isDomainMatch(queryDomain: String, entryDomain: String): Boolean {
        if (queryDomain == entryDomain) return true
        if (queryDomain.endsWith(".$entryDomain")) return true
        if (entryDomain.endsWith(".$queryDomain")) return true

        // Check base site match (e.g., m.facebook.com and facebook.com)
        val qParts = queryDomain.split(".")
        val eParts = entryDomain.split(".")
        if (qParts.size >= 2 && eParts.size >= 2) {
            val qBase = qParts.takeLast(2).joinToString(".")
            val eBase = eParts.takeLast(2).joinToString(".")
            return qBase == eBase
        }
        return false
    }
}

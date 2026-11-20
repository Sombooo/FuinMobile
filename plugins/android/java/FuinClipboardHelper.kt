package com.sombooosteam.fuin

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import java.util.UUID

/**
 * Native Android clipboard security helper implementing Bitwarden / KeePassDX standards:
 * - Marks sensitive clips with EXTRA_IS_SENSITIVE (Android 13+ preview masking & Gboard backport)
 * - Uses API 28+ ClipboardManager.clearPrimaryClip() with empty-sensitive fallback for older APIs
 * - Dual-schedules auto-clear via main-looper Handler + OS AlarmManager (ClipboardClearReceiver)
 * - Tracks external clipboard changes via OnPrimaryClipChangedListener so newer user copies
 *   are never wiped by an older Fuin timer
 * - Zero plaintext persistence: stores only a random UUID token, expiry timestamp, and pending flag
 */
object FuinClipboardHelper {

    const val ACTION_CLEAR_CLIPBOARD = "com.sombooosteam.fuin.ACTION_CLEAR_CLIPBOARD"
    const val EXTRA_CLEAR_TOKEN = "fuin_clip_clear_token"
    const val EXTRA_IS_SENSITIVE_COMPAT = "android.content.extra.IS_SENSITIVE"

    private const val PREFS_NAME = "fuin_clipboard_guard"
    private const val KEY_TOKEN = "token"
    private const val KEY_EXPIRE_AT = "expire_at_ms"
    private const val KEY_PENDING_CLEAR = "pending_clear"
    private const val ALARM_REQUEST_CODE = 42917

    // Grace window covering asynchronous MainLooper delivery of onPrimaryClipChanged
    // immediately following our own setPrimaryClip / clearPrimaryClip call.
    private const val SELF_WRITE_SUPPRESS_WINDOW_MS = 500L

    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var pendingRunnable: Runnable? = null
    private var clipChangedListener: ClipboardManager.OnPrimaryClipChangedListener? = null
    private var isSelfWriting = false
    private var selfWriteSuppressUntilElapsedMs = 0L

    fun copyToClipboard(
        context: Context,
        text: String,
        durationMs: Long,
        isSensitive: Boolean
    ) {
        val appContext = context.applicationContext
        val clipboardManager = getClipboardManager(appContext) ?: return

        val clip = ClipData.newPlainText("Fuin", text)
        if (isSensitive) {
            markClipSensitive(clip)
        }

        synchronized(lock) {
            ensureClipChangedListenerRegisteredLocked(appContext, clipboardManager)
            setPrimaryClipInternalLocked(clipboardManager, clip)

            if (durationMs > 0L) {
                val token = UUID.randomUUID().toString()
                val nowMs = System.currentTimeMillis()
                val expireAtMs = if (Long.MAX_VALUE - nowMs < durationMs) {
                    Long.MAX_VALUE
                } else {
                    nowMs + durationMs
                }

                getPrefs(appContext).edit()
                    .putString(KEY_TOKEN, token)
                    .putLong(KEY_EXPIRE_AT, expireAtMs)
                    .putBoolean(KEY_PENDING_CLEAR, true)
                    .apply()

                scheduleHandlerClearLocked(appContext, token, durationMs)
                scheduleClearAlarmLocked(appContext, token, durationMs)
            } else {
                clearPendingStateLocked(appContext)
            }
        }
    }

    fun clearClipboardCompat(context: Context) {
        val appContext = context.applicationContext
        val clipboardManager = getClipboardManager(appContext) ?: return
        synchronized(lock) {
            clearClipboardCompatLocked(clipboardManager)
        }
    }

    fun clearIfTokenMatches(context: Context, expectedToken: String): Boolean {
        if (expectedToken.isEmpty()) return false
        val appContext = context.applicationContext
        synchronized(lock) {
            val prefs = getPrefs(appContext)
            val pendingClear = prefs.getBoolean(KEY_PENDING_CLEAR, false)
            val storedToken = prefs.getString(KEY_TOKEN, "") ?: ""
            if (!pendingClear || storedToken != expectedToken) {
                return false
            }

            clearPendingStateLocked(appContext)
            val clipboardManager = getClipboardManager(appContext)
            if (clipboardManager != null) {
                clearClipboardCompatLocked(clipboardManager)
            }
            return true
        }
    }

    fun clearIfExpired(context: Context): Boolean {
        val appContext = context.applicationContext
        synchronized(lock) {
            val prefs = getPrefs(appContext)
            val pendingClear = prefs.getBoolean(KEY_PENDING_CLEAR, false)
            val storedToken = prefs.getString(KEY_TOKEN, "") ?: ""
            val expireAtMs = prefs.getLong(KEY_EXPIRE_AT, 0L)

            if (!pendingClear || storedToken.isEmpty()) {
                return false
            }

            val nowMs = System.currentTimeMillis()
            if (nowMs >= expireAtMs) {
                return clearIfTokenMatches(appContext, storedToken)
            }

            val clipboardManager = getClipboardManager(appContext)
            if (clipboardManager != null) {
                ensureClipChangedListenerRegisteredLocked(appContext, clipboardManager)
            }
            val remainingMs = (expireAtMs - nowMs).coerceAtLeast(1L)
            scheduleHandlerClearLocked(appContext, storedToken, remainingMs)
            return false
        }
    }

    fun clearNow(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            clearPendingStateLocked(appContext)
            val clipboardManager = getClipboardManager(appContext)
            if (clipboardManager != null) {
                clearClipboardCompatLocked(clipboardManager)
            }
        }
    }

    fun cancelPendingClear(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            clearPendingStateLocked(appContext)
        }
    }

    private fun getClipboardManager(appContext: Context): ClipboardManager? {
        return appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    }

    private fun getPrefs(appContext: Context): SharedPreferences {
        return appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private fun markClipSensitive(clip: ClipData) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val sensitiveKey = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ClipDescription.EXTRA_IS_SENSITIVE
            } else {
                EXTRA_IS_SENSITIVE_COMPAT
            }
            val extras = clip.description.extras?.let { PersistableBundle(it) } ?: PersistableBundle()
            extras.putBoolean(sensitiveKey, true)
            clip.description.extras = extras
        }
    }

    private fun setPrimaryClipInternalLocked(clipboardManager: ClipboardManager, clip: ClipData) {
        isSelfWriting = true
        selfWriteSuppressUntilElapsedMs = SystemClock.elapsedRealtime() + SELF_WRITE_SUPPRESS_WINDOW_MS
        try {
            clipboardManager.setPrimaryClip(clip)
        } finally {
            selfWriteSuppressUntilElapsedMs = SystemClock.elapsedRealtime() + SELF_WRITE_SUPPRESS_WINDOW_MS
            isSelfWriting = false
        }
    }

    private fun clearClipboardCompatLocked(clipboardManager: ClipboardManager) {
        isSelfWriting = true
        selfWriteSuppressUntilElapsedMs = SystemClock.elapsedRealtime() + SELF_WRITE_SUPPRESS_WINDOW_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    clipboardManager.clearPrimaryClip()
                    return
                } catch (_: Exception) {
                    // Fall back to overwriting with an empty sensitive clip
                }
            }
            val emptyClip = ClipData.newPlainText("", "")
            markClipSensitive(emptyClip)
            clipboardManager.setPrimaryClip(emptyClip)
        } catch (_: Exception) {
            // Best-effort clipboard wipe
        } finally {
            selfWriteSuppressUntilElapsedMs = SystemClock.elapsedRealtime() + SELF_WRITE_SUPPRESS_WINDOW_MS
            isSelfWriting = false
        }
    }

    private fun ensureClipChangedListenerRegisteredLocked(
        appContext: Context,
        clipboardManager: ClipboardManager
    ) {
        if (clipChangedListener != null) return
        val listener = ClipboardManager.OnPrimaryClipChangedListener {
            onPrimaryClipChanged(appContext)
        }
        try {
            clipboardManager.addPrimaryClipChangedListener(listener)
            clipChangedListener = listener
        } catch (_: Exception) {
            // Ignore listener registration failure on restricted environments
        }
    }

    private fun onPrimaryClipChanged(appContext: Context) {
        synchronized(lock) {
            val nowElapsed = SystemClock.elapsedRealtime()
            if (isSelfWriting || nowElapsed <= selfWriteSuppressUntilElapsedMs) {
                return
            }
            if (getPrefs(appContext).getBoolean(KEY_PENDING_CLEAR, false)) {
                clearPendingStateLocked(appContext)
            }
        }
    }

    private fun scheduleHandlerClearLocked(appContext: Context, token: String, delayMs: Long) {
        cancelHandlerClearLocked()
        val runnable = Runnable {
            clearIfTokenMatches(appContext, token)
        }
        pendingRunnable = runnable
        mainHandler.postDelayed(runnable, delayMs)
    }

    private fun cancelHandlerClearLocked() {
        pendingRunnable?.let { mainHandler.removeCallbacks(it) }
        pendingRunnable = null
    }

    private fun buildClearAlarmIntent(appContext: Context, token: String?): Intent {
        return Intent(appContext, ClipboardClearReceiver::class.java).apply {
            action = ACTION_CLEAR_CLIPBOARD
            if (token != null) {
                putExtra(EXTRA_CLEAR_TOKEN, token)
            }
        }
    }

    private fun scheduleClearAlarmLocked(appContext: Context, token: String, durationMs: Long) {
        try {
            val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val pendingIntent = PendingIntent.getBroadcast(
                appContext,
                ALARM_REQUEST_CODE,
                buildClearAlarmIntent(appContext, token),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val nowElapsed = SystemClock.elapsedRealtime()
            val triggerAtElapsedMs = if (Long.MAX_VALUE - nowElapsed < durationMs) {
                Long.MAX_VALUE
            } else {
                nowElapsed + durationMs
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (alarmManager.canScheduleExactAlarms()) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.ELAPSED_REALTIME_WAKEUP,
                            triggerAtElapsedMs,
                            pendingIntent
                        )
                        return
                    } catch (_: SecurityException) {
                        // Fall through to inexact allow-while-idle alarm
                    }
                }
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAtElapsedMs,
                    pendingIntent
                )
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerAtElapsedMs,
                        pendingIntent
                    )
                } catch (_: SecurityException) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerAtElapsedMs,
                        pendingIntent
                    )
                }
            } else {
                alarmManager.set(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAtElapsedMs,
                    pendingIntent
                )
            }
        } catch (_: Exception) {
            // Handler-based clear remains active even if OS alarm scheduling is unavailable
        }
    }

    private fun cancelClearAlarmLocked(appContext: Context) {
        try {
            val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val pendingIntent = PendingIntent.getBroadcast(
                appContext,
                ALARM_REQUEST_CODE,
                buildClearAlarmIntent(appContext, token = null),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
        } catch (_: Exception) {
            // Best-effort alarm cancellation
        }
    }

    private fun clearPendingStateLocked(appContext: Context) {
        cancelHandlerClearLocked()
        cancelClearAlarmLocked(appContext)
        getPrefs(appContext).edit()
            .putBoolean(KEY_PENDING_CLEAR, false)
            .remove(KEY_TOKEN)
            .remove(KEY_EXPIRE_AT)
            .apply()
    }
}

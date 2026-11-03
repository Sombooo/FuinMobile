package com.sombooosteam.fuin

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FuinAutofillModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FuinAutofillModule"

    @ReactMethod
    fun isAutofillEnabled(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val autofillManager = reactContext.getSystemService(AutofillManager::class.java)
                val isEnabled = autofillManager?.hasEnabledAutofillServices() ?: false
                promise.resolve(isEnabled)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("AUTOFILL_STATUS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openAutofillSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            try {
                val fallbackIntent = Intent(Settings.ACTION_SETTINGS).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(fallbackIntent)
                promise.resolve(true)
            } catch (err: Exception) {
                promise.reject("AUTOFILL_SETTINGS_ERROR", err.message, err)
            }
        }
    }

    @ReactMethod
    fun syncAutofillVault(entriesJson: String, timeoutMs: Double, promise: Promise) {
        try {
            val safeTimeoutMs = if (timeoutMs >= 0) timeoutMs.toLong() else 60_000L
            AutofillSecureStore.saveVaultEntries(reactContext, entriesJson, safeTimeoutMs)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUTOFILL_SYNC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun peekPendingSaves(promise: Promise) {
        try {
            val pendingJson = AutofillSecureStore.peekPendingSavesJson(reactContext)
            promise.resolve(pendingJson)
        } catch (e: Exception) {
            promise.reject("AUTOFILL_PEEK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun ackPendingSaves(consumedIdsJson: String, promise: Promise) {
        try {
            AutofillSecureStore.ackPendingSaves(reactContext, consumedIdsJson)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUTOFILL_ACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearAutofillVault(promise: Promise) {
        try {
            AutofillSecureStore.clearAll(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUTOFILL_CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun lockAutofillSession(promise: Promise) {
        try {
            AutofillSecureStore.clearSession(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUTOFILL_LOCK_ERROR", e.message, e)
        }
    }
}

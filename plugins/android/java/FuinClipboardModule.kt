package com.sombooosteam.fuin

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FuinClipboardModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FuinClipboardModule"

    @ReactMethod
    fun copySensitive(text: String, durationMs: Double, isSensitive: Boolean, promise: Promise) {
        val safeDurationMs = if (durationMs.isFinite() && durationMs > 0.0) {
            durationMs.toLong().coerceAtLeast(0L)
        } else {
            0L
        }
        try {
            reactContext.runOnUiQueueThread {
                try {
                    FuinClipboardHelper.copyToClipboard(
                        reactContext.applicationContext,
                        text,
                        safeDurationMs,
                        isSensitive
                    )
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("CLIPBOARD_COPY_ERROR", e.message, e)
                }
            }
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_COPY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearNow(promise: Promise) {
        try {
            reactContext.runOnUiQueueThread {
                try {
                    FuinClipboardHelper.clearNow(reactContext.applicationContext)
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("CLIPBOARD_CLEAR_ERROR", e.message, e)
                }
            }
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearIfExpired(promise: Promise) {
        try {
            reactContext.runOnUiQueueThread {
                try {
                    val cleared = FuinClipboardHelper.clearIfExpired(reactContext.applicationContext)
                    promise.resolve(cleared)
                } catch (e: Exception) {
                    promise.reject("CLIPBOARD_EXPIRE_CHECK_ERROR", e.message, e)
                }
            }
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_EXPIRE_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cancelPendingClear(promise: Promise) {
        try {
            reactContext.runOnUiQueueThread {
                try {
                    FuinClipboardHelper.cancelPendingClear(reactContext.applicationContext)
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("CLIPBOARD_CANCEL_ERROR", e.message, e)
                }
            }
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_CANCEL_ERROR", e.message, e)
        }
    }
}

package com.sombooosteam.fuin

import android.net.Uri
import java.nio.ByteBuffer
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Zero-dependency RFC 6238 TOTP generator for 2FA autofill fields.
 */
object AutofillTotpGenerator {
    private const val BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun generateCode(rawSecretOrUri: String?, timestampMs: Long = System.currentTimeMillis()): String? {
        if (rawSecretOrUri.isNullOrBlank()) return null
        val trimmed = rawSecretOrUri.trim()

        var secret = trimmed
        var digits = 6
        var period = 30L
        var algorithm = "HmacSHA1"

        if (trimmed.lowercase(Locale.ROOT).startsWith("otpauth://")) {
            try {
                val uri = Uri.parse(trimmed)
                secret = uri.getQueryParameter("secret") ?: return null
                digits = uri.getQueryParameter("digits")?.toIntOrNull()?.coerceIn(6, 8) ?: 6
                period = uri.getQueryParameter("period")?.toLongOrNull()?.takeIf { it > 0 } ?: 30L
                algorithm = when (uri.getQueryParameter("algorithm")?.uppercase(Locale.ROOT)) {
                    "SHA256" -> "HmacSHA256"
                    "SHA512" -> "HmacSHA512"
                    else -> "HmacSHA1"
                }
            } catch (_: Exception) {
                return null
            }
        }

        val keyBytes = decodeBase32(secret) ?: return null
        if (keyBytes.isEmpty()) return null

        return try {
            val counter = (timestampMs / 1000L) / period
            val buffer = ByteBuffer.allocate(8).putLong(counter).array()
            val mac = Mac.getInstance(algorithm)
            mac.init(SecretKeySpec(keyBytes, algorithm))
            val hash = mac.doFinal(buffer)
            val offset = hash[hash.size - 1].toInt() and 0x0F
            val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                (hash[offset + 3].toInt() and 0xFF)
            var mod = 1
            repeat(digits) { mod *= 10 }
            val otp = binary % mod
            otp.toString().padStart(digits, '0')
        } catch (_: Exception) {
            null
        }
    }

    private fun decodeBase32(input: String): ByteArray? {
        val clean = input.uppercase(Locale.ROOT).replace(Regex("[\\s\\-=]"), "")
        if (clean.isEmpty()) return null
        val output = mutableListOf<Byte>()
        var buffer = 0
        var bitsLeft = 0
        for (ch in clean) {
            val valIdx = BASE32_CHARS.indexOf(ch)
            if (valIdx < 0) return null
            buffer = (buffer shl 5) or valIdx
            bitsLeft += 5
            if (bitsLeft >= 8) {
                bitsLeft -= 8
                output.add(((buffer shr bitsLeft) and 0xFF).toByte())
            }
        }
        return output.toByteArray()
    }
}

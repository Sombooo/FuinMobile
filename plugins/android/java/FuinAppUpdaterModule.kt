package com.sombooosteam.fuin

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale

/**
 * Secure native Android self-updater helper:
 * - Streams SHA-256 verification off the JS thread (zero JS heap pressure for large APKs)
 * - Verifies downloaded APK packageName, signing certificate continuity, and anti-downgrade versionCode
 * - Launches Android's system PackageInstaller via scoped FuinUpdateFileProvider
 */
class FuinAppUpdaterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FuinAppUpdaterModule"

    private fun getUpdateDir(): File {
        val dir = File(reactContext.cacheDir, "fuin_updates")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun resolveSafeUpdateFile(rawPath: String): File? {
        if (rawPath.isBlank()) return null
        val cleanPath = rawPath.trim().removePrefix("file://")
        val target = File(cleanPath)
        val allowedRoot = getUpdateDir().canonicalFile
        val canonicalTarget = target.canonicalFile
        val rootPrefix = allowedRoot.path + File.separator
        if (!canonicalTarget.path.startsWith(rootPrefix)) {
            return null
        }
        return canonicalTarget
    }

    private fun getLongVersionCode(info: PackageInfo): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }

    @Suppress("DEPRECATION")
    private fun getArchivePackageInfoAndCertSha256(apkPath: String): Pair<PackageInfo, String>? {
        val pm = reactContext.packageManager
        val archiveInfo: PackageInfo = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
                val combinedFlags = (PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES).toLong()
                pm.getPackageArchiveInfo(apkPath, PackageManager.PackageInfoFlags.of(combinedFlags))
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> {
                pm.getPackageArchiveInfo(
                    apkPath,
                    PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
                )
            }
            else -> {
                pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES)
            }
        } ?: return null

        val certBytes: ByteArray? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = archiveInfo.signingInfo
            val signers = if (signingInfo != null) {
                if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners
                else signingInfo.signingCertificateHistory
            } else {
                null
            }
            signers?.firstOrNull()?.toByteArray() ?: archiveInfo.signatures?.firstOrNull()?.toByteArray()
        } else {
            archiveInfo.signatures?.firstOrNull()?.toByteArray()
        }

        if (certBytes == null || certBytes.isEmpty()) return null

        val digest = MessageDigest.getInstance("SHA-256").digest(certBytes)
        val hex = digest.joinToString("") { "%02x".format(Locale.ROOT, it) }
        return Pair(archiveInfo, hex)
    }

    private fun computeFileSha256Hex(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536)
        FileInputStream(file).use { fis ->
            while (true) {
                val read = fis.read(buffer)
                if (read <= 0) break
                md.update(buffer, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(Locale.ROOT, it) }
    }

    private fun verifyApkIntegrityInternal(apkFile: File, expectedSha256: String?): PackageInfo {
        if (!apkFile.exists() || !apkFile.isFile || apkFile.length() < 1024L) {
            throw SecurityException("APK_FILE_INVALID")
        }

        val cleanExpected = expectedSha256?.trim()?.lowercase(Locale.ROOT) ?: ""
        if (cleanExpected.isNotEmpty()) {
            if (!Regex("^[0-9a-f]{64}$").matches(cleanExpected)) {
                apkFile.delete()
                throw SecurityException("EXPECTED_SHA256_MALFORMED")
            }
            val actualSha256 = computeFileSha256Hex(apkFile)
            val matches = MessageDigest.isEqual(
                actualSha256.toByteArray(Charsets.UTF_8),
                cleanExpected.toByteArray(Charsets.UTF_8)
            )
            if (!matches) {
                apkFile.delete()
                throw SecurityException("APK_SHA256_MISMATCH")
            }
        }

        val parsed = getArchivePackageInfoAndCertSha256(apkFile.absolutePath)
        if (parsed == null) {
            apkFile.delete()
            throw SecurityException("APK_ARCHIVE_CORRUPT_OR_UNSIGNED")
        }
        val (archiveInfo, archiveCertSha256) = parsed

        if (archiveInfo.packageName != reactContext.packageName) {
            apkFile.delete()
            throw SecurityException("APK_PACKAGE_MISMATCH")
        }

        val installedCertSha256 = AutofillDomainMatcher.getApkSignatureSha256(
            reactContext,
            reactContext.packageName
        )
        if (installedCertSha256.isNullOrEmpty()) {
            apkFile.delete()
            throw SecurityException("INSTALLED_SIGNATURE_UNAVAILABLE")
        }

        val certMatches = MessageDigest.isEqual(
            archiveCertSha256.toByteArray(Charsets.UTF_8),
            installedCertSha256.lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8)
        )
        if (!certMatches) {
            apkFile.delete()
            throw SecurityException("APK_SIGNATURE_MISMATCH")
        }

        val installedInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.packageManager.getPackageInfo(
                reactContext.packageName,
                PackageManager.PackageInfoFlags.of(0L)
            )
        } else {
            @Suppress("DEPRECATION")
            reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
        }

        val installedCode = getLongVersionCode(installedInfo)
        val archiveCode = getLongVersionCode(archiveInfo)
        if (archiveCode < installedCode) {
            apkFile.delete()
            throw SecurityException("APK_VERSION_DOWNGRADE_BLOCKED")
        }

        return archiveInfo
    }

    @ReactMethod
    fun getAppVersionInfo(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(reactContext.packageName, PackageManager.PackageInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(reactContext.packageName, 0)
            }
            val map = Arguments.createMap().apply {
                putString("versionName", info.versionName ?: "1.0.0")
                putDouble("versionCode", getLongVersionCode(info).toDouble())
                putString("packageName", reactContext.packageName)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("APP_VERSION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getUpdateTargetFilePath(promise: Promise) {
        try {
            val target = File(getUpdateDir(), "fuin-update.apk")
            if (target.exists()) {
                target.delete()
            }
            promise.resolve(target.absolutePath)
        } catch (e: Exception) {
            promise.reject("UPDATE_TARGET_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun canInstallPackages(promise: Promise) {
        try {
            val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.packageManager.canRequestPackageInstalls()
            } else {
                true
            }
            promise.resolve(allowed)
        } catch (e: Exception) {
            promise.reject("CAN_INSTALL_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openInstallPermissionSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_SECURITY_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(fallback)
                promise.resolve(true)
            } catch (err: Exception) {
                promise.reject("OPEN_INSTALL_SETTINGS_ERROR", err.message, err)
            }
        }
    }

    @ReactMethod
    fun verifyDownloadedApk(filePath: String, expectedSha256: String?, promise: Promise) {
        Thread {
            try {
                val safeFile = resolveSafeUpdateFile(filePath)
                    ?: throw SecurityException("UNSAFE_UPDATE_PATH")
                val archiveInfo = verifyApkIntegrityInternal(safeFile, expectedSha256)
                val map = Arguments.createMap().apply {
                    putBoolean("verified", true)
                    putString("path", safeFile.absolutePath)
                    putString("versionName", archiveInfo.versionName ?: "")
                    putDouble("versionCode", getLongVersionCode(archiveInfo).toDouble())
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("APK_VERIFY_FAILED", e.message ?: "Verification failed", e)
            }
        }.start()
    }

    @ReactMethod
    fun installVerifiedApk(filePath: String, promise: Promise) {
        Thread {
            try {
                val safeFile = resolveSafeUpdateFile(filePath)
                    ?: throw SecurityException("UNSAFE_UPDATE_PATH")

                // Re-verify package & signing certificate continuity immediately prior to install (anti-TOCTOU)
                verifyApkIntegrityInternal(safeFile, null)

                val authority = "${reactContext.packageName}.apkupdateprovider"
                val contentUri = FileProvider.getUriForFile(reactContext, authority, safeFile)

                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                reactContext.startActivity(installIntent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("APK_INSTALL_FAILED", e.message ?: "Install launch failed", e)
            }
        }.start()
    }

    @ReactMethod
    fun cleanupUpdateCache(promise: Promise) {
        Thread {
            try {
                val dir = File(reactContext.cacheDir, "fuin_updates")
                if (dir.exists() && dir.isDirectory) {
                    dir.listFiles()?.forEach { f ->
                        try { f.delete() } catch (_: Exception) {}
                    }
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }.start()
    }
}

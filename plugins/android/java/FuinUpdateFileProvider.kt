package com.sombooosteam.fuin

import androidx.core.content.FileProvider

/**
 * Dedicated FileProvider subclass for in-app APK updates so Gradle Manifest Merger
 * never collides with other libraries' FileProvider declarations.
 */
class FuinUpdateFileProvider : FileProvider()

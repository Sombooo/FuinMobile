package com.sombooosteam.fuin

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import java.util.Locale

@RequiresApi(Build.VERSION_CODES.O)
class FuinAutofillService : AutofillService() {

    @Suppress("DEPRECATION")
    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        if (cancellationSignal.isCanceled) return

        val fillContexts = request.fillContexts
        if (fillContexts.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val isManualRequest = (request.flags and FillRequest.FLAG_MANUAL_REQUEST) != 0
        val parsed = AutofillStructureParser.parse(fillContexts.last().structure)

        if (parsed.isBlockedPackage) {
            callback.onSuccess(null)
            return
        }

        if (!isManualRequest && !parsed.hasAuthFields) {
            callback.onSuccess(null)
            return
        }

        val usernameField = parsed.usernameField
        val passwordField = parsed.passwordField
        val totpField = parsed.totpField
        val manualFallbackField = if (isManualRequest && !parsed.hasAuthFields) parsed.focusedField else null

        if (usernameField == null && passwordField == null && totpField == null && manualFallbackField == null) {
            callback.onSuccess(null)
            return
        }

        // Only present autofill dataset popups when an auth field is focused (or on an explicit manual request).
        // Even if focus started on a non-auth field of a registration form, we still allow SaveInfo below when passwordField != null!
        val allowDatasetSuggestions = isManualRequest || parsed.isFocusOnAuthField

        val responseBuilder = FillResponse.Builder()
        var datasetsAdded = 0

        if (allowDatasetSuggestions) {
            // Single AndroidKeyStore AES-GCM read for the fill request
            val snapshot = AutofillSecureStore.loadSnapshot(this)
            val matchingEntries = AutofillDomainMatcher.findMatches(
                context = this,
                entries = snapshot.entries,
                rawWebDomain = parsed.webDomain,
                packageName = parsed.packageName,
                pinnedPackages = snapshot.pinnedPackages
            )

            val pkgLower = parsed.packageName?.lowercase(Locale.ROOT)?.trim().orEmpty()
            val pinnedRecord = if (pkgLower.isNotEmpty()) snapshot.pinnedPackages[pkgLower] else null
            val isUnpinnedNativeApp = pkgLower.isNotEmpty() &&
                !AutofillStructureParser.isBrowserPackage(pkgLower) &&
                (pinnedRecord == null || pinnedRecord.certSha256.isEmpty())

            if (matchingEntries.isNotEmpty()) {
                for (entry in matchingEntries) {
                    val requiresAuth = !snapshot.isSessionUnlocked || entry.reprompt || isUnpinnedNativeApp
                    val title = entry.title.ifEmpty { entry.domain.ifEmpty { "Fuin" } }
                    val totpCode = if (totpField != null) AutofillTotpGenerator.generateCode(entry.totp) else null

                    val fieldPairs = buildFieldValuePairs(
                        entry = entry,
                        totpCode = totpCode,
                        usernameField = usernameField,
                        passwordField = passwordField,
                        totpField = totpField,
                        manualFallbackField = manualFallbackField
                    )
                    if (fieldPairs.isEmpty()) continue

                    if (!requiresAuth) {
                        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item).apply {
                            setTextViewText(R.id.autofill_title, title)
                            setTextViewText(R.id.autofill_subtitle, entry.username.ifEmpty { "••••••••" })
                        }
                        val datasetBuilder = Dataset.Builder()
                        for ((fieldId, value) in fieldPairs) {
                            datasetBuilder.setValue(fieldId, AutofillValue.forText(value), presentation)
                        }
                        if (tryAddDataset(responseBuilder, datasetBuilder)) {
                            datasetsAdded++
                        }
                    } else {
                        val subtitle = when {
                            entry.reprompt -> "Doğrulama gerekli"
                            isUnpinnedNativeApp -> "Uygulamayı doğrulamak için dokunun"
                            else -> "Şifreyi doldurmak için dokunun"
                        }
                        val authIntent = createAuthIntent(
                            parsedPackage = parsed.packageName,
                            usernameField = usernameField,
                            passwordField = passwordField,
                            totpField = totpField,
                            manualFallbackField = manualFallbackField
                        ).apply {
                            putExtra(AutofillAuthActivity.EXTRA_ENTRY_ID, entry.id)
                        }
                        val added = addAuthenticatedDataset(
                            responseBuilder = responseBuilder,
                            requestCode = ((entry.id.hashCode() * 31 + datasetsAdded) and 0x7FFFFFFF),
                            intent = authIntent,
                            title = "Fuin • $title",
                            subtitle = subtitle,
                            targetIds = fieldPairs.map { it.first }
                        )
                        if (added) datasetsAdded++
                    }
                }
            } else if (isManualRequest) {
                val anchorId = passwordField?.autofillId
                    ?: usernameField?.autofillId
                    ?: totpField?.autofillId
                    ?: manualFallbackField?.autofillId

                if (anchorId != null) {
                    if (snapshot.entries.isEmpty()) {
                        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                        if (launchIntent != null) {
                            val added = addAuthenticatedDataset(
                                responseBuilder = responseBuilder,
                                requestCode = 1001,
                                intent = launchIntent,
                                title = "Fuin",
                                subtitle = "Kayıtları eşitlemek için Fuin'i açın",
                                targetIds = listOf(anchorId)
                            )
                            if (added) datasetsAdded++
                        }
                    } else {
                        val pickerIntent = createAuthIntent(
                            parsedPackage = parsed.packageName,
                            usernameField = usernameField,
                            passwordField = passwordField,
                            totpField = totpField,
                            manualFallbackField = manualFallbackField
                        ).apply {
                            putExtra(AutofillAuthActivity.EXTRA_MANUAL_PICKER, true)
                        }
                        val added = addAuthenticatedDataset(
                            responseBuilder = responseBuilder,
                            requestCode = 1002,
                            intent = pickerIntent,
                            title = "Fuin Kasasından Seç",
                            subtitle = "Kayıtlı hesaplar arasından seçmek için dokunun",
                            targetIds = listOf(anchorId)
                        )
                        if (added) datasetsAdded++
                    }
                }
            }
        }

        // STRICT SAVE INFO INVARIANT: ONLY register SaveInfo when a genuine password field exists!
        // Uses FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE so Chrome, WebViews, SPAs (e.g. chess.com), and single-Activity
        // apps prompt "Save to Fuin?" immediately upon login form submission without needing Activity.finish().
        var hasSaveInfo = false
        if (passwordField != null) {
            val effectiveSaveUsername = usernameField ?: findPriorUsernameField(fillContexts, parsed)
            val saveTypes = if (effectiveSaveUsername != null) {
                SaveInfo.SAVE_DATA_TYPE_PASSWORD or SaveInfo.SAVE_DATA_TYPE_USERNAME
            } else {
                SaveInfo.SAVE_DATA_TYPE_PASSWORD
            }
            val saveBuilder = SaveInfo.Builder(
                saveTypes,
                arrayOf(passwordField.autofillId)
            ).setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)

            if (effectiveSaveUsername != null && effectiveSaveUsername.autofillId != passwordField.autofillId) {
                saveBuilder.setOptionalIds(arrayOf(effectiveSaveUsername.autofillId))
            }
            responseBuilder.setSaveInfo(saveBuilder.build())
            hasSaveInfo = true
        }

        if (datasetsAdded == 0 && !hasSaveInfo) {
            callback.onSuccess(null)
            return
        }

        callback.onSuccess(responseBuilder.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        try {
            val structures = request.fillContexts.mapNotNull { it.structure }
            if (structures.isNotEmpty()) {
                val captured = AutofillStructureParser.extractCapturedCredentials(structures)
                if (captured.password.isNotBlank() && !AutofillStructureParser.isBlockedPackage(captured.packageName)) {
                    AutofillSecureStore.enqueuePendingSave(
                        context = this,
                        username = captured.username,
                        password = captured.password,
                        webDomain = captured.webDomain,
                        packageName = captured.packageName
                    )
                }
            }
        } catch (_: Exception) {
            // Never crash Android Autofill framework
        }
        callback.onSuccess()
    }

    private fun findPriorUsernameField(
        fillContexts: List<FillContext>,
        currentParsed: ParsedAutofillStructure
    ): ParsedAutofillField? {
        if (fillContexts.size <= 1) return null
        val curDom = currentParsed.webDomain
        val curPkg = currentParsed.packageName
        for (i in (fillContexts.size - 2) downTo 0) {
            val prev = AutofillStructureParser.parse(fillContexts[i].structure, includeInvisible = true)
            if (prev.isBlockedPackage) continue
            val prevDom = prev.webDomain
            val sameOrigin = if (!curDom.isNullOrBlank() || !prevDom.isNullOrBlank()) {
                !curDom.isNullOrBlank() &&
                    !prevDom.isNullOrBlank() &&
                    AutofillDomainMatcher.isDomainMatch(curDom, prevDom)
            } else {
                !curPkg.isNullOrBlank() && prev.packageName == curPkg
            }
            if (sameOrigin && prev.usernameField != null) {
                return prev.usernameField
            }
        }
        return null
    }

    private fun buildFieldValuePairs(
        entry: AutofillVaultEntry,
        totpCode: String?,
        usernameField: ParsedAutofillField?,
        passwordField: ParsedAutofillField?,
        totpField: ParsedAutofillField?,
        manualFallbackField: ParsedAutofillField?
    ): List<Pair<AutofillId, String>> {
        val pairs = mutableListOf<Pair<AutofillId, String>>()
        if (usernameField != null && entry.username.isNotEmpty()) {
            pairs.add(usernameField.autofillId to entry.username)
        }
        if (passwordField != null && entry.password.isNotEmpty()) {
            pairs.add(passwordField.autofillId to entry.password)
        }
        if (totpField != null && !totpCode.isNullOrEmpty()) {
            pairs.add(totpField.autofillId to totpCode)
        }
        if (pairs.isEmpty() && manualFallbackField != null && entry.username.isNotEmpty()) {
            pairs.add(manualFallbackField.autofillId to entry.username)
        }
        return pairs
    }

    private fun createAuthIntent(
        parsedPackage: String?,
        usernameField: ParsedAutofillField?,
        passwordField: ParsedAutofillField?,
        totpField: ParsedAutofillField?,
        manualFallbackField: ParsedAutofillField?
    ): Intent {
        return Intent(this, AutofillAuthActivity::class.java).apply {
            parsedPackage?.let { putExtra(AutofillAuthActivity.EXTRA_TARGET_PACKAGE, it) }
            usernameField?.let { putExtra(AutofillAuthActivity.EXTRA_USERNAME_ID, it.autofillId) }
            passwordField?.let { putExtra(AutofillAuthActivity.EXTRA_PASSWORD_ID, it.autofillId) }
            totpField?.let { putExtra(AutofillAuthActivity.EXTRA_TOTP_ID, it.autofillId) }
            manualFallbackField?.let { putExtra(AutofillAuthActivity.EXTRA_MANUAL_FIELD_ID, it.autofillId) }
        }
    }

    @Suppress("DEPRECATION")
    private fun addAuthenticatedDataset(
        responseBuilder: FillResponse.Builder,
        requestCode: Int,
        intent: Intent,
        title: String,
        subtitle: String,
        targetIds: List<AutofillId>
    ): Boolean {
        if (targetIds.isEmpty()) return false
        return try {
            val pendingIntent = PendingIntent.getActivity(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val presentation = RemoteViews(packageName, R.layout.autofill_auth_item).apply {
                setTextViewText(R.id.autofill_auth_title, title)
                setTextViewText(R.id.autofill_auth_subtitle, subtitle)
            }
            val datasetBuilder = Dataset.Builder()
            datasetBuilder.setAuthentication(pendingIntent.intentSender)
            for (fieldId in targetIds) {
                datasetBuilder.setValue(fieldId, null, presentation)
            }
            tryAddDataset(responseBuilder, datasetBuilder)
        } catch (_: Exception) {
            false
        }
    }

    private fun tryAddDataset(responseBuilder: FillResponse.Builder, datasetBuilder: Dataset.Builder): Boolean {
        return try {
            responseBuilder.addDataset(datasetBuilder.build())
            true
        } catch (_: Exception) {
            false
        }
    }
}

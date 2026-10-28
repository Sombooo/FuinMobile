package com.sombooosteam.fuin

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.O)
class FuinAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        if (cancellationSignal.isCanceled) {
            return
        }

        val fillContexts = request.fillContexts
        if (fillContexts.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val latestStructure = fillContexts.last().structure
        val parsed = AutofillStructureParser.parse(latestStructure)

        val usernameField = parsed.usernameField
        val passwordField = parsed.passwordField

        // If neither username nor password field exists on page, skip
        if (usernameField == null && passwordField == null) {
            callback.onSuccess(null)
            return
        }

        val matchingEntries = AutofillSecureStore.findMatches(this, parsed.webDomain, parsed.packageName)
        if (matchingEntries.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val isSessionUnlocked = AutofillSecureStore.isSessionUnlocked(this)
        val responseBuilder = FillResponse.Builder()

        for (entry in matchingEntries) {
            val requiresAuth = !isSessionUnlocked || entry.reprompt

            if (!requiresAuth) {
                // Unlocked & No Reprompt: Direct Instant Fill
                val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item).apply {
                    setTextViewText(R.id.autofill_title, entry.title.ifEmpty { entry.domain.ifEmpty { "Fuin" } })
                    setTextViewText(R.id.autofill_subtitle, entry.username.ifEmpty { "••••••••" })
                }

                val datasetBuilder = Dataset.Builder()
                if (usernameField != null && entry.username.isNotEmpty()) {
                    datasetBuilder.setValue(
                        usernameField.autofillId,
                        AutofillValue.forText(entry.username),
                        presentation
                    )
                }
                if (passwordField != null && entry.password.isNotEmpty()) {
                    datasetBuilder.setValue(
                        passwordField.autofillId,
                        AutofillValue.forText(entry.password),
                        presentation
                    )
                }

                try {
                    responseBuilder.addDataset(datasetBuilder.build())
                } catch (e: Exception) {
                    // Ignore dataset build issue
                }
            } else {
                // Locked OR Reprompt Required: Authenticated Fill
                val presentation = RemoteViews(packageName, R.layout.autofill_auth_item).apply {
                    val title = entry.title.ifEmpty { entry.domain.ifEmpty { "Fuin" } }
                    setTextViewText(R.id.autofill_auth_title, "Fuin • $title")
                    val sub = if (entry.reprompt) "Doğrulama gerekli" else "Şifreyi doldurmak için dokunun"
                    setTextViewText(R.id.autofill_auth_subtitle, sub)
                }

                val authIntent = Intent(this, AutofillAuthActivity::class.java).apply {
                    putExtra("EXTRA_ENTRY_ID", entry.id)
                    usernameField?.let { putExtra("EXTRA_USERNAME_ID", it.autofillId) }
                    passwordField?.let { putExtra("EXTRA_PASSWORD_ID", it.autofillId) }
                }

                val requestCode = (entry.id.hashCode() and 0x7FFFFFFF)
                val pendingIntent = PendingIntent.getActivity(
                    this,
                    requestCode,
                    authIntent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val datasetBuilder = Dataset.Builder(presentation)
                datasetBuilder.setAuthentication(pendingIntent.intentSender)

                if (usernameField != null) {
                    datasetBuilder.setValue(usernameField.autofillId, AutofillValue.forText(entry.username))
                }
                if (passwordField != null) {
                    datasetBuilder.setValue(passwordField.autofillId, AutofillValue.forText(entry.password))
                }

                try {
                    responseBuilder.addDataset(datasetBuilder.build())
                } catch (e: Exception) {
                    // Ignore dataset build issue
                }
            }
        }

        // Configure SaveInfo so Android prompts user to save credentials after successful login
        val saveFields = mutableListOf<AutofillId>()
        passwordField?.let { saveFields.add(it.autofillId) }
        usernameField?.let { saveFields.add(it.autofillId) }

        if (saveFields.isNotEmpty()) {
            val saveInfo = SaveInfo.Builder(
                SaveInfo.SAVE_DATA_TYPE_PASSWORD or SaveInfo.SAVE_DATA_TYPE_USERNAME,
                saveFields.toTypedArray()
            ).build()
            responseBuilder.setSaveInfo(saveInfo)
        }

        callback.onSuccess(responseBuilder.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val fillContexts = request.fillContexts
        if (fillContexts.isNotEmpty()) {
            val latestStructure = fillContexts.last().structure
            val parsed = AutofillStructureParser.parse(latestStructure)

            // Extract entered username / password for potential notification or Fuin save prompt
            val clientState = request.clientState
        }
        callback.onSuccess()
    }
}

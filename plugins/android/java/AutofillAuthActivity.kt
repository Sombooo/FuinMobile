package com.sombooosteam.fuin

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ListView
import android.widget.RemoteViews
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.util.concurrent.Executor

class AutofillAuthActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_ENTRY_ID = "EXTRA_ENTRY_ID"
        const val EXTRA_USERNAME_ID = "EXTRA_USERNAME_ID"
        const val EXTRA_PASSWORD_ID = "EXTRA_PASSWORD_ID"
        const val EXTRA_TOTP_ID = "EXTRA_TOTP_ID"
        const val EXTRA_MANUAL_FIELD_ID = "EXTRA_MANUAL_FIELD_ID"
        const val EXTRA_MANUAL_PICKER = "EXTRA_MANUAL_PICKER"
        const val EXTRA_TARGET_PACKAGE = "EXTRA_TARGET_PACKAGE"
    }

    private lateinit var executor: Executor
    private var targetEntryId: String? = null
    private var targetPackageName: String? = null
    private var isManualPicker: Boolean = false
    private var pendingRepromptEntry: AutofillVaultEntry? = null

    private var usernameAutofillId: AutofillId? = null
    private var passwordAutofillId: AutofillId? = null
    private var totpAutofillId: AutofillId? = null
    private var manualFieldAutofillId: AutofillId? = null

    private lateinit var titleText: TextView
    private lateinit var subtitleText: TextView
    private lateinit var errorText: TextView
    private lateinit var pickerList: ListView
    private lateinit var btnConfirm: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enforce screen capture protection (AGENTS.md invariant)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        setContentView(R.layout.activity_autofill_auth)
        executor = ContextCompat.getMainExecutor(this)

        targetEntryId = intent.getStringExtra(EXTRA_ENTRY_ID)
        targetPackageName = intent.getStringExtra(EXTRA_TARGET_PACKAGE)
        isManualPicker = intent.getBooleanExtra(EXTRA_MANUAL_PICKER, false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            usernameAutofillId = getAutofillIdExtra(EXTRA_USERNAME_ID)
            passwordAutofillId = getAutofillIdExtra(EXTRA_PASSWORD_ID)
            totpAutofillId = getAutofillIdExtra(EXTRA_TOTP_ID)
            manualFieldAutofillId = getAutofillIdExtra(EXTRA_MANUAL_FIELD_ID)
        }

        titleText = findViewById(R.id.auth_dialog_title)
        subtitleText = findViewById(R.id.auth_dialog_subtitle)
        errorText = findViewById(R.id.auth_error_text)
        pickerList = findViewById(R.id.auth_picker_list)
        btnConfirm = findViewById(R.id.btn_confirm_auth)
        val btnCancel = findViewById<Button>(R.id.btn_cancel_auth)

        btnCancel.setOnClickListener {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }

        btnConfirm.setOnClickListener {
            tryBiometricOrOpenApp()
        }

        val snapshot = AutofillSecureStore.loadSnapshot(this)
        if (isManualPicker && snapshot.isSessionUnlocked) {
            showManualEntryPicker(snapshot.entries)
            return
        }

        tryBiometricOrOpenApp()
    }

    @Suppress("DEPRECATION")
    private fun getAutofillIdExtra(key: String): AutofillId? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(key, AutofillId::class.java)
        } else {
            intent.getParcelableExtra(key)
        }
    }

    private fun getSupportedAuthenticators(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        }
    }

    private fun tryBiometricOrOpenApp() {
        try {
            val biometricManager = BiometricManager.from(this)
            val authenticators = getSupportedAuthenticators()
            val canAuthenticate = biometricManager.canAuthenticate(authenticators)

            if (canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS) {
                errorText.visibility = View.GONE
                val isReprompt = pendingRepromptEntry != null
                val promptBuilder = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(if (isReprompt) "Hassas Kayıt Doğrulaması" else "Fuin Kasasını Doğrula")
                    .setSubtitle(
                        if (isReprompt) "Bu kayıt ek kimlik doğrulaması gerektiriyor"
                        else "Şifreyi doldurmak için kimliğinizi doğrulayın"
                    )
                    .setAllowedAuthenticators(authenticators)

                val pkg = targetPackageName?.trim().orEmpty()
                if (pkg.isNotEmpty() && !AutofillStructureParser.isBrowserPackage(pkg)) {
                    promptBuilder.setDescription("Hedef uygulama: $pkg")
                }

                val promptInfo = promptBuilder.build()

                val biometricPrompt = BiometricPrompt(
                    this,
                    executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            super.onAuthenticationSucceeded(result)
                            handleAuthSuccess()
                        }

                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            super.onAuthenticationError(errorCode, errString)
                            errorText.text = errString
                            errorText.visibility = View.VISIBLE
                            btnConfirm.visibility = View.VISIBLE
                        }
                    }
                )

                biometricPrompt.authenticate(promptInfo)
            } else {
                errorText.text = "Cihaz ekran kilidi veya biyometrik doğrulama bulunamadı. Kasayı açmak için Fuin uygulamasını açın."
                errorText.visibility = View.VISIBLE
                btnConfirm.visibility = View.VISIBLE
                btnConfirm.text = "Fuin'i Aç"
                btnConfirm.setOnClickListener {
                    packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
                    setResult(Activity.RESULT_CANCELED)
                    finish()
                }
            }
        } catch (_: Exception) {
            errorText.text = "Doğrulama başlatılamadı. Lütfen tekrar deneyin."
            errorText.visibility = View.VISIBLE
            btnConfirm.visibility = View.VISIBLE
        }
    }

    private fun handleAuthSuccess() {
        AutofillSecureStore.extendSession(this)

        // Complete pending reprompt selection from manual picker if applicable
        val repromptTarget = pendingRepromptEntry
        if (repromptTarget != null) {
            pendingRepromptEntry = null
            completeFillWithEntry(repromptTarget)
            return
        }

        val entries = AutofillSecureStore.getAllEntries(this)
        if (isManualPicker) {
            showManualEntryPicker(entries)
            return
        }

        val matchedEntry = entries.firstOrNull { it.id == targetEntryId }
        if (matchedEntry != null) {
            completeFillWithEntry(matchedEntry)
        } else {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    private fun showManualEntryPicker(entries: List<AutofillVaultEntry>) {
        if (entries.isEmpty()) {
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }

        titleText.text = "Fuin Kasasından Seç"
        subtitleText.text = "Doldurulacak kayda dokunun"
        errorText.visibility = View.GONE
        btnConfirm.visibility = View.GONE
        pickerList.visibility = View.VISIBLE

        val adapter = object : ArrayAdapter<AutofillVaultEntry>(
            this,
            android.R.layout.simple_list_item_2,
            android.R.id.text1,
            entries
        ) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent)
                val item = entries[position]
                val t1 = view.findViewById<TextView>(android.R.id.text1)
                val t2 = view.findViewById<TextView>(android.R.id.text2)
                val label = item.title.ifEmpty { item.domain.ifEmpty { "Kayıt" } }
                t1.text = if (item.reprompt) "$label • Korunuyor" else label
                t1.setTextColor(Color.parseColor("#E8E2D8"))
                t1.textSize = 14f
                t2.text = item.username.ifEmpty { item.domain }
                t2.setTextColor(Color.parseColor("#A69D92"))
                t2.textSize = 12f
                return view
            }
        }

        pickerList.adapter = adapter
        pickerList.setOnItemClickListener { _, _, position, _ ->
            val chosen = entries[position]
            // Enforce per-entry reprompt even when manual picker was opened during an unlocked session!
            if (chosen.reprompt) {
                pendingRepromptEntry = chosen
                pickerList.visibility = View.GONE
                titleText.text = "Hassas Kayıt Doğrulaması"
                subtitleText.text = chosen.title.ifEmpty { chosen.domain }
                tryBiometricOrOpenApp()
            } else {
                completeFillWithEntry(chosen)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun completeFillWithEntry(entry: AutofillVaultEntry) {
        // Verify & pin target native package signing certificate (TOFU); abort if tampered/spoofed
        val certVerified = AutofillSecureStore.recordVerifiedPackageFill(
            context = this,
            packageName = targetPackageName,
            linkEntryId = if (isManualPicker) entry.id else null
        )
        if (!certVerified) {
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item).apply {
                setTextViewText(R.id.autofill_title, entry.title.ifEmpty { entry.domain.ifEmpty { "Fuin" } })
                setTextViewText(R.id.autofill_subtitle, entry.username.ifEmpty { "••••••••" })
            }

            val datasetBuilder = android.service.autofill.Dataset.Builder()
            var hasAnyValue = false

            if (usernameAutofillId != null && entry.username.isNotEmpty()) {
                datasetBuilder.setValue(usernameAutofillId!!, AutofillValue.forText(entry.username), presentation)
                hasAnyValue = true
            }

            if (passwordAutofillId != null && entry.password.isNotEmpty()) {
                datasetBuilder.setValue(passwordAutofillId!!, AutofillValue.forText(entry.password), presentation)
                hasAnyValue = true
            }

            if (totpAutofillId != null) {
                val code = AutofillTotpGenerator.generateCode(entry.totp)
                if (!code.isNullOrEmpty()) {
                    datasetBuilder.setValue(totpAutofillId!!, AutofillValue.forText(code), presentation)
                    hasAnyValue = true
                }
            }

            if (!hasAnyValue && manualFieldAutofillId != null && entry.username.isNotEmpty()) {
                datasetBuilder.setValue(manualFieldAutofillId!!, AutofillValue.forText(entry.username), presentation)
                hasAnyValue = true
            }

            if (hasAnyValue) {
                val replyIntent = Intent().apply {
                    putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, datasetBuilder.build())
                }
                setResult(Activity.RESULT_OK, replyIntent)
                finish()
                return
            }
        }

        setResult(Activity.RESULT_CANCELED)
        finish()
    }
}

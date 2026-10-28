package com.sombooosteam.fuin

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.Button
import android.widget.EditText
import android.widget.RemoteViews
import android.widget.TextView
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.util.concurrent.Executor

class AutofillAuthActivity : AppCompatActivity() {

    private lateinit var executor: Executor
    private var targetEntryId: String? = null
    private var usernameAutofillId: AutofillId? = null
    private var passwordAutofillId: AutofillId? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_autofill_auth)

        executor = ContextCompat.getMainExecutor(this)

        targetEntryId = intent.getStringExtra("EXTRA_ENTRY_ID")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            usernameAutofillId = intent.getParcelableExtra("EXTRA_USERNAME_ID")
            passwordAutofillId = intent.getParcelableExtra("EXTRA_PASSWORD_ID")
        }

        val btnCancel = findViewById<Button>(R.id.btn_cancel_auth)
        val btnConfirm = findViewById<Button>(R.id.btn_confirm_auth)
        val errorText = findViewById<TextView>(R.id.auth_error_text)
        val passwordInput = findViewById<EditText>(R.id.auth_password_input)

        btnCancel.setOnClickListener {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }

        btnConfirm.setOnClickListener {
            val pass = passwordInput.text.toString()
            if (pass.isNotEmpty()) {
                // Unlock session and complete autofill
                onAuthenticationSucceeded()
            } else {
                errorText.text = "Lütfen ana şifrenizi girin."
                errorText.visibility = View.VISIBLE
            }
        }

        // Try Biometric / Device Credential first
        tryBiometricPrompt()
    }

    private fun tryBiometricPrompt() {
        val biometricManager = BiometricManager.from(this)
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val canAuthenticate = biometricManager.canAuthenticate(authenticators)

        if (canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS) {
            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Fuin Kasasını Aç")
                .setSubtitle("Şifreyi doldurmak için kimliğinizi doğrulayın")
                .setAllowedAuthenticators(authenticators)
                .build()

            val biometricPrompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    this@AutofillAuthActivity.onAuthenticationSucceeded()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    // If user cancelled, fall back to dialog password input
                }

                override fun onAuthenticationFailed() {
                    super.onAuthenticationFailed()
                }
            })

            biometricPrompt.authenticate(promptInfo)
        }
    }

    private fun onAuthenticationSucceeded() {
        AutofillSecureStore.extendSession(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val allEntries = AutofillSecureStore.getAllEntries(this)
            val matchedEntry = allEntries.firstOrNull { it.id == targetEntryId } ?: allEntries.firstOrNull()

            if (matchedEntry != null && (usernameAutofillId != null || passwordAutofillId != null)) {
                val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item).apply {
                    setTextViewText(R.id.autofill_title, matchedEntry.title.ifEmpty { matchedEntry.domain })
                    setTextViewText(R.id.autofill_subtitle, matchedEntry.username)
                }

                val datasetBuilder = android.service.autofill.Dataset.Builder()
                if (usernameAutofillId != null && matchedEntry.username.isNotEmpty()) {
                    datasetBuilder.setValue(
                        usernameAutofillId!!,
                        AutofillValue.forText(matchedEntry.username),
                        presentation
                    )
                }
                if (passwordAutofillId != null && matchedEntry.password.isNotEmpty()) {
                    datasetBuilder.setValue(
                        passwordAutofillId!!,
                        AutofillValue.forText(matchedEntry.password),
                        presentation
                    )
                }

                val replyIntent = Intent().apply {
                    putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, datasetBuilder.build())
                }
                setResult(Activity.RESULT_OK, replyIntent)
                finish()
                return
            }
        }

        setResult(Activity.RESULT_OK)
        finish()
    }
}

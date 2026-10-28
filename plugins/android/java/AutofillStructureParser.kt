package com.sombooosteam.fuin

import android.app.assist.AssistStructure
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId

data class ParsedAutofillField(
    val autofillId: AutofillId,
    val isPassword: Boolean,
    val isUsernameOrEmail: Boolean,
    val isTotp: Boolean,
    val isFocused: Boolean,
    val hint: String?,
    val idEntry: String?
)

data class ParsedAutofillStructure(
    val webDomain: String?,
    val packageName: String?,
    val usernameField: ParsedAutofillField?,
    val passwordField: ParsedAutofillField?,
    val totpField: ParsedAutofillField?,
    val focusedField: ParsedAutofillField?,
    val fields: List<ParsedAutofillField>
)

object AutofillStructureParser {

    fun parse(structure: AssistStructure?): ParsedAutofillStructure {
        if (structure == null) {
            return ParsedAutofillStructure(null, null, null, null, null, null, emptyList())
        }

        var detectedDomain: String? = null
        val targetPackage = structure.activityComponent?.packageName
        val parsedFields = mutableListOf<ParsedAutofillField>()

        val windowCount = structure.windowNodeCount
        for (w in 0 until windowCount) {
            val rootNode = structure.getWindowNodeAt(w).rootViewNode
            val (domain, fields) = traverseNode(rootNode)
            if (detectedDomain == null && domain != null) {
                detectedDomain = domain
            }
            parsedFields.addAll(fields)
        }

        var passwordField = parsedFields.firstOrNull { it.isPassword }
        var usernameField = parsedFields.firstOrNull { it.isUsernameOrEmail && !it.isPassword }
        val totpField = parsedFields.firstOrNull { it.isTotp }
        val focusedField = parsedFields.firstOrNull { it.isFocused }

        // Heuristic: If we found a password field, and have another editable field that isn't password, treat it as username
        if (passwordField != null && usernameField == null) {
            usernameField = parsedFields.firstOrNull { it.autofillId != passwordField!!.autofillId && !it.isTotp }
        }

        // If only one editable field was detected and it's focused, assign it
        if (passwordField == null && usernameField == null && focusedField != null) {
            if (focusedField.isPassword) {
                passwordField = focusedField
            } else {
                usernameField = focusedField
            }
        }

        return ParsedAutofillStructure(
            webDomain = detectedDomain,
            packageName = targetPackage,
            usernameField = usernameField,
            passwordField = passwordField,
            totpField = totpField,
            focusedField = focusedField,
            fields = parsedFields
        )
    }

    private fun traverseNode(node: AssistStructure.ViewNode?): Pair<String?, List<ParsedAutofillField>> {
        if (node == null) return Pair(null, emptyList())

        val fields = mutableListOf<ParsedAutofillField>()
        var foundDomain: String? = null

        // 1. Check webDomain on this node (browsers like Chrome, Firefox, Brave populate this)
        val domainOnNode = node.webDomain
        if (!domainOnNode.isNullOrBlank()) {
            foundDomain = normalizeDomain(domainOnNode)
        }

        // 2. Evaluate visibility: skip explicitly GONE or INVISIBLE nodes (do not check width/height as layout may not be completed yet)
        val isVisible = node.visibility == View.VISIBLE || node.visibility == 0
        if (isVisible && node.autofillId != null) {
            val field = evaluateNode(node)
            if (field != null) {
                fields.add(field)
            }
        }

        // 3. Traverse children
        val childCount = node.childCount
        for (i in 0 until childCount) {
            val (childDomain, childFields) = traverseNode(node.getChildAt(i))
            if (foundDomain == null && childDomain != null) {
                foundDomain = childDomain
            }
            fields.addAll(childFields)
        }

        return Pair(foundDomain, fields)
    }

    private fun evaluateNode(node: AssistStructure.ViewNode): ParsedAutofillField? {
        val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
        val inputType = node.inputType
        val hintText = (node.hint ?: "").lowercase()
        val idEntry = (node.idEntry ?: "").lowercase()
        val className = (node.className ?: "").lowercase()
        val isFocused = node.isFocused

        val isPasswordHint = hints.any { it.contains("password") }
        val isPasswordType = (inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT &&
                ((inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) ||
                ((inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_NUMBER &&
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_NUMBER_VARIATION_PASSWORD)

        val isPasswordKeyword = idEntry.contains("password") || idEntry.contains("pass") || idEntry.contains("pwd") ||
                hintText.contains("password") || hintText.contains("şifre") || hintText.contains("parola")

        val isPassword = isPasswordHint || isPasswordType || isPasswordKeyword

        val isUsernameHint = hints.any { it.contains("username") || it.contains("email") || it.contains("user") || it.contains("login") }
        val isEmailType = (inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT &&
                ((inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_PERSON_NAME)

        val isUsernameKeyword = idEntry.contains("username") || idEntry.contains("user") || idEntry.contains("email") ||
                idEntry.contains("login") || idEntry.contains("account") || hintText.contains("kullanıcı") ||
                hintText.contains("eposta") || hintText.contains("e-posta") || hintText.contains("username") ||
                hintText.contains("email") || hintText.contains("hesap")

        val isUsername = !isPassword && (isUsernameHint || isEmailType || isUsernameKeyword)

        val isTotpHint = hints.any { it.contains("otp") || it.contains("2fa") || it.contains("totp") }
        val isTotpKeyword = idEntry.contains("otp") || idEntry.contains("2fa") || idEntry.contains("totp") ||
                hintText.contains("kod") || hintText.contains("verification") || hintText.contains("doğrulama")

        val isTotp = !isPassword && !isUsername && (isTotpHint || isTotpKeyword)

        // If it's an editable text field (e.g. EditText) even without clear hints, don't drop it
        val isEditableText = className.contains("edittext") || inputType != 0 || isFocused

        if (!isPassword && !isUsername && !isTotp && !isEditableText) {
            return null
        }

        return ParsedAutofillField(
            autofillId = node.autofillId!!,
            isPassword = isPassword,
            isUsernameOrEmail = isUsername,
            isTotp = isTotp,
            isFocused = isFocused,
            hint = node.hint,
            idEntry = node.idEntry
        )
    }

    fun normalizeDomain(raw: String): String {
        return raw.trim()
            .lowercase()
            .replace(Regex("^https?://"), "")
            .replace(Regex("^www\\."), "")
            .split("/")[0]
            .split(":")[0]
            .trim()
    }
}

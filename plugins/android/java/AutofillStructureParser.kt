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
    val hint: String?,
    val idEntry: String?
)

data class ParsedAutofillStructure(
    val webDomain: String?,
    val packageName: String?,
    val usernameField: ParsedAutofillField?,
    val passwordField: ParsedAutofillField?,
    val totpField: ParsedAutofillField?,
    val fields: List<ParsedAutofillField>
)

object AutofillStructureParser {

    fun parse(structure: AssistStructure?): ParsedAutofillStructure {
        if (structure == null) {
            return ParsedAutofillStructure(null, null, null, null, null, emptyList())
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

        val passwordField = parsedFields.firstOrNull { it.isPassword }
        val usernameField = parsedFields.firstOrNull { it.isUsernameOrEmail && !it.isPassword }
        val totpField = parsedFields.firstOrNull { it.isTotp }

        return ParsedAutofillStructure(
            webDomain = detectedDomain,
            packageName = targetPackage,
            usernameField = usernameField,
            passwordField = passwordField,
            totpField = totpField,
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

        // 2. Evaluate visibility: skip invisible nodes to prevent hidden trap exfiltration
        val isVisible = node.visibility == View.VISIBLE && node.width > 0 && node.height > 0
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

        val isPasswordHint = hints.any { it.contains("password") }
        val isPasswordType = (inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT &&
                ((inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) ||
                ((inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_NUMBER &&
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_NUMBER_VARIATION_PASSWORD)

        val isPasswordKeyword = idEntry.contains("password") || idEntry.contains("pass") ||
                hintText.contains("password") || hintText.contains("şifre") || hintText.contains("parola")

        val isPassword = isPasswordHint || isPasswordType || isPasswordKeyword

        val isUsernameHint = hints.any { it.contains("username") || it.contains("email") || it.contains("user") }
        val isEmailType = (inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT &&
                ((inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
                 (inputType and InputType.TYPE_MASK_VARIATION) == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS)

        val isUsernameKeyword = idEntry.contains("username") || idEntry.contains("user") || idEntry.contains("email") ||
                idEntry.contains("login") || hintText.contains("kullanıcı") || hintText.contains("eposta") ||
                hintText.contains("e-posta") || hintText.contains("username") || hintText.contains("email")

        val isUsername = !isPassword && (isUsernameHint || isEmailType || isUsernameKeyword)

        val isTotpHint = hints.any { it.contains("otp") || it.contains("2fa") || it.contains("totp") }
        val isTotpKeyword = idEntry.contains("otp") || idEntry.contains("2fa") || idEntry.contains("totp") ||
                hintText.contains("kod") || hintText.contains("verification") || hintText.contains("doğrulama")

        val isTotp = !isPassword && !isUsername && (isTotpHint || isTotpKeyword)

        if (!isPassword && !isUsername && !isTotp) {
            return null
        }

        return ParsedAutofillField(
            autofillId = node.autofillId!!,
            isPassword = isPassword,
            isUsernameOrEmail = isUsername,
            isTotp = isTotp,
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

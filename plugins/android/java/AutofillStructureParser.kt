package com.sombooosteam.fuin

import android.app.assist.AssistStructure
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import androidx.annotation.RequiresApi
import java.util.Locale

@RequiresApi(Build.VERSION_CODES.O)
data class ParsedAutofillField(
    val autofillId: AutofillId,
    val isPassword: Boolean,
    val isUsernameOrEmail: Boolean,
    val isTotp: Boolean,
    val isGenericSingleLine: Boolean,
    val isFocused: Boolean,
    val webDomain: String?,
    val textValue: String?,
    val hint: String?,
    val idEntry: String?
)

@RequiresApi(Build.VERSION_CODES.O)
data class ParsedAutofillStructure(
    val webDomain: String?,
    val packageName: String?,
    val isBlockedPackage: Boolean,
    val usernameField: ParsedAutofillField?,
    val passwordField: ParsedAutofillField?,
    val totpField: ParsedAutofillField?,
    val focusedField: ParsedAutofillField?,
    val anyInputFocused: Boolean,
    val fields: List<ParsedAutofillField>
) {
    val hasAuthFields: Boolean
        get() = passwordField != null || usernameField != null || totpField != null

    /**
     * True when one of the resolved auth fields holds input focus, or when no specific leaf input
     * stole focus yet on a screen with auth fields. Immune to parent WebView/Layout container focus.
     */
    val isFocusOnAuthField: Boolean
        get() {
            val authFocused = (usernameField?.isFocused == true) ||
                (passwordField?.isFocused == true) ||
                (totpField?.isFocused == true)
            return authFocused || (!anyInputFocused && hasAuthFields)
        }
}

data class CapturedAutofillCredentials(
    val username: String,
    val password: String,
    val webDomain: String?,
    val packageName: String?
)

object AutofillStructureParser {

    private val BLOCKED_PACKAGES = setOf(
        "com.sombooosteam.fuin",
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.launcher",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.sec.android.app.launcher",
        "com.miui.home",
        "com.huawei.android.launcher",
        "com.oppo.launcher",
        "net.oneplus.launcher",
        "com.teslacoilsw.launcher",
        "com.google.android.inputmethod.latin",
        "com.touchtype.swiftkey",
        "com.samsung.android.honeyboard",
        "com.sec.android.inputmethod",
        "com.google.android.packageinstaller",
        "com.android.packageinstaller",
        "com.google.android.permissioncontroller",
        "com.android.permissioncontroller"
    )

    private val BROWSER_PACKAGES = setOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.mozilla.firefox",
        "org.mozilla.firefox_beta",
        "org.mozilla.fenix",
        "org.mozilla.focus",
        "com.brave.browser",
        "com.brave.browser_beta",
        "com.brave.browser_nightly",
        "com.microsoft.emmx",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.opera.gx",
        "com.opera.touch",
        "com.sec.android.app.sbrowser",
        "com.sec.android.app.sbrowser.beta",
        "com.duckduckgo.mobile.android",
        "com.vivaldi.browser",
        "com.kiwibrowser.browser",
        "com.yandex.browser",
        "com.mi.globalbrowser",
        "com.android.browser",
        "com.huawei.browser",
        "mark.via.gp",
        "company.thebrowser.arc",
        "net.waterfox.android.release",
        "us.spotco.fennec_dos",
        "io.github.forkmaintainers.iceraven",
        "app.vanadium.browser",
        "org.cromite.cromite",
        "org.bromite.bromite"
    )

    /**
     * Native messaging/dialer apps that do not use username+password logins natively.
     * Inside these apps, autofill is strictly suppressed unless an embedded WebView presents
     * both a real webDomain and an explicit password field.
     */
    private val NATIVE_MESSAGING_PACKAGES = setOf(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.android.contacts"
    )

    private val EXCLUDED_SEARCH_AND_CHAT_TOKENS = setOf(
        // Search & browser bars
        "search", "query", "arama", "ara", "find", "filter", "filtre",
        "omnibox", "urlbar", "addressbar", "locationbar", "searchbox",
        // Messaging, chat, social posts & comments
        "message", "mesaj", "chat", "sohbet", "comment", "yorum",
        "reply", "yanit", "yanıt", "caption", "tweet", "post", "compose",
        "note", "notlar", "subject", "konu", "status", "bio", "hikaye",
        // Non-auth commerce & address fields
        "coupon", "kupon", "promo", "promosyon", "street", "sokak",
        "mahalle", "city", "sehir", "şehir", "postal", "zipcode", "iban", "tutar"
    )

    private val PASSWORD_TOKENS = setOf(
        "password", "passwd", "pwd", "passcode", "parola", "sifre", "şifre",
        "currentpassword", "newpassword"
    )

    private val USERNAME_TOKENS = setOf(
        "username", "userid", "email", "eposta", "identifier",
        "login", "loginid", "signin", "kullanici", "kullanıcı",
        "hesap", "accountname", "memberid", "tckimlik", "musterino", "müşteri"
    )

    private val TOTP_TOKENS = setOf(
        "totp", "otp", "2fa", "mfa", "twofactor", "authenticator",
        "onetimecode", "verificationcode", "dogrulamakodu", "smsotpcode"
    )

    private val NON_TEXT_INPUT_HTML_TYPES = setOf(
        "hidden", "submit", "button", "checkbox", "radio", "file",
        "image", "reset", "range", "color", "date", "datetime-local",
        "month", "week", "time"
    )

    fun isBlockedPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkg = packageName.lowercase(Locale.ROOT).trim()
        return BLOCKED_PACKAGES.contains(pkg)
    }

    fun isBrowserPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        return BROWSER_PACKAGES.contains(packageName.lowercase(Locale.ROOT).trim())
    }

    @RequiresApi(Build.VERSION_CODES.O)
    fun parse(structure: AssistStructure?, includeInvisible: Boolean = false): ParsedAutofillStructure {
        if (structure == null) {
            return ParsedAutofillStructure(null, null, false, null, null, null, null, false, emptyList())
        }

        val targetPackage = structure.activityComponent?.packageName
        if (isBlockedPackage(targetPackage)) {
            return ParsedAutofillStructure(null, targetPackage, true, null, null, null, null, false, emptyList())
        }

        var rootDomain: String? = null
        var anyInputFocused = false
        val parsedFields = mutableListOf<ParsedAutofillField>()

        val windowCount = structure.windowNodeCount
        for (w in 0 until windowCount) {
            val rootNode = structure.getWindowNodeAt(w).rootViewNode
            val result = traverseNode(
                node = rootNode,
                targetPackage = targetPackage,
                inheritedDomain = null,
                inheritedHint = null,
                inheritedIdEntry = null,
                includeInvisible = includeInvisible
            )
            if (rootDomain == null && result.firstDomain != null) {
                rootDomain = result.firstDomain
            }
            if (result.anyInputFocused) {
                anyInputFocused = true
            }
            parsedFields.addAll(result.fields)
        }

        val isBrowser = isBrowserPackage(targetPackage)

        // Cross-origin iframe defense: inside a web browser, drop fields belonging to third-party subframes
        // whose origin does not match the top-level page (`rootDomain`), blocking clickjacked login/TOTP theft.
        val eligibleFields = if (isBrowser && !rootDomain.isNullOrBlank()) {
            parsedFields.filter { field ->
                field.webDomain.isNullOrBlank() || AutofillDomainMatcher.isDomainMatch(field.webDomain, rootDomain!!)
            }
        } else {
            parsedFields
        }

        val passwordFields = eligibleFields.filter { it.isPassword }
        val explicitUsernameFields = eligibleFields.filter { it.isUsernameOrEmail && !it.isPassword }
        val totpFields = eligibleFields.filter { it.isTotp }

        // Prefer focused password field if multiple password fields exist on screen
        val passwordField = passwordFields.firstOrNull { it.isFocused } ?: passwordFields.firstOrNull()
        val totpField = totpFields
            .filter { passwordField == null || it.webDomain == passwordField.webDomain }
            .let { list -> list.firstOrNull { it.isFocused } ?: list.firstOrNull() }

        var usernameField: ParsedAutofillField? = null

        if (passwordField != null) {
            val pwIndex = eligibleFields.indexOf(passwordField)
            val pwDomain = passwordField.webDomain

            // 1. Prefer an explicit username/email field in the same origin right before passwordField
            usernameField = explicitUsernameFields
                .filter { it.webDomain == pwDomain && eligibleFields.indexOf(it) < pwIndex }
                .lastOrNull()
                ?: explicitUsernameFields.firstOrNull { it.isFocused && it.webDomain == pwDomain }
                ?: explicitUsernameFields.firstOrNull { it.webDomain == pwDomain }

            // 2. If no explicit hint exists, pair ONLY a clean single-line input immediately preceding passwordField
            if (usernameField == null && pwIndex > 0) {
                for (idx in (pwIndex - 1) downTo maxOf(0, pwIndex - 2)) {
                    val candidate = eligibleFields[idx]
                    if (!candidate.isPassword && !candidate.isTotp &&
                        candidate.isGenericSingleLine && candidate.webDomain == pwDomain
                    ) {
                        usernameField = candidate
                        break
                    }
                }
            }
        } else {
            // Split-login Step 1 (no password field visible yet):
            // STRICT RULE: ONLY accept fields with explicit username/email/login signals!
            // NEVER promote generic focused EditTexts (search bars, chat inputs, notes).
            usernameField = explicitUsernameFields.firstOrNull { it.isFocused }
                ?: explicitUsernameFields.firstOrNull()
        }

        // Extra guard for native chat/SMS/dialer apps (e.g. WhatsApp):
        // Never treat phone/text inputs as autofillable unless inside an embedded WebView with a password field.
        val pkgLower = targetPackage?.lowercase(Locale.ROOT)?.trim()
        if (pkgLower != null && NATIVE_MESSAGING_PACKAGES.contains(pkgLower)) {
            if (passwordField == null || passwordField.webDomain.isNullOrBlank()) {
                return ParsedAutofillStructure(
                    webDomain = null,
                    packageName = targetPackage,
                    isBlockedPackage = false,
                    usernameField = null,
                    passwordField = null,
                    totpField = null,
                    focusedField = null,
                    anyInputFocused = anyInputFocused,
                    fields = emptyList()
                )
            }
        }

        val focusedField = parsedFields.firstOrNull { it.isFocused }
        val rawEffectiveDomain = passwordField?.webDomain
            ?: usernameField?.webDomain
            ?: totpField?.webDomain
            ?: focusedField?.webDomain
            ?: rootDomain
        val effectiveDomain = AutofillDomainMatcher.resolveTrustedWebDomain(targetPackage, rawEffectiveDomain)

        // Browser omnibox / chrome guard: if inside a web browser with NO webDomain, never autofill browser UI
        if (isBrowserPackage(targetPackage) && effectiveDomain.isNullOrBlank()) {
            return ParsedAutofillStructure(
                webDomain = null,
                packageName = targetPackage,
                isBlockedPackage = false,
                usernameField = null,
                passwordField = null,
                totpField = null,
                focusedField = null,
                anyInputFocused = anyInputFocused,
                fields = emptyList()
            )
        }

        return ParsedAutofillStructure(
            webDomain = effectiveDomain,
            packageName = targetPackage,
            isBlockedPackage = false,
            usernameField = usernameField,
            passwordField = passwordField,
            totpField = totpField,
            focusedField = focusedField,
            anyInputFocused = anyInputFocused,
            fields = parsedFields
        )
    }

    /**
     * Extracts final user-entered username & password across one or more FillContexts during onSaveRequest.
     * Uses includeInvisible=true so fields hidden upon SPA/WebView form submission still yield their AutofillValue.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    fun extractCapturedCredentials(contexts: List<AssistStructure>): CapturedAutofillCredentials {
        var latestUsername = ""
        var latestPassword = ""
        var latestDomain: String? = null
        var latestPackage: String? = null

        for (structure in contexts) {
            val parsed = parse(structure, includeInvisible = true)
            if (parsed.isBlockedPackage) continue
            if (!parsed.webDomain.isNullOrBlank()) latestDomain = parsed.webDomain
            if (!parsed.packageName.isNullOrBlank()) latestPackage = parsed.packageName

            val uVal = parsed.usernameField?.textValue?.trim() ?: ""
            val pVal = parsed.passwordField?.textValue ?: ""

            if (uVal.isNotEmpty()) {
                latestUsername = uVal
            }
            if (pVal.isNotEmpty()) {
                latestPassword = pVal
            }
        }

        return CapturedAutofillCredentials(
            username = latestUsername,
            password = latestPassword,
            webDomain = latestDomain,
            packageName = latestPackage
        )
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private data class TraversalResult(
        val firstDomain: String?,
        val anyInputFocused: Boolean,
        val fields: List<ParsedAutofillField>
    )

    @RequiresApi(Build.VERSION_CODES.O)
    private fun traverseNode(
        node: AssistStructure.ViewNode?,
        targetPackage: String?,
        inheritedDomain: String?,
        inheritedHint: String?,
        inheritedIdEntry: String?,
        includeInvisible: Boolean
    ): TraversalResult {
        if (node == null) return TraversalResult(null, false, emptyList())

        // During onFillRequest, skip invisible/gone subtrees; during onSaveRequest, allow reading just-hidden form nodes
        if (!includeInvisible && node.visibility != View.VISIBLE) {
            return TraversalResult(null, false, emptyList())
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (node.importantForAutofill == View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS) {
                return TraversalResult(null, false, emptyList())
            }
        }

        val currentDomain = if (!node.webDomain.isNullOrBlank()) {
            normalizeDomain(node.webDomain!!)
        } else {
            inheritedDomain
        }

        val isInput = node.autofillId != null && isActualInputNode(node)
        var anyInputFocused = isInput && node.isFocused
        val fields = mutableListOf<ParsedAutofillField>()

        val nodeHint = node.hint?.takeIf { it.isNotBlank() }
        val nodeIdEntry = node.idEntry?.takeIf { it.isNotBlank() }

        // Propagate wrapper hints/IDs (e.g. Material TextInputLayout -> child TextInputEditText)
        val effectiveHint = nodeHint ?: inheritedHint
        val effectiveIdEntry = nodeIdEntry ?: inheritedIdEntry

        if (isInput) {
            val evaluated = evaluateInputNode(
                node = node,
                targetPackage = targetPackage,
                webDomain = currentDomain,
                effectiveHint = effectiveHint,
                effectiveIdEntry = effectiveIdEntry
            )
            if (evaluated != null) {
                fields.add(evaluated)
            }
        }

        // Only pass wrapper hint/id down when this node is a container/wrapper (not a sibling input)
        val passDownHint = if (!isInput && nodeHint != null) nodeHint else inheritedHint
        val passDownId = if (!isInput && nodeIdEntry != null) nodeIdEntry else inheritedIdEntry

        var firstFoundDomain = currentDomain
        val childCount = node.childCount
        for (i in 0 until childCount) {
            val childRes = traverseNode(
                node = node.getChildAt(i),
                targetPackage = targetPackage,
                inheritedDomain = currentDomain,
                inheritedHint = passDownHint,
                inheritedIdEntry = passDownId,
                includeInvisible = includeInvisible
            )
            if (firstFoundDomain == null && childRes.firstDomain != null) {
                firstFoundDomain = childRes.firstDomain
            }
            if (childRes.anyInputFocused) {
                anyInputFocused = true
            }
            fields.addAll(childRes.fields)
        }

        return TraversalResult(firstFoundDomain, anyInputFocused, fields)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun isActualInputNode(node: AssistStructure.ViewNode): Boolean {
        val className = (node.className ?: "").lowercase(Locale.ROOT)
        val htmlTag = node.htmlInfo?.tag?.lowercase(Locale.ROOT) ?: ""

        if (htmlTag.isNotEmpty()) {
            if (htmlTag == "input") {
                val htmlType = getHtmlAttr(node, "type")
                return !NON_TEXT_INPUT_HTML_TYPES.contains(htmlType)
            }
            if (htmlTag == "textarea") {
                return true // Handled & rejected in evaluateInputNode as multi-line
            }
            if (htmlTag in setOf("form", "div", "span", "p", "label", "button", "a", "select", "section", "main", "header", "footer")) {
                return false
            }
        }

        // Reject virtual-tree host views (WebView, Chromium ContentView, GeckoView, FlutterView, ComposeView)
        // which mirror the active child's IME inputType on the container view itself
        if (htmlTag.isEmpty() && (
            className.contains("webview") ||
                className.contains("contentview") ||
                className.contains("geckoview") ||
                className.contains("flutterview") ||
                className.contains("composeview")
            )
        ) {
            return false
        }

        // Reject layout containers & non-text widgets (e.g. TextInputLayout, LinearLayout, Button)
        if (className.endsWith("layout") ||
            className.endsWith("viewgroup") ||
            className.endsWith("recyclerview") ||
            className.endsWith("scrollview") ||
            className.endsWith("cardview") ||
            className.endsWith("toolbar") ||
            className.endsWith(".button") ||
            className.endsWith("materialbutton") ||
            className.endsWith("imagebutton") ||
            className.endsWith("imageview") ||
            className.endsWith("checkbox") ||
            className.endsWith("radiobutton") ||
            className.endsWith("switch") ||
            className.endsWith("switchcompat") ||
            className.endsWith("spinner")
        ) {
            return false
        }

        // Static TextView (not EditText / AutoCompleteTextView) with no inputType is a label, never an input
        if (className.contains("textview") &&
            !className.contains("edittext") &&
            !className.contains("autocompletetextview")
        ) {
            return node.inputType != InputType.TYPE_NULL && node.autofillType == View.AUTOFILL_TYPE_TEXT
        }

        if (className.contains("edittext") || className.contains("autocompletetextview")) {
            return true
        }

        if (node.inputType != InputType.TYPE_NULL) {
            return true
        }

        // Jetpack Compose / Flutter / WebView virtual text nodes
        if (node.autofillType == View.AUTOFILL_TYPE_TEXT &&
            (node.isFocusable || node.isFocused || !node.autofillHints.isNullOrEmpty())
        ) {
            return true
        }

        return false
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun evaluateInputNode(
        node: AssistStructure.ViewNode,
        targetPackage: String?,
        webDomain: String?,
        effectiveHint: String?,
        effectiveIdEntry: String?
    ): ParsedAutofillField? {
        val hints = node.autofillHints?.map { it.lowercase(Locale.ROOT).trim() } ?: emptyList()
        val inputType = node.inputType
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val inputVariation = inputType and InputType.TYPE_MASK_VARIATION

        val htmlTag = node.htmlInfo?.tag?.lowercase(Locale.ROOT) ?: ""
        val htmlType = getHtmlAttr(node, "type")
        val htmlName = getHtmlAttr(node, "name")
        val htmlId = getHtmlAttr(node, "id")
        val htmlAutocomplete = getHtmlAttr(node, "autocomplete")
        val htmlRole = getHtmlAttr(node, "role")
        val htmlPlaceholder = getHtmlAttr(node, "placeholder")

        val tokens = mutableSetOf<String>()
        tokens.addAll(tokenizeIdentifier(effectiveIdEntry))
        tokens.addAll(tokenizeIdentifier(effectiveHint))
        tokens.addAll(tokenizeIdentifier(htmlName))
        tokens.addAll(tokenizeIdentifier(htmlId))
        tokens.addAll(tokenizeIdentifier(htmlPlaceholder))
        tokens.addAll(tokenizeIdentifier(node.contentDescription?.toString()))
        hints.forEach { tokens.addAll(tokenizeIdentifier(it)) }
        if (htmlAutocomplete.isNotEmpty()) {
            tokens.addAll(tokenizeIdentifier(htmlAutocomplete))
        }

        // 1. Check Explicit Password Signals First
        val isPasswordHint = hints.any { it.contains("password") } ||
            htmlAutocomplete.contains("password") ||
            htmlType == "password"

        val isPasswordInputType = (inputClass == InputType.TYPE_CLASS_TEXT && (
            inputVariation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                inputVariation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                inputVariation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            )) || (inputClass == InputType.TYPE_CLASS_NUMBER &&
            inputVariation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)

        val hasExcludedSearchOrChatSignal = isExcludedNonAuthInput(
            targetPackage = targetPackage,
            webDomain = webDomain,
            inputType = inputType,
            inputClass = inputClass,
            inputVariation = inputVariation,
            htmlTag = htmlTag,
            htmlType = htmlType,
            htmlRole = htmlRole,
            htmlAutocomplete = htmlAutocomplete,
            tokens = tokens
        )

        val isPasswordKeyword = !hasExcludedSearchOrChatSignal && tokens.any { PASSWORD_TOKENS.contains(it) }
        val isPassword = isPasswordHint || isPasswordInputType || isPasswordKeyword

        // 2. Drop Search Bars, Chat Boxes, Multi-line Inputs, Comments & Browser Omniboxes
        if (!isPassword && hasExcludedSearchOrChatSignal) {
            return null
        }

        // Respect explicit importantForAutofill="no" when there are no positive auth hints/types
        val explicitlyMarkedNoAutofill = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            node.importantForAutofill == View.IMPORTANT_FOR_AUTOFILL_NO

        // 3. Check TOTP / 2FA Signals
        val isTotpHint = hints.any { it.contains("otp") || it.contains("2fa") || it.contains("totp") || it.contains("one-time-code") } ||
            htmlAutocomplete == "one-time-code"
        val isTotpKeyword = tokens.any { TOTP_TOKENS.contains(it) } ||
            ((tokens.contains("dogrulama") || tokens.contains("doğrulama") || tokens.contains("verification")) &&
                (tokens.contains("kod") || tokens.contains("kodu") || tokens.contains("code")))
        val isTotp = !isPassword && (isTotpHint || isTotpKeyword)

        // 4. Check Explicit Username / Email Signals
        val isUsernameHint = hints.any {
            it == View.AUTOFILL_HINT_USERNAME.lowercase(Locale.ROOT) ||
                it == View.AUTOFILL_HINT_EMAIL_ADDRESS.lowercase(Locale.ROOT) ||
                it.contains("username") ||
                it.contains("email") ||
                it == "login"
        } || htmlType == "email" || htmlAutocomplete in setOf("username", "email")

        val isEmailInputType = inputClass == InputType.TYPE_CLASS_TEXT && (
            inputVariation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
                inputVariation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
            )

        val isUsernameKeyword = tokens.any { USERNAME_TOKENS.contains(it) }
        val isUsername = !isPassword && !isTotp && (isUsernameHint || isEmailInputType || isUsernameKeyword)

        // Native sentence-capitalized prose guard (applied ONLY to unlabeled native inputs, never HTML <input> or explicit auth fields)
        val hasNativeSentenceProseFlag = htmlTag.isEmpty() &&
            (inputType and InputType.TYPE_TEXT_FLAG_CAP_SENTENCES) != 0
        if (!isPassword && !isUsername && !isTotp && (explicitlyMarkedNoAutofill || hasNativeSentenceProseFlag)) {
            return null
        }

        val isGenericSingleLine = !isPassword && !isUsername && !isTotp &&
            !hasNativeSentenceProseFlag &&
            inputClass != InputType.TYPE_CLASS_NUMBER &&
            inputClass != InputType.TYPE_CLASS_DATETIME

        val afText = node.autofillValue?.let { if (it.isText) it.textValue?.toString() else null }
        val rawNodeText = node.text?.toString()
        val cleanNodeText = if (rawNodeText != null && isMaskedBulletsOnly(rawNodeText)) null else rawNodeText
        val resolvedText = if (!afText.isNullOrEmpty() && !(isPassword && isMaskedBulletsOnly(afText))) {
            afText
        } else {
            cleanNodeText
        }

        return ParsedAutofillField(
            autofillId = node.autofillId!!,
            isPassword = isPassword,
            isUsernameOrEmail = isUsername,
            isTotp = isTotp,
            isGenericSingleLine = isGenericSingleLine,
            isFocused = node.isFocused,
            webDomain = webDomain,
            textValue = resolvedText,
            hint = effectiveHint,
            idEntry = effectiveIdEntry
        )
    }

    private fun isMaskedBulletsOnly(value: String): Boolean {
        if (value.isEmpty()) return false
        return value.all { ch -> ch == '•' || ch == '●' || ch == '◦' || ch == '▪' }
    }

    private fun isExcludedNonAuthInput(
        targetPackage: String?,
        webDomain: String?,
        inputType: Int,
        inputClass: Int,
        inputVariation: Int,
        htmlTag: String,
        htmlType: String,
        htmlRole: String,
        htmlAutocomplete: String,
        tokens: Set<String>
    ): Boolean {
        // Multi-line text boxes & chat messages (note: Chromium maps standard <input type="text"> to CAP_SENTENCES by default,
        // so CAP_SENTENCES is handled separately for unlabeled native views only!)
        if (htmlTag == "textarea") return true
        if ((inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0) return true
        if ((inputType and InputType.TYPE_TEXT_FLAG_IME_MULTI_LINE) != 0) return true

        if (inputClass == InputType.TYPE_CLASS_TEXT) {
            if (inputVariation == InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE ||
                inputVariation == InputType.TYPE_TEXT_VARIATION_LONG_MESSAGE ||
                inputVariation == InputType.TYPE_TEXT_VARIATION_FILTER
            ) {
                return true
            }
            if (inputVariation == InputType.TYPE_TEXT_VARIATION_URI) {
                if (isBrowserPackage(targetPackage) || webDomain.isNullOrBlank() ||
                    tokens.any { it in setOf("url", "uri", "omnibox", "address", "location", "bar", "search") }
                ) {
                    return true
                }
            }
        }

        // HTML search / non-auth inputs
        if (htmlType in setOf("search", "url") || htmlRole in setOf("search", "searchbox")) {
            return true
        }
        if (htmlAutocomplete == "off" && tokens.any { EXCLUDED_SEARCH_AND_CHAT_TOKENS.contains(it) }) {
            return true
        }

        // Browser UI outside any webpage (e.g. Chrome omnibox / find-in-page)
        if (isBrowserPackage(targetPackage) && webDomain.isNullOrBlank()) {
            return true
        }

        // Token match against search, chat, comment, compose, coupon, address keywords
        if (tokens.any { EXCLUDED_SEARCH_AND_CHAT_TOKENS.contains(it) }) {
            return true
        }

        return false
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun getHtmlAttr(node: AssistStructure.ViewNode, attrName: String): String {
        val attrs = node.htmlInfo?.attributes ?: return ""
        for (pair in attrs) {
            if (pair?.first?.equals(attrName, ignoreCase = true) == true) {
                return (pair.second ?: "").lowercase(Locale.ROOT).trim()
            }
        }
        return ""
    }

    /**
     * Splits camelCase and non-alphanumeric delimiters so "searchEditText" -> ["search", "edit", "text"]
     * and "Telefon numarası" -> ["telefon", "numarası"] (avoiding substring false positives like "ara" in "numarası").
     */
    fun tokenizeIdentifier(raw: String?): Set<String> {
        if (raw.isNullOrBlank()) return emptySet()
        val decamel = raw
            .replace(Regex("([a-zçğıöşü])([A-ZÇĞİÖŞÜ])"), "$1 $2")
            .replace('İ', 'i')
        val rawParts = decamel.lowercase(Locale.ROOT)
            .replace("\u0307", "")
            .split(Regex("[^a-z0-9çğıöşü]+"))
            .filter { it.isNotEmpty() }

        val result = mutableSetOf<String>()
        rawParts.filterTo(result) { it.length >= 2 }

        // Also include compound normalized forms for common two-part tokens (e.g., e-posta -> eposta, e-mail -> email, url_bar -> urlbar)
        for (i in 0 until rawParts.size - 1) {
            val joined = rawParts[i] + rawParts[i + 1]
            if (joined in PASSWORD_TOKENS || joined in USERNAME_TOKENS ||
                joined in TOTP_TOKENS || joined in EXCLUDED_SEARCH_AND_CHAT_TOKENS
            ) {
                result.add(joined)
            }
        }
        return result
    }

    fun normalizeDomain(raw: String): String = AutofillDomainMatcher.normalizeDomain(raw)
}

package com.sombooosteam.fuin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Non-exported BroadcastReceiver invoked by Android AlarmManager to clear expired
 * clipboard secrets even when Fuin Mobile is backgrounded or process-killed.
 */
class ClipboardClearReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        if (intent.action != FuinClipboardHelper.ACTION_CLEAR_CLIPBOARD) return

        val token = intent.getStringExtra(FuinClipboardHelper.EXTRA_CLEAR_TOKEN)
        if (token.isNullOrEmpty()) return

        FuinClipboardHelper.clearIfTokenMatches(context.applicationContext, token)
    }
}

package com.otprelay.android.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.otprelay.android.AppEvents
import com.otprelay.android.core.OtpCrypto
import com.otprelay.android.core.OtpParser
import com.otprelay.android.protocol.OtpPayload
import com.otprelay.android.storage.SecureStore
import com.otprelay.android.storage.SmsDeliveryLog
import com.otprelay.android.storage.SmsLogAggregator
import com.otprelay.android.storage.SmsLogEntry
import com.otprelay.android.storage.SmsLogSanitizer
import com.otprelay.android.storage.SmsLogStatus
import com.otprelay.android.work.UploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                handle(context.applicationContext, intent)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun handle(context: Context, intent: Intent) {
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isEmpty()) return
        Log.i(LOG_TAG, "SMS broadcast received; parts=${messages.size}")
        val sender = messages.firstOrNull()?.displayOriginatingAddress
        val body = messages.joinToString(separator = "") { it.displayMessageBody.orEmpty() }
        // The PDU timestamp comes from the SMS service center and may lag behind
        // actual delivery by several minutes. TTL must start when Android receives
        // the broadcast, otherwise a newly arrived OTP can already look expired.
        val receivedAtMillis = System.currentTimeMillis()
        val store = SecureStore(context)
        val pairings = store.getPairings()
        if (pairings.isEmpty()) return
        val parsed = OtpParser.parse(sender, body)
        if (parsed == null) {
            if (
                OtpParser.looksLikeOtp(body) &&
                SmsLogSanitizer.containsOtpLikeNumber(body) &&
                !store.isDuplicate(SmsLogSanitizer.source(sender), body, receivedAtMillis)
            ) {
                store.saveSmsLog(
                    SmsLogEntry(
                        source = SmsLogSanitizer.source(sender),
                        maskedSummary = SmsLogSanitizer.unrecognizedSummary(),
                        receivedAtMillis = receivedAtMillis,
                        status = SmsLogStatus.UNRECOGNIZED,
                        detail = "未上传。短信中存在无法可靠判断的候选验证码。",
                    ),
                )
                AppEvents.notifySmsLogsChanged()
                Log.i(LOG_TAG, "OTP-like SMS was not reliably recognized")
            }
            return
        }
        if (store.isDuplicate(parsed.source, parsed.code, receivedAtMillis)) {
            Log.i(LOG_TAG, "Duplicate OTP ignored")
            return
        }

        val payload = OtpPayload(
            code = parsed.code,
            source = parsed.source,
            purpose = parsed.purpose,
            receivedAt = Instant.ofEpochMilli(receivedAtMillis).toString(),
        )
        val logId = UUID.randomUUID().toString()
        store.saveSmsLog(
            SmsLogAggregator.create(
                id = logId,
                source = parsed.source,
                maskedSummary = SmsLogSanitizer.maskedSummary(body, parsed.code),
                receivedAtMillis = receivedAtMillis,
                targets = pairings.map { pairing ->
                    SmsDeliveryLog(
                        pairingId = pairing.pairingId,
                        computerName = pairing.computerName,
                    )
                },
            ),
        )
        AppEvents.notifySmsLogsChanged()
        pairings.forEach { pairing ->
            val envelope = OtpCrypto.encrypt(payload, pairing)
            val input = Data.Builder()
                .putString(
                    UploadWorker.KEY_ENVELOPE,
                    Json.encodeToString(envelope),
                )
                .putString(UploadWorker.KEY_LOG_ID, logId)
                .putString(UploadWorker.KEY_COMPUTER_NAME, pairing.computerName)
                .build()
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(input)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    10,
                    TimeUnit.SECONDS,
                )
                .addTag("otp-upload-${envelope.messageId}")
                .addTag(UploadWorker.pairingTag(pairing.pairingId))
                .build()
            WorkManager.getInstance(context).enqueue(request)
            Log.i(
                LOG_TAG,
                "Encrypted OTP upload queued; pairingId=${pairing.pairingId}; " +
                    "messageId=${envelope.messageId}",
            )
        }
    }

    private companion object {
        const val LOG_TAG = "OtpRelaySms"
    }
}

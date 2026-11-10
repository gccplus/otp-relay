package com.otprelay.android.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.otprelay.android.AppEvents
import com.otprelay.android.network.RelayApi
import com.otprelay.android.network.RelayApiException
import com.otprelay.android.protocol.MessageEnvelope
import com.otprelay.android.storage.SecureStore
import com.otprelay.android.storage.SmsDeliveryStatus
import kotlinx.serialization.json.Json
import java.time.Instant

class UploadWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun doWork(): Result {
        val serialized = inputData.getString(KEY_ENVELOPE) ?: return Result.failure()
        val envelope = runCatching {
            json.decodeFromString<MessageEnvelope>(serialized)
        }.getOrElse { return Result.failure() }
        val store = SecureStore(applicationContext)
        val logId = inputData.getString(KEY_LOG_ID) ?: envelope.messageId
        val queuedComputerName = inputData.getString(KEY_COMPUTER_NAME) ?: "电脑端"
        val pairing = store.getPairing(envelope.pairingId)
        if (pairing == null) {
            store.updateSmsDelivery(
                logId = logId,
                pairingId = envelope.pairingId,
                computerName = queuedComputerName,
                status = SmsDeliveryStatus.FAILED,
                detail = "已解除配对，取消发送",
            )
            AppEvents.notifySmsLogsChanged()
            return Result.success()
        }
        if (!Instant.now().isBefore(Instant.parse(envelope.expiresAt))) {
            store.updateSmsDelivery(
                logId = logId,
                pairingId = envelope.pairingId,
                computerName = pairing.computerName,
                status = SmsDeliveryStatus.FAILED,
                detail = "验证码已过期，停止重试",
            )
            AppEvents.notifySmsLogsChanged()
            return Result.success()
        }
        return try {
            RelayApi().upload(
                pairing.serviceBaseUrl,
                pairing.credential,
                envelope,
            )
            store.saveLastResult("最近一次已发送至 ${pairing.computerName}")
            store.updateSmsDelivery(
                logId = logId,
                pairingId = pairing.pairingId,
                computerName = pairing.computerName,
                status = SmsDeliveryStatus.SENT,
                detail = "密文已发送",
            )
            AppEvents.notifySmsLogsChanged()
            Result.success()
        } catch (error: RelayApiException) {
            when {
                error.statusCode == 401 || error.statusCode == 403 -> {
                    if (error.errorCode == "PAIRING_REVOKED") {
                        store.apply {
                            saveLastResult("${pairing.computerName} 已解除配对")
                            updateSmsDelivery(
                                logId = logId,
                                pairingId = pairing.pairingId,
                                computerName = pairing.computerName,
                                status = SmsDeliveryStatus.FAILED,
                                detail = "已解除配对，停止发送",
                            )
                            removePairing(pairing.pairingId)
                        }
                    } else {
                        store.updateSmsDelivery(
                            logId = logId,
                            pairingId = pairing.pairingId,
                            computerName = pairing.computerName,
                            status = SmsDeliveryStatus.SENDING,
                            detail = "认证失败（${error.errorCode}），正在重试",
                        )
                    }
                    AppEvents.notifySmsLogsChanged()
                    if (error.errorCode == "PAIRING_REVOKED") {
                        Result.success()
                    } else {
                        Result.retry()
                    }
                }
                error.statusCode in 400..499 -> {
                    store.saveLastResult(
                        "密文发送失败：${error.errorCode}",
                    )
                    store.updateSmsDelivery(
                        logId = logId,
                        pairingId = pairing.pairingId,
                        computerName = pairing.computerName,
                        status = SmsDeliveryStatus.FAILED,
                        detail = "发送失败：${error.errorCode}",
                    )
                    AppEvents.notifySmsLogsChanged()
                    Result.failure()
                }
                else -> Result.retry()
            }
        } catch (_: Exception) {
            store.updateSmsDelivery(
                logId = logId,
                pairingId = pairing.pairingId,
                computerName = pairing.computerName,
                status = SmsDeliveryStatus.SENDING,
                detail = "网络异常，正在自动重试",
            )
            AppEvents.notifySmsLogsChanged()
            Result.retry()
        }
    }

    companion object {
        const val KEY_ENVELOPE = "encrypted_envelope"
        const val KEY_LOG_ID = "sms_log_id"
        const val KEY_COMPUTER_NAME = "computer_name"

        fun pairingTag(pairingId: String): String = "otp-pairing-$pairingId"
    }
}

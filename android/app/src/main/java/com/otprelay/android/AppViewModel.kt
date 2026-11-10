package com.otprelay.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.otprelay.android.core.OtpCrypto
import com.otprelay.android.pairing.PairingRepository
import com.otprelay.android.protocol.OtpPayload
import com.otprelay.android.protocol.PairingConfig
import com.otprelay.android.storage.SecureStore
import com.otprelay.android.storage.SmsDeliveryLog
import com.otprelay.android.storage.SmsLogAggregator
import com.otprelay.android.storage.SmsLogEntry
import com.otprelay.android.storage.SmsLogSanitizer
import com.otprelay.android.work.UploadWorker
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

data class AppUiState(
    val paired: Boolean = false,
    val pairedComputers: List<PairingConfig> = emptyList(),
    val busy: Boolean = false,
    val status: String = "尚未配对",
    val lastResult: String = "暂无同步记录",
    val smsLogs: List<SmsLogEntry> = emptyList(),
    val testSending: Boolean = false,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SecureStore(application)
    private val pairingRepository = PairingRepository(store)
    private val initialPairings = store.getPairings()
    private val mutableState = MutableStateFlow(
        AppUiState(
            paired = initialPairings.isNotEmpty(),
            pairedComputers = initialPairings,
            status = pairingStatus(initialPairings),
            lastResult = store.lastResult(),
            smsLogs = store.smsLogs(),
        ),
    )
    val state = mutableState.asStateFlow()

    init {
        viewModelScope.launch {
            AppEvents.smsLogsChanged.collectLatest {
                refresh()
            }
        }
    }

    fun refresh() {
        val pairings = store.getPairings()
        val paired = pairings.isNotEmpty()
        mutableState.value = mutableState.value.copy(
            paired = paired,
            pairedComputers = pairings,
            busy = if (paired) mutableState.value.busy else false,
            status = pairingStatus(pairings),
            lastResult = store.lastResult(),
            smsLogs = store.smsLogs(),
        )
    }

    fun acceptQr(rawQr: String) {
        if (mutableState.value.busy) return
        mutableState.value = mutableState.value.copy(
            busy = true,
            status = "等待电脑端确认配对…",
        )
        viewModelScope.launch {
            runCatching { pairingRepository.claimAndAwaitApproval(rawQr) }
                .onSuccess {
                    val pairings = store.getPairings()
                    mutableState.value = mutableState.value.copy(
                        paired = pairings.isNotEmpty(),
                        pairedComputers = pairings,
                        busy = false,
                        status = pairingStatus(pairings),
                        lastResult = "配对成功",
                        smsLogs = store.smsLogs(),
                    )
                }
                .onFailure { error ->
                    mutableState.value = mutableState.value.copy(
                        busy = false,
                        status = error.message ?: "配对失败，请重试",
                    )
                }
        }
    }

    fun sendTestMessage() {
        val pairings = store.getPairings()
        if (pairings.isEmpty()) return
        if (mutableState.value.testSending) return
        val receivedAtMillis = System.currentTimeMillis()
        val payload = OtpPayload(
            code = "246810",
            source = "测试消息",
            purpose = "联调验证",
            receivedAt = Instant.ofEpochMilli(receivedAtMillis).toString(),
        )
        val logId = UUID.randomUUID().toString()
        store.saveSmsLog(
            SmsLogAggregator.create(
                id = logId,
                source = "测试消息",
                maskedSummary = "测试验证码 ${SmsLogSanitizer.maskCode("246810")}",
                receivedAtMillis = receivedAtMillis,
                targets = pairings.map { pairing ->
                    SmsDeliveryLog(
                        pairingId = pairing.pairingId,
                        computerName = pairing.computerName,
                    )
                },
            ),
        )
        val workManager = WorkManager.getInstance(getApplication())
        pairings.forEach { pairing ->
            val envelope = OtpCrypto.encrypt(payload, pairing)
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(
                    Data.Builder()
                        .putString(
                            UploadWorker.KEY_ENVELOPE,
                            Json.encodeToString(envelope),
                        )
                        .putString(UploadWorker.KEY_LOG_ID, logId)
                        .putString(UploadWorker.KEY_COMPUTER_NAME, pairing.computerName)
                        .build(),
                )
                .addTag(UploadWorker.pairingTag(pairing.pairingId))
                .build()
            workManager.enqueue(request)
        }
        mutableState.value = mutableState.value.copy(
            lastResult = "测试消息已进入 ${pairings.size} 台电脑的发送队列",
            smsLogs = store.smsLogs(),
            testSending = true,
        )
        AppEvents.notifySmsLogsChanged()
        viewModelScope.launch {
            delay(850)
            mutableState.value = mutableState.value.copy(testSending = false)
        }
    }

    fun clearSmsLogs() {
        store.clearSmsLogs()
        mutableState.value = mutableState.value.copy(smsLogs = emptyList())
    }

    fun renamePairing(pairingId: String, computerName: String): Result<Unit> =
        runCatching {
            store.renamePairing(pairingId, computerName)
            refresh()
        }

    fun unpair(pairingId: String, onResult: (Boolean) -> Unit = {}) {
        mutableState.value = mutableState.value.copy(busy = true)
        viewModelScope.launch {
            runCatching { pairingRepository.revoke(pairingId) }
                .onSuccess {
                    WorkManager.getInstance(getApplication())
                        .cancelAllWorkByTag(UploadWorker.pairingTag(pairingId))
                    val pairings = store.getPairings()
                    mutableState.value = mutableState.value.copy(
                        paired = pairings.isNotEmpty(),
                        pairedComputers = pairings,
                        busy = false,
                        status = pairingStatus(pairings),
                        lastResult = store.lastResult(),
                        smsLogs = store.smsLogs(),
                    )
                    onResult(true)
                }
                .onFailure {
                    mutableState.value = mutableState.value.copy(
                        busy = false,
                        status = "解除配对失败，请检查网络后重试",
                    )
                    onResult(false)
                }
        }
    }

    private companion object {
        fun pairingStatus(pairings: List<PairingConfig>): String =
            if (pairings.isEmpty()) {
                "尚未配对"
            } else {
                "已连接 ${pairings.size} 台电脑，正在监听新短信"
            }
    }
}

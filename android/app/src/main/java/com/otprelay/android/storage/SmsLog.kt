package com.otprelay.android.storage

import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
enum class SmsLogStatus {
    SENDING,
    SENT,
    PARTIAL,
    UNRECOGNIZED,
    FAILED,
}

@Serializable
enum class SmsDeliveryStatus {
    SENDING,
    SENT,
    FAILED,
}

@Serializable
data class SmsDeliveryLog(
    val pairingId: String,
    val computerName: String,
    val status: SmsDeliveryStatus = SmsDeliveryStatus.SENDING,
    val detail: String = "等待发送",
)

@Serializable
data class SmsLogEntry(
    val id: String = UUID.randomUUID().toString(),
    val source: String,
    val maskedSummary: String,
    val receivedAtMillis: Long,
    val status: SmsLogStatus,
    val detail: String,
    val deliveries: List<SmsDeliveryLog> = emptyList(),
)

object SmsLogAggregator {
    fun create(
        id: String = UUID.randomUUID().toString(),
        source: String,
        maskedSummary: String,
        receivedAtMillis: Long,
        targets: List<SmsDeliveryLog>,
    ): SmsLogEntry {
        require(targets.isNotEmpty())
        val (status, detail) = aggregate(targets)
        return SmsLogEntry(
            id = id,
            source = source,
            maskedSummary = maskedSummary,
            receivedAtMillis = receivedAtMillis,
            status = status,
            detail = detail,
            deliveries = targets,
        )
    }

    fun updateDelivery(
        entry: SmsLogEntry,
        pairingId: String,
        computerName: String,
        status: SmsDeliveryStatus,
        detail: String,
    ): SmsLogEntry {
        if (entry.deliveries.isEmpty()) {
            return entry.copy(
                status = status.toLogStatus(),
                detail = detail,
            )
        }
        val hasTarget = entry.deliveries.any { it.pairingId == pairingId }
        val updated = entry.deliveries.map { delivery ->
            if (delivery.pairingId == pairingId) {
                delivery.copy(
                    status = status,
                    detail = detail,
                )
            } else {
                delivery
            }
        } + if (hasTarget) {
            emptyList()
        } else {
            listOf(
                SmsDeliveryLog(
                    pairingId = pairingId,
                    computerName = computerName,
                    status = status,
                    detail = detail,
                ),
            )
        }
        val (aggregateStatus, aggregateDetail) = aggregate(updated)
        return entry.copy(
            status = aggregateStatus,
            detail = aggregateDetail,
            deliveries = updated,
        )
    }

    fun renameComputer(
        entry: SmsLogEntry,
        pairingId: String,
        computerName: String,
    ): SmsLogEntry {
        if (entry.deliveries.none { it.pairingId == pairingId }) return entry
        val updated = entry.deliveries.map { delivery ->
            if (delivery.pairingId == pairingId) {
                delivery.copy(computerName = computerName)
            } else {
                delivery
            }
        }
        val (aggregateStatus, aggregateDetail) = aggregate(updated)
        return entry.copy(
            status = aggregateStatus,
            detail = aggregateDetail,
            deliveries = updated,
        )
    }

    private fun aggregate(
        deliveries: List<SmsDeliveryLog>,
    ): Pair<SmsLogStatus, String> {
        val total = deliveries.size
        val sent = deliveries.count { it.status == SmsDeliveryStatus.SENT }
        val failed = deliveries.count { it.status == SmsDeliveryStatus.FAILED }
        val sending = total - sent - failed
        val status = when {
            sending > 0 -> SmsLogStatus.SENDING
            sent == total -> SmsLogStatus.SENT
            sent > 0 -> SmsLogStatus.PARTIAL
            else -> SmsLogStatus.FAILED
        }
        val summary = when {
            sending > 0 && failed > 0 ->
                "发送进度：已发送 $sent/$total 台，失败 $failed 台，$sending 台正在重试。"
            sending > 0 ->
                "发送进度：已发送 $sent/$total 台，$sending 台正在发送。"
            sent == total ->
                "已发送到全部 $total 台电脑。"
            sent > 0 ->
                "部分送达：已发送 $sent/$total 台，失败 $failed 台。"
            else ->
                "发送失败：$failed 台电脑均未收到。"
        }
        val targetDetails = deliveries.joinToString(separator = "\n") { delivery ->
            "${delivery.computerName}：${delivery.detail}"
        }
        return status to "$summary\n$targetDetails"
    }

    private fun SmsDeliveryStatus.toLogStatus(): SmsLogStatus = when (this) {
        SmsDeliveryStatus.SENDING -> SmsLogStatus.SENDING
        SmsDeliveryStatus.SENT -> SmsLogStatus.SENT
        SmsDeliveryStatus.FAILED -> SmsLogStatus.FAILED
    }
}

object SmsLogSanitizer {
    private val otpLikeNumber = Regex("""(?<!\d)\d{4,8}(?!\d)""")
    private val whitespace = Regex("""\s+""")

    fun source(sender: String?): String =
        sender
            ?.trim()
            ?.take(32)
            ?.takeIf(String::isNotBlank)
            ?: "未知来源"

    fun maskedSummary(body: String, code: String): String {
        val maskedCode = maskCode(code)
        val codeMasked = body.replace(code, maskedCode)
        val allCandidatesMasked = otpLikeNumber.replace(codeMasked) { match ->
            maskCode(match.value)
        }
        return whitespace
            .replace(allCandidatesMasked, " ")
            .trim()
            .take(72)
            .ifBlank { "已识别验证码 $maskedCode" }
    }

    fun unrecognizedSummary(): String = "存在多个候选数字，未能可靠判断"

    fun maskCode(code: String): String {
        if (code.isEmpty()) return "••••"
        val visibleLength = minOf(2, code.length)
        return "••••" + code.takeLast(visibleLength)
    }

    fun containsOtpLikeNumber(body: String): Boolean = otpLikeNumber.containsMatchIn(body)
}

package com.otprelay.android.storage

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsLogAggregatorTest {
    private val targets = listOf(
        SmsDeliveryLog(pairingId = "pairing-a", computerName = "办公室电脑"),
        SmsDeliveryLog(pairingId = "pairing-b", computerName = "家里电脑"),
    )

    @Test
    fun mergesMultipleComputerDeliveriesIntoOneLog() {
        val initial = SmsLogAggregator.create(
            id = "log-1",
            source = "示例服务",
            maskedSummary = "验证码 ••••10",
            receivedAtMillis = 1_000,
            targets = targets,
        )

        assertEquals(SmsLogStatus.SENDING, initial.status)
        assertEquals(2, initial.deliveries.size)
        assertTrue(initial.detail.contains("已发送 0/2 台"))

        val oneSent = SmsLogAggregator.updateDelivery(
            entry = initial,
            pairingId = "pairing-a",
            computerName = "办公室电脑",
            status = SmsDeliveryStatus.SENT,
            detail = "密文已发送",
        )
        assertEquals(SmsLogStatus.SENDING, oneSent.status)
        assertTrue(oneSent.detail.contains("已发送 1/2 台"))

        val partial = SmsLogAggregator.updateDelivery(
            entry = oneSent,
            pairingId = "pairing-b",
            computerName = "家里电脑",
            status = SmsDeliveryStatus.FAILED,
            detail = "验证码已过期",
        )
        assertEquals(SmsLogStatus.PARTIAL, partial.status)
        assertTrue(partial.detail.contains("部分送达"))
        assertTrue(partial.detail.contains("办公室电脑：密文已发送"))
        assertTrue(partial.detail.contains("家里电脑：验证码已过期"))
    }

    @Test
    fun renameUpdatesDeliveryDetailWithoutChangingResult() {
        val sent = targets.fold(
            SmsLogAggregator.create(
                source = "示例服务",
                maskedSummary = "验证码 ••••10",
                receivedAtMillis = 1_000,
                targets = targets,
            ),
        ) { entry, target ->
            SmsLogAggregator.updateDelivery(
                entry = entry,
                pairingId = target.pairingId,
                computerName = target.computerName,
                status = SmsDeliveryStatus.SENT,
                detail = "密文已发送",
            )
        }

        val renamed = SmsLogAggregator.renameComputer(
            sent,
            pairingId = "pairing-b",
            computerName = "书房电脑",
        )

        assertEquals(SmsLogStatus.SENT, renamed.status)
        assertTrue(renamed.detail.contains("书房电脑：密文已发送"))
        assertTrue(!renamed.detail.contains("家里电脑"))
    }

    @Test
    fun oldLogWithoutDeliveriesStillDecodesAndUpdates() {
        val legacy = Json.decodeFromString<SmsLogEntry>(
            """{"id":"old","source":"示例","maskedSummary":"••••10","receivedAtMillis":1000,"status":"SENDING","detail":"正在发送"}""",
        )

        assertTrue(legacy.deliveries.isEmpty())
        val updated = SmsLogAggregator.updateDelivery(
            entry = legacy,
            pairingId = "pairing-a",
            computerName = "办公室电脑",
            status = SmsDeliveryStatus.SENT,
            detail = "密文已发送",
        )
        assertEquals(SmsLogStatus.SENT, updated.status)
        assertEquals("密文已发送", updated.detail)
    }
}

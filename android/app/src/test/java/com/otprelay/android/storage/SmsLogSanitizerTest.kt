package com.otprelay.android.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsLogSanitizerTest {
    @Test
    fun masksOtpAndKeepsOnlyLastTwoCharacters() {
        val summary = SmsLogSanitizer.maskedSummary(
            "您的验证码为 246810，有效期 202607，请勿泄露",
            "246810",
        )

        assertEquals("您的验证码为 ••••10，有效期 ••••07，请勿泄露", summary)
        assertFalse(summary.contains("246810"))
        assertFalse(summary.contains("202607"))
    }

    @Test
    fun detectsFourToEightDigitCandidates() {
        assertTrue(SmsLogSanitizer.containsOtpLikeNumber("验证码 123456"))
        assertFalse(SmsLogSanitizer.containsOtpLikeNumber("订单 123"))
        assertFalse(SmsLogSanitizer.containsOtpLikeNumber("手机号 13800138000"))
    }

    @Test
    fun normalizesMissingSender() {
        assertEquals("未知来源", SmsLogSanitizer.source("  "))
        assertEquals("10690001", SmsLogSanitizer.source(" 10690001 "))
    }
}

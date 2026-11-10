package com.otprelay.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OtpParserTest {
    @Test
    fun parsesNumericOtpNearKeyword() {
        val result = OtpParser.parse(
            "10690000",
            "【示例服务】您的登录验证码为 482917，5分钟内有效。",
        )
        assertEquals("482917", result?.code)
        assertEquals("示例服务", result?.source)
        assertEquals("登录", result?.purpose)
    }

    @Test
    fun parsesControlledAlphaNumericOtp() {
        val result = OtpParser.parse(
            "Example",
            "Your verification code is A7K9Q2. It expires soon.",
        )
        assertEquals("A7K9Q2", result?.code)
    }

    @Test
    fun rejectsOrdinaryTransactionMessage() {
        assertNull(
            OtpParser.parse(
                "Bank",
                "您尾号1234的账户消费人民币58.20元，当前余额9876.50元。",
            ),
        )
    }

    @Test
    fun rejectsAmbiguousCandidates() {
        assertNull(
            OtpParser.parse(
                "Example",
                "验证码可能是 123456 或 654321，请核对后操作。",
            ),
        )
    }

    @Test
    fun rejectsMessageWithoutOtpSemantics() {
        assertNull(OtpParser.parse("Delivery", "取件码 839201，请及时领取包裹。"))
    }
}

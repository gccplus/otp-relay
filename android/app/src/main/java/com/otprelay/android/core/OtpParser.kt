package com.otprelay.android.core

import com.otprelay.android.protocol.ParsedOtp

/**
 * Conservative OTP parser. Ambiguous candidates are deliberately rejected:
 * false positives are more harmful than missing a code in this MVP.
 */
object OtpParser {
    private val positiveKeywords = listOf(
        "验证码", "校验码", "动态码", "安全码", "确认码", "一次性密码",
        "verification code", "verify code", "security code", "otp", "code is",
    )
    private val negativeKeywords = listOf(
        "余额", "消费", "支出", "收入", "账单", "快递单号", "订单号", "航班",
        "amount", "balance", "order number",
    )
    private val numericCandidate =
        Regex("(?<![A-Za-z0-9])\\d{4,8}(?![A-Za-z0-9])")
    private val alphaNumericCandidate =
        Regex("(?<![A-Za-z0-9])[A-Za-z0-9]{4,8}(?![A-Za-z0-9])")
    private val dateLike = Regex("""\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b""")
    private val phoneLike = Regex("""(?<!\d)1[3-9]\d{9}(?!\d)""")

    fun looksLikeOtp(body: String): Boolean {
        val lower = body.lowercase()
        return positiveKeywords.any(lower::contains)
    }

    fun parse(sender: String?, body: String): ParsedOtp? {
        val normalized = body.replace('\u3000', ' ').trim()
        if (normalized.isEmpty()) return null
        val lower = normalized.lowercase()
        if (positiveKeywords.none(lower::contains)) return null
        if (
            negativeKeywords.any(lower::contains) &&
            positiveKeywords.none { keyword ->
                lower.indexOf(keyword).let { it >= 0 && nearestCandidateDistance(lower, it) <= 16 }
            }
        ) return null

        val excludedRanges =
            (dateLike.findAll(normalized) + phoneLike.findAll(normalized))
                .map { it.range }
                .toList()

        val candidates = buildList {
            numericCandidate.findAll(normalized).forEach { match ->
                if (excludedRanges.none { rangesOverlap(match.range, it) }) {
                    add(Candidate(match.value, match.range, isAlphaNumeric = false))
                }
            }
            alphaNumericCandidate.findAll(normalized).forEach { match ->
                val value = match.value
                if (
                    value.any(Char::isLetter) &&
                    value.any(Char::isDigit) &&
                    excludedRanges.none { rangesOverlap(match.range, it) }
                ) {
                    add(Candidate(value, match.range, isAlphaNumeric = true))
                }
            }
        }.distinctBy { it.value to it.range }

        if (candidates.isEmpty()) return null
        val scored = candidates
            .map { it to score(it, lower) }
            .sortedByDescending { it.second }
        val best = scored.first()
        if (best.second < 4) return null
        if (scored.size > 1 && best.second - scored[1].second < 3) return null

        return ParsedOtp(
            code = best.first.value,
            source = inferSource(sender, normalized),
            purpose = inferPurpose(lower),
        )
    }

    private fun score(candidate: Candidate, lower: String): Int {
        val center = (candidate.range.first + candidate.range.last) / 2
        val keywordDistance = positiveKeywords
            .mapNotNull { keyword ->
                val index = lower.indexOf(keyword)
                index.takeIf { it >= 0 }?.let { kotlin.math.abs(center - it) }
            }
            .minOrNull() ?: Int.MAX_VALUE
        var score = when {
            keywordDistance <= 8 -> 10
            keywordDistance <= 20 -> 7
            keywordDistance <= 40 -> 4
            else -> 1
        }
        if (!candidate.isAlphaNumeric && candidate.value.length == 6) score += 2
        if (candidate.isAlphaNumeric && keywordDistance > 16) score -= 4
        return score
    }

    private fun nearestCandidateDistance(text: String, keywordIndex: Int): Int {
        return numericCandidate.findAll(text)
            .map { kotlin.math.abs(it.range.first - keywordIndex) }
            .minOrNull() ?: Int.MAX_VALUE
    }

    private fun inferSource(sender: String?, body: String): String {
        val bracketed = Regex("""^[【\[]([^】\]]{1,24})[】\]]""")
            .find(body)
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
        return bracketed
            ?: sender?.trim()?.take(32)?.takeIf(String::isNotEmpty)
            ?: "未知来源"
    }

    private fun inferPurpose(lower: String): String = when {
        listOf("登录", "登陆", "sign in", "login").any(lower::contains) -> "登录"
        listOf("支付", "付款", "pay").any(lower::contains) -> "支付"
        listOf("注册", "register").any(lower::contains) -> "注册"
        listOf("修改密码", "重置密码", "reset password").any(lower::contains) -> "修改密码"
        else -> "身份验证"
    }

    private data class Candidate(
        val value: String,
        val range: IntRange,
        val isAlphaNumeric: Boolean,
    )

    private fun rangesOverlap(first: IntRange, second: IntRange): Boolean =
        first.first <= second.last && second.first <= first.last
}

package com.otprelay.android.storage

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.otprelay.android.protocol.PairingConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class SecureStore(context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "otp_relay_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun getPairings(): List<PairingConfig> = synchronized(STORE_LOCK) {
        val serialized = preferences.getString(KEY_PAIRINGS, null)
        if (serialized != null) {
            return@synchronized runCatching {
                json.decodeFromString<List<PairingConfig>>(serialized)
            }.getOrNull().orEmpty()
        }
        val legacy = preferences.getString(KEY_PAIRING, null)?.let { serialized ->
            runCatching { json.decodeFromString<PairingConfig>(serialized) }.getOrNull()
        } ?: return@synchronized emptyList()
        preferences.edit()
            .putString(KEY_PAIRINGS, json.encodeToString(listOf(legacy)))
            .remove(KEY_PAIRING)
            .apply()
        listOf(legacy)
    }

    fun getPairing(pairingId: String): PairingConfig? =
        getPairings().firstOrNull { it.pairingId == pairingId }

    fun savePairing(config: PairingConfig) = synchronized(STORE_LOCK) {
        val updated = getPairings()
            .filterNot { existing ->
                existing.pairingId == config.pairingId ||
                    (
                        config.computerDeviceId != null &&
                            existing.computerDeviceId == config.computerDeviceId
                    )
            } + config
        preferences.edit()
            .putString(KEY_PAIRINGS, json.encodeToString(updated))
            .remove(KEY_PAIRING)
            .apply()
    }

    fun renamePairing(pairingId: String, computerName: String) = synchronized(STORE_LOCK) {
        val normalized = computerName.trim()
        require(normalized.length in 1..32) { "电脑名称需要为 1～32 个字符" }
        require(normalized.none { it.isISOControl() }) { "电脑名称不能包含控制字符" }
        val pairings = getPairings()
        require(pairings.any { it.pairingId == pairingId }) { "配对不存在" }
        val updatedPairings = pairings.map { pairing ->
            if (pairing.pairingId == pairingId) {
                pairing.copy(computerName = normalized)
            } else {
                pairing
            }
        }
        preferences.edit()
            .putString(KEY_PAIRINGS, json.encodeToString(updatedPairings))
            .remove(KEY_PAIRING)
            .apply()

        val logs = decodeSmsLogs()
        val updatedLogs = logs.map { entry ->
            SmsLogAggregator.renameComputer(entry, pairingId, normalized)
        }
        if (updatedLogs != logs) saveSmsLogs(updatedLogs)
    }

    fun lastResult(): String =
        preferences.getString(KEY_LAST_RESULT, null) ?: "暂无同步记录"

    fun saveLastResult(result: String) {
        preferences.edit().putString(KEY_LAST_RESULT, result.take(160)).apply()
    }

    fun smsLogs(nowMillis: Long = System.currentTimeMillis()): List<SmsLogEntry> =
        synchronized(STORE_LOCK) {
            val stored = decodeSmsLogs()
            val retained = stored
                .filter { nowMillis - it.receivedAtMillis in 0 until LOG_RETENTION_MILLIS }
                .sortedByDescending(SmsLogEntry::receivedAtMillis)
                .take(MAX_LOG_COUNT)
            if (retained != stored) saveSmsLogs(retained)
            retained
        }

    fun saveSmsLog(entry: SmsLogEntry) = synchronized(STORE_LOCK) {
        val updated = (decodeSmsLogs().filterNot { it.id == entry.id } + entry)
            .filter {
                System.currentTimeMillis() - it.receivedAtMillis in 0 until LOG_RETENTION_MILLIS
            }
            .sortedByDescending(SmsLogEntry::receivedAtMillis)
            .take(MAX_LOG_COUNT)
        saveSmsLogs(updated)
    }

    fun updateSmsLog(
        id: String,
        status: SmsLogStatus,
        detail: String,
    ) = synchronized(STORE_LOCK) {
        val updated = decodeSmsLogs().map { entry ->
            if (entry.id == id) entry.copy(status = status, detail = detail) else entry
        }
        saveSmsLogs(updated)
    }

    fun updateSmsDelivery(
        logId: String,
        pairingId: String,
        computerName: String,
        status: SmsDeliveryStatus,
        detail: String,
    ) = synchronized(STORE_LOCK) {
        val updated = decodeSmsLogs().map { entry ->
            if (entry.id == logId) {
                SmsLogAggregator.updateDelivery(
                    entry = entry,
                    pairingId = pairingId,
                    computerName = computerName,
                    status = status,
                    detail = detail,
                )
            } else {
                entry
            }
        }
        saveSmsLogs(updated)
    }

    fun clearSmsLogs() = synchronized(STORE_LOCK) {
        preferences.edit().remove(KEY_SMS_LOGS).apply()
    }

    fun removePairing(pairingId: String) = synchronized(STORE_LOCK) {
        val updated = getPairings().filterNot { it.pairingId == pairingId }
        preferences.edit()
            .putString(KEY_PAIRINGS, json.encodeToString(updated))
            .remove(KEY_PAIRING)
            .apply()
    }

    fun clearPairings() = synchronized(STORE_LOCK) {
        preferences.edit()
            .remove(KEY_PAIRINGS)
            .remove(KEY_PAIRING)
            .remove(KEY_DEDUP_FINGERPRINT)
            .remove(KEY_DEDUP_AT)
            .remove(KEY_SMS_LOGS)
            .apply()
    }

    fun deviceId(): String = synchronized(STORE_LOCK) {
        preferences.getString(KEY_DEVICE_ID, null)?.let { return@synchronized it }
        UUID.randomUUID().toString().also {
            preferences.edit().putString(KEY_DEVICE_ID, it).apply()
        }
    }

    fun isDuplicate(source: String, code: String, receivedAtMillis: Long): Boolean =
        synchronized(STORE_LOCK) {
            val fingerprint = fingerprint("$source\u0000$code")
            val previous = preferences.getString(KEY_DEDUP_FINGERPRINT, null)
            val previousAt = preferences.getLong(KEY_DEDUP_AT, 0)
            val duplicate =
                previous == fingerprint && receivedAtMillis - previousAt in 0..60_000
            if (!duplicate) {
                preferences.edit()
                    .putString(KEY_DEDUP_FINGERPRINT, fingerprint)
                    .putLong(KEY_DEDUP_AT, receivedAtMillis)
                    .apply()
            }
            duplicate
        }

    private fun fingerprint(value: String): String {
        val secret = dedupSecret()
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret, "HmacSHA256"))
        return android.util.Base64.encodeToString(
            mac.doFinal(value.toByteArray(Charsets.UTF_8)),
            android.util.Base64.NO_WRAP,
        )
    }

    private fun dedupSecret(): ByteArray {
        preferences.getString(KEY_DEDUP_SECRET, null)?.let {
            return android.util.Base64.decode(it, android.util.Base64.NO_WRAP)
        }
        val value = ByteArray(32).also(SecureRandom()::nextBytes)
        preferences.edit().putString(
            KEY_DEDUP_SECRET,
            android.util.Base64.encodeToString(value, android.util.Base64.NO_WRAP),
        ).apply()
        return value
    }

    private fun decodeSmsLogs(): List<SmsLogEntry> =
        preferences.getString(KEY_SMS_LOGS, null)?.let { serialized ->
            runCatching {
                json.decodeFromString<List<SmsLogEntry>>(serialized)
            }.getOrNull()
        }.orEmpty()

    private fun saveSmsLogs(entries: List<SmsLogEntry>) {
        preferences.edit()
            .putString(KEY_SMS_LOGS, json.encodeToString(entries))
            .apply()
    }

    private companion object {
        val STORE_LOCK = Any()
        const val LOG_RETENTION_MILLIS = 24 * 60 * 60 * 1000L
        const val MAX_LOG_COUNT = 100
        const val KEY_PAIRING = "pairing"
        const val KEY_PAIRINGS = "pairings"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEDUP_SECRET = "dedup_secret"
        const val KEY_DEDUP_FINGERPRINT = "dedup_fingerprint"
        const val KEY_DEDUP_AT = "dedup_at"
        const val KEY_LAST_RESULT = "last_result"
        const val KEY_SMS_LOGS = "sms_logs"
    }
}

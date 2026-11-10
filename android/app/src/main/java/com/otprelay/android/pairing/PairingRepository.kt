package com.otprelay.android.pairing

import android.os.Build
import com.otprelay.android.BuildConfig
import com.otprelay.android.network.RelayApi
import com.otprelay.android.network.RelayApiException
import com.otprelay.android.protocol.ClaimRequest
import com.otprelay.android.protocol.PROTOCOL_VERSION
import com.otprelay.android.protocol.PairingConfig
import com.otprelay.android.protocol.PairingQrPayload
import com.otprelay.android.storage.SecureStore
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import java.net.URI
import java.time.Instant

class PairingRepository(
    private val store: SecureStore,
    private val api: RelayApi = RelayApi(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun claimAndAwaitApproval(rawQr: String): PairingConfig {
        val qr = json.decodeFromString<PairingQrPayload>(rawQr)
        require(qr.protocolVersion == PROTOCOL_VERSION) { "不支持该协议版本" }
        validateServiceUrl(qr.serviceBaseUrl)
        val claimed = try {
            api.claim(
                qr.serviceBaseUrl.trimEnd('/'),
                qr.pairingSessionId,
                ClaimRequest(
                    claimSecret = qr.claimSecret,
                    androidDeviceId = store.deviceId(),
                    androidDeviceName = "${Build.MANUFACTURER} ${Build.MODEL}",
                    protocolVersion = PROTOCOL_VERSION,
                ),
            )
        } catch (error: RelayApiException) {
            if (error.statusCode == 409 && error.errorCode == "PAIRING_CONFLICT") {
                error("该电脑端仍有有效配对，请先在电脑端解除")
            }
            throw error
        }
        val deadline = Instant.parse(claimed.expiresAt)
        while (Instant.now().isBefore(deadline)) {
            delay(1_500)
            val result = api.queryPairing(
                qr.serviceBaseUrl.trimEnd('/'),
                qr.pairingSessionId,
                claimed.androidSessionToken,
            )
            when (result.status) {
                "paired" -> {
                    val config = PairingConfig(
                        serviceBaseUrl = qr.serviceBaseUrl.trimEnd('/'),
                        pairingId = requireNotNull(result.pairingId),
                        credential = requireNotNull(result.deviceCredential),
                        macPublicKey = requireNotNull(result.macPublicKey),
                        protocolVersion = result.protocolVersion ?: PROTOCOL_VERSION,
                        computerDeviceId = result.macDeviceId,
                        computerName = result.macDeviceName?.takeIf(String::isNotBlank) ?: "电脑端",
                    )
                    require(config.macPublicKey == qr.macPublicKey) {
                        "服务器返回的电脑端公钥与二维码不一致"
                    }
                    store.savePairing(config)
                    return config
                }
                "rejected" -> error("电脑端已拒绝配对")
            }
        }
        error("二维码已过期，请在电脑端重新生成")
    }

    suspend fun revoke(pairingId: String) {
        val pairing = store.getPairing(pairingId) ?: return
        try {
            api.revoke(pairing.serviceBaseUrl, pairing.credential)
        } catch (error: RelayApiException) {
            if (error.statusCode != 401 && error.statusCode != 403) {
                throw error
            }
        }
        store.removePairing(pairingId)
    }

    private fun validateServiceUrl(value: String) {
        val uri = URI(value)
        require(uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http")) {
            "正式版本只允许 HTTPS 服务地址"
        }
        require(!uri.host.isNullOrBlank()) { "服务地址无效" }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "服务地址不能包含凭证、查询参数或片段"
        }
    }
}

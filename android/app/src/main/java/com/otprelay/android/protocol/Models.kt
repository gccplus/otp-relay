package com.otprelay.android.protocol

import kotlinx.serialization.Serializable

const val PROTOCOL_VERSION = 1

@Serializable
data class PairingQrPayload(
    val serviceBaseUrl: String,
    val pairingSessionId: String,
    val claimSecret: String,
    val macPublicKey: String,
    val protocolVersion: Int,
)

@Serializable
data class PairingConfig(
    val serviceBaseUrl: String,
    val pairingId: String,
    val credential: String,
    val macPublicKey: String,
    val protocolVersion: Int = PROTOCOL_VERSION,
    val computerDeviceId: String? = null,
    val computerName: String = "电脑端",
)

@Serializable
data class OtpPayload(
    val code: String,
    val source: String,
    val purpose: String,
    val receivedAt: String,
)

@Serializable
data class MessageEnvelope(
    val messageId: String,
    val pairingId: String,
    val protocolVersion: Int,
    val receivedAt: String,
    val expiresAt: String,
    val ephemeralPublicKey: String,
    val nonce: String,
    val ciphertext: String,
)

@Serializable
data class ClaimRequest(
    val claimSecret: String,
    val androidDeviceId: String,
    val androidDeviceName: String,
    val protocolVersion: Int,
)

@Serializable
data class ClaimResponse(
    val androidSessionToken: String,
    val status: String,
    val expiresAt: String,
)

@Serializable
data class PairingQueryResponse(
    val status: String,
    val pairingId: String? = null,
    val deviceCredential: String? = null,
    val macPublicKey: String? = null,
    val macDeviceId: String? = null,
    val macDeviceName: String? = null,
    val protocolVersion: Int? = null,
    val expiresAt: String? = null,
)

@Serializable
data class UploadResponse(
    val messageId: String,
    val status: String,
    val serverReceivedAt: String,
    val serverExpiresAt: String,
)

data class ParsedOtp(
    val code: String,
    val source: String,
    val purpose: String,
)

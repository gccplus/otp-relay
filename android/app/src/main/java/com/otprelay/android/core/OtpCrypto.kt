package com.otprelay.android.core

import android.util.Base64
import com.otprelay.android.protocol.MessageEnvelope
import com.otprelay.android.protocol.OtpPayload
import com.otprelay.android.protocol.PairingConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.math.BigInteger
import java.nio.charset.StandardCharsets
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object OtpCrypto {
    private val json = Json { encodeDefaults = true }
    private val random = SecureRandom()

    fun encrypt(
        payload: OtpPayload,
        pairing: PairingConfig,
        messageId: String = UUID.randomUUID().toString(),
    ): MessageEnvelope {
        require(pairing.protocolVersion == 1)
        val receivedAt = Instant.parse(payload.receivedAt)
        val expiresAt = receivedAt.plus(5, ChronoUnit.MINUTES).toString()
        val macPublicKey = decodeP256PublicKey(pairing.macPublicKey)
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), random)
        val ephemeral = generator.generateKeyPair()

        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(ephemeral.private)
        agreement.doPhase(macPublicKey, true)
        val sharedSecret = agreement.generateSecret()
        val salt = MessageDigest.getInstance("SHA-256")
            .digest(pairing.pairingId.toByteArray(StandardCharsets.UTF_8))
        val info = "otp-relay-message-v1:$messageId"
            .toByteArray(StandardCharsets.UTF_8)
        val aesKey = hkdfSha256(sharedSecret, salt, info, 32)
        sharedSecret.fill(0)

        val nonce = ByteArray(12).also(random::nextBytes)
        val aad = canonicalAad(
            protocolVersion = pairing.protocolVersion,
            messageId = messageId,
            pairingId = pairing.pairingId,
            expiresAt = expiresAt,
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(aesKey, "AES"),
            GCMParameterSpec(128, nonce),
        )
        cipher.updateAAD(aad)
        val ciphertext = cipher.doFinal(
            json.encodeToString(payload).toByteArray(StandardCharsets.UTF_8),
        )
        aesKey.fill(0)

        return MessageEnvelope(
            messageId = messageId,
            pairingId = pairing.pairingId,
            protocolVersion = pairing.protocolVersion,
            receivedAt = payload.receivedAt,
            expiresAt = expiresAt,
            ephemeralPublicKey = encodeBase64Url(
                encodeP256PublicKey(ephemeral.public as ECPublicKey),
            ),
            nonce = encodeBase64Url(nonce),
            ciphertext = encodeBase64Url(ciphertext),
        )
    }

    fun canonicalAad(
        protocolVersion: Int,
        messageId: String,
        pairingId: String,
        expiresAt: String,
    ): ByteArray =
        "$protocolVersion\n$messageId\n$pairingId\n$expiresAt"
            .toByteArray(StandardCharsets.UTF_8)

    private fun decodeP256PublicKey(encoded: String): ECPublicKey {
        val raw = decodeBase64Url(encoded)
        require(raw.size == 65 && raw[0] == 0x04.toByte()) {
            "Mac public key must use 65-byte ANSI X9.63 representation"
        }
        val parameters = AlgorithmParameters.getInstance("EC")
        parameters.init(ECGenParameterSpec("secp256r1"))
        val ecSpec = parameters.getParameterSpec(java.security.spec.ECParameterSpec::class.java)
        val point = ECPoint(
            BigInteger(1, raw.copyOfRange(1, 33)),
            BigInteger(1, raw.copyOfRange(33, 65)),
        )
        return KeyFactory.getInstance("EC")
            .generatePublic(ECPublicKeySpec(point, ecSpec)) as ECPublicKey
    }

    private fun encodeP256PublicKey(key: ECPublicKey): ByteArray =
        byteArrayOf(0x04) +
            key.w.affineX.toFixedUnsigned(32) +
            key.w.affineY.toFixedUnsigned(32)

    private fun BigInteger.toFixedUnsigned(size: Int): ByteArray {
        val raw = toByteArray()
        val unsigned = if (raw.size > size && raw[0] == 0.toByte()) {
            raw.copyOfRange(1, raw.size)
        } else {
            raw
        }
        require(unsigned.size <= size)
        return ByteArray(size - unsigned.size) + unsigned
    }

    private fun hkdfSha256(
        inputKeyMaterial: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        length: Int,
    ): ByteArray {
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(salt, "HmacSHA256"))
        val pseudoRandomKey = extract.doFinal(inputKeyMaterial)
        val output = ByteArray(length)
        var previous = ByteArray(0)
        var offset = 0
        var counter = 1
        while (offset < length) {
            val expand = Mac.getInstance("HmacSHA256")
            expand.init(SecretKeySpec(pseudoRandomKey, "HmacSHA256"))
            expand.update(previous)
            expand.update(info)
            expand.update(counter.toByte())
            previous = expand.doFinal()
            val copied = minOf(previous.size, length - offset)
            previous.copyInto(output, offset, 0, copied)
            offset += copied
            counter += 1
        }
        pseudoRandomKey.fill(0)
        previous.fill(0)
        return output
    }

    private fun encodeBase64Url(value: ByteArray): String =
        Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun decodeBase64Url(value: String): ByteArray =
        Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}

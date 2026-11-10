import CryptoKit
import Foundation
@testable import OTPRelayCore
import Testing

@Test
func decryptsAndroidCompatibleEnvelope() throws {
    let macPrivateKey = P256.KeyAgreement.PrivateKey()
    let pairing = PairingMetadata(
        serviceBaseURL: URL(string: "https://relay.example.test")!,
        pairingId: UUID().uuidString.lowercased(),
        protocolVersion: 1
    )
    let payload = OtpPayload(
        code: "482917",
        source: "示例服务",
        purpose: "登录",
        receivedAt: "2026-07-27T10:30:00.000Z"
    )
    let envelope = try makeEnvelope(
        payload: payload,
        pairing: pairing,
        macPublicKey: macPrivateKey.publicKey
    )
    let result = try OtpDecryptor.decrypt(
        envelope: envelope,
        pairing: pairing,
        privateKey: macPrivateKey
    )
    #expect(result == payload)
}

@Test
func rejectsTamperedAAD() throws {
    let macPrivateKey = P256.KeyAgreement.PrivateKey()
    let pairing = PairingMetadata(
        serviceBaseURL: URL(string: "https://relay.example.test")!,
        pairingId: UUID().uuidString.lowercased(),
        protocolVersion: 1
    )
    let envelope = try makeEnvelope(
        payload: .init(
            code: "123456",
            source: "示例",
            purpose: "登录",
            receivedAt: "2026-07-27T10:30:00.000Z"
        ),
        pairing: pairing,
        macPublicKey: macPrivateKey.publicKey
    )
    let tampered = MessageEnvelope(
        messageId: envelope.messageId,
        pairingId: envelope.pairingId,
        protocolVersion: envelope.protocolVersion,
        receivedAt: envelope.receivedAt,
        expiresAt: "2026-07-27T10:36:00.000Z",
        ephemeralPublicKey: envelope.ephemeralPublicKey,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext
    )
    #expect(throws: OtpCryptoError.invalidCiphertext) {
        try OtpDecryptor.decrypt(
            envelope: tampered,
            pairing: pairing,
            privateKey: macPrivateKey
        )
    }
}

private func makeEnvelope(
    payload: OtpPayload,
    pairing: PairingMetadata,
    macPublicKey: P256.KeyAgreement.PublicKey
) throws -> MessageEnvelope {
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let messageId = UUID().uuidString.lowercased()
    let expiresAt = "2026-07-27T10:35:00.000Z"
    let placeholder = MessageEnvelope(
        messageId: messageId,
        pairingId: pairing.pairingId,
        protocolVersion: 1,
        receivedAt: payload.receivedAt,
        expiresAt: expiresAt,
        ephemeralPublicKey: ephemeral.publicKey.x963Representation
            .base64URLEncodedString(),
        nonce: "",
        ciphertext: ""
    )
    let secret = try ephemeral.sharedSecretFromKeyAgreement(with: macPublicKey)
    let key = secret.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: Data(SHA256.hash(data: Data(pairing.pairingId.utf8))),
        sharedInfo: Data("otp-relay-message-v1:\(messageId)".utf8),
        outputByteCount: 32
    )
    let nonce = AES.GCM.Nonce()
    let plaintext = try JSONEncoder().encode(payload)
    let box = try AES.GCM.seal(
        plaintext,
        using: key,
        nonce: nonce,
        authenticating: OtpDecryptor.canonicalAAD(envelope: placeholder)
    )
    return MessageEnvelope(
        messageId: messageId,
        pairingId: pairing.pairingId,
        protocolVersion: 1,
        receivedAt: payload.receivedAt,
        expiresAt: expiresAt,
        ephemeralPublicKey: ephemeral.publicKey.x963Representation
            .base64URLEncodedString(),
        nonce: Data(nonce).base64URLEncodedString(),
        ciphertext: (box.ciphertext + box.tag).base64URLEncodedString()
    )
}

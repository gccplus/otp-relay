import CryptoKit
import Foundation

public enum OtpCryptoError: Error, Equatable {
    case unsupportedProtocol
    case pairingMismatch
    case invalidEncoding
    case invalidCiphertext
    case invalidPayload
}

public enum OtpDecryptor {
    public static func decrypt(
        envelope: MessageEnvelope,
        pairing: PairingMetadata,
        privateKey: P256.KeyAgreement.PrivateKey
    ) throws -> OtpPayload {
        guard envelope.protocolVersion == protocolVersion else {
            throw OtpCryptoError.unsupportedProtocol
        }
        guard envelope.pairingId == pairing.pairingId else {
            throw OtpCryptoError.pairingMismatch
        }
        guard
            let publicKeyData = Data(base64URLEncoded: envelope.ephemeralPublicKey),
            let nonceData = Data(base64URLEncoded: envelope.nonce),
            let encrypted = Data(base64URLEncoded: envelope.ciphertext),
            nonceData.count == 12,
            encrypted.count >= 16
        else {
            throw OtpCryptoError.invalidEncoding
        }

        let publicKey: P256.KeyAgreement.PublicKey
        do {
            publicKey = try P256.KeyAgreement.PublicKey(
                x963Representation: publicKeyData
            )
        } catch {
            throw OtpCryptoError.invalidEncoding
        }
        let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(
            with: publicKey
        )
        let salt = Data(SHA256.hash(data: Data(envelope.pairingId.utf8)))
        let info = Data("otp-relay-message-v1:\(envelope.messageId)".utf8)
        let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: info,
            outputByteCount: 32
        )
        let ciphertext = encrypted.dropLast(16)
        let tag = encrypted.suffix(16)
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonceData),
                ciphertext: ciphertext,
                tag: tag
            )
        } catch {
            throw OtpCryptoError.invalidCiphertext
        }
        let plaintext: Data
        do {
            plaintext = try AES.GCM.open(
                sealedBox,
                using: symmetricKey,
                authenticating: canonicalAAD(envelope: envelope)
            )
        } catch {
            throw OtpCryptoError.invalidCiphertext
        }
        do {
            return try JSONDecoder().decode(OtpPayload.self, from: plaintext)
        } catch {
            throw OtpCryptoError.invalidPayload
        }
    }

    public static func canonicalAAD(envelope: MessageEnvelope) -> Data {
        Data(
            "\(envelope.protocolVersion)\n\(envelope.messageId)\n\(envelope.pairingId)\n\(envelope.expiresAt)"
                .utf8
        )
    }
}

public final class MacKeyManager: @unchecked Sendable {
    private let keychain: KeychainStore
    private let account = "mac-p256-key-agreement-v1"

    public init(keychain: KeychainStore = .init(service: KeychainNamespace.service)) {
        self.keychain = keychain
    }

    public func loadOrCreatePrivateKey() throws -> P256.KeyAgreement.PrivateKey {
        if let stored = try keychain.read(account: account) {
            return try P256.KeyAgreement.PrivateKey(rawRepresentation: stored)
        }
        let key = P256.KeyAgreement.PrivateKey()
        try keychain.save(key.rawRepresentation, account: account)
        return key
    }

    public func deletePrivateKey() throws {
        try keychain.delete(account: account)
    }
}

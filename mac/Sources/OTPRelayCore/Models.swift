import Foundation

public let protocolVersion = 1

public struct PairingQRPayload: Codable, Sendable {
    public let serviceBaseUrl: String
    public let pairingSessionId: String
    public let claimSecret: String
    public let macPublicKey: String
    public let protocolVersion: Int

    public init(
        serviceBaseUrl: String,
        pairingSessionId: String,
        claimSecret: String,
        macPublicKey: String,
        protocolVersion: Int
    ) {
        self.serviceBaseUrl = serviceBaseUrl
        self.pairingSessionId = pairingSessionId
        self.claimSecret = claimSecret
        self.macPublicKey = macPublicKey
        self.protocolVersion = protocolVersion
    }
}

public struct PairingMetadata: Codable, Sendable {
    public let serviceBaseURL: URL
    public let pairingId: String
    public let protocolVersion: Int

    public init(
        serviceBaseURL: URL,
        pairingId: String,
        protocolVersion: Int
    ) {
        self.serviceBaseURL = serviceBaseURL
        self.pairingId = pairingId
        self.protocolVersion = protocolVersion
    }
}

public struct OtpPayload: Codable, Sendable, Equatable {
    public let code: String
    public let source: String
    public let purpose: String
    public let receivedAt: String

    public init(code: String, source: String, purpose: String, receivedAt: String) {
        self.code = code
        self.source = source
        self.purpose = purpose
        self.receivedAt = receivedAt
    }
}

public struct MessageEnvelope: Codable, Sendable, Equatable {
    public let messageId: String
    public let pairingId: String
    public let protocolVersion: Int
    public let receivedAt: String
    public let expiresAt: String
    public let ephemeralPublicKey: String
    public let nonce: String
    public let ciphertext: String

    public init(
        messageId: String,
        pairingId: String,
        protocolVersion: Int,
        receivedAt: String,
        expiresAt: String,
        ephemeralPublicKey: String,
        nonce: String,
        ciphertext: String
    ) {
        self.messageId = messageId
        self.pairingId = pairingId
        self.protocolVersion = protocolVersion
        self.receivedAt = receivedAt
        self.expiresAt = expiresAt
        self.ephemeralPublicKey = ephemeralPublicKey
        self.nonce = nonce
        self.ciphertext = ciphertext
    }
}

public struct MessageEvent: Codable, Sendable {
    public let event: String
    public let data: MessageEnvelope?
}

public struct PairingSessionCreated: Codable, Sendable {
    public let pairingSessionId: String
    public let claimSecret: String
    public let macSessionToken: String
    public let expiresAt: String
}

public struct PairingStatusResponse: Codable, Sendable {
    public let status: String
    public let androidDeviceId: String?
    public let androidDeviceName: String?
    public let expiresAt: String?
    public let pairingId: String?
    public let deviceCredential: String?
    public let protocolVersion: Int?
}

public struct AckResponse: Codable, Sendable {
    public let messageId: String
    public let status: String
    public let acknowledgedAt: String
}

public struct ApiErrorEnvelope: Codable, Sendable {
    public struct Body: Codable, Sendable {
        public let code: String
        public let message: String
        public let requestId: String?
    }

    public let error: Body
}

public extension Data {
    init?(base64URLEncoded value: String) {
        var normalized = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        if remainder > 0 {
            normalized += String(repeating: "=", count: 4 - remainder)
        }
        self.init(base64Encoded: normalized)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

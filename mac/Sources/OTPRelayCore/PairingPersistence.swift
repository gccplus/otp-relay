import Foundation

public final class PairingPersistence: @unchecked Sendable {
    private let defaults: UserDefaults
    private let keychain: KeychainStore
    private let metadataKey = "pairing-metadata-v1"
    private let credentialAccount = "mac-device-credential-v1"

    public init(
        defaults: UserDefaults = AppPreferences.defaults,
        keychain: KeychainStore = .init(service: KeychainNamespace.service)
    ) {
        self.defaults = defaults
        self.keychain = keychain
    }

    public func save(metadata: PairingMetadata, credential: String) throws {
        let encoded = try JSONEncoder().encode(metadata)
        try keychain.save(Data(credential.utf8), account: credentialAccount)
        defaults.set(encoded, forKey: metadataKey)
    }

    public func load() throws -> (PairingMetadata, String)? {
        guard
            let data = defaults.data(forKey: metadataKey),
            let credentialData = try keychain.read(account: credentialAccount),
            let credential = String(data: credentialData, encoding: .utf8)
        else {
            return nil
        }
        return (try JSONDecoder().decode(PairingMetadata.self, from: data), credential)
    }

    public func clear() throws {
        defaults.removeObject(forKey: metadataKey)
        try keychain.delete(account: credentialAccount)
    }
}

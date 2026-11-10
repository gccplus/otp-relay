import Foundation

public enum DeviceIdentity {
    private static let key = "mac-device-id-v1"

    public static func persistentId(
        defaults: UserDefaults = AppPreferences.defaults
    ) -> String {
        if let existing = defaults.string(forKey: key) {
            return existing
        }
        let value = UUID().uuidString.lowercased()
        defaults.set(value, forKey: key)
        return value
    }
}

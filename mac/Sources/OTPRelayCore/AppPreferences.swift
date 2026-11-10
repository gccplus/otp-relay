import Foundation

public enum AppPreferences {
    public static let suiteName = "com.otprelay.mac.preferences"

    public static var defaults: UserDefaults {
        UserDefaults(suiteName: suiteName) ?? UserDefaults.standard
    }

    /// 首次启动时将旧数据从 standard 迁移到自定义 suite
    public static func migrateIfNeeded() {
        let defaults = Self.defaults
        guard !defaults.bool(forKey: "migration-done-v1") else { return }
        let standard = UserDefaults.standard

        let keysToMigrate = [
            "pairing-metadata-v1",
            "service-domain-v1",
            "service-base-url",
            "mac-device-id-v1",
            "paired-android-device-name-v1",
        ]
        for key in keysToMigrate {
            if let value = standard.object(forKey: key) {
                defaults.set(value, forKey: key)
            }
        }
        defaults.set(true, forKey: "migration-done-v1")
        standard.removeObject(forKey: "migration-done-v1")
    }
}

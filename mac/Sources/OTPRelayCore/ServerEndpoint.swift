import Foundation

public enum ServerEndpoint {
    public static let defaultDomain = "otp.example.com"

    public static func normalizedDomain(_ input: String) -> String? {
        let value = input
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        guard !value.isEmpty,
              !value.contains("://"),
              !value.contains("/"),
              !value.contains(":"),
              value.count <= 253
        else {
            return nil
        }

        let pattern =
            #"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"#
        guard value.range(of: pattern, options: .regularExpression) != nil else {
            return nil
        }
        return value
    }

    public static func baseURL(domain: String) -> URL? {
        guard let normalized = normalizedDomain(domain) else { return nil }
        return URL(string: "https://\(normalized)/otp-relay")
    }

    public static func migratedDomain(
        currentDomain: String?,
        legacyBaseURL: String?
    ) -> String {
        if let currentDomain,
           let normalized = normalizedDomain(currentDomain)
        {
            return normalized
        }

        if let legacyBaseURL {
            if let normalized = normalizedDomain(legacyBaseURL) {
                return normalized
            }
            if let host = URL(string: legacyBaseURL)?.host,
               let normalized = normalizedDomain(host)
            {
                return normalized
            }
        }

        return defaultDomain
    }
}

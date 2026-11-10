import Foundation
import OTPRelayCore
import Testing

@Test
func acceptsDomainAndBuildsFixedRelayURL() {
    #expect(ServerEndpoint.normalizedDomain(" OTP.Example.COM ") == "otp.example.com")
    #expect(
        ServerEndpoint.baseURL(domain: "relay.example.com")?.absoluteString
            == "https://relay.example.com/otp-relay"
    )
}

@Test
func rejectsAbsoluteURLsPathsPortsAndIPAddresses() {
    #expect(ServerEndpoint.normalizedDomain("https://otp.example.com") == nil)
    #expect(ServerEndpoint.normalizedDomain("otp.example.com/otp-relay") == nil)
    #expect(ServerEndpoint.normalizedDomain("otp.example.com:443") == nil)
    #expect(ServerEndpoint.normalizedDomain("127.0.0.1") == nil)
}

@Test
func migratesLegacyServerConfiguration() {
    #expect(
        ServerEndpoint.migratedDomain(
            currentDomain: nil,
            legacyBaseURL: "https://otp.example.com/otp-relay"
        ) == "otp.example.com"
    )
    #expect(
        ServerEndpoint.migratedDomain(
            currentDomain: nil,
            legacyBaseURL: "http://127.0.0.1:8080/otp-relay"
        ) == ServerEndpoint.defaultDomain
    )
}

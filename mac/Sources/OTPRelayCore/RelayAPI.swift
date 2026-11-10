import Foundation

public enum RelayAPIError: Error, LocalizedError {
    case invalidResponse
    case server(status: Int, code: String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "服务器响应无效"
        case let .server(status, code):
            return "服务器请求失败：\(code)（\(status)）"
        }
    }
}

public final class RelayAPI: Sendable {
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func createPairingSession(
        baseURL: URL,
        deviceId: String,
        deviceName: String,
        publicKey: String
    ) async throws -> PairingSessionCreated {
        struct Body: Encodable {
            let macDeviceId: String
            let macDeviceName: String
            let macPublicKey: String
            let protocolVersion: Int
        }
        return try await send(
            url: endpoint(baseURL, "v1/pairing-sessions"),
            method: "POST",
            credential: nil,
            body: Body(
                macDeviceId: deviceId,
                macDeviceName: deviceName,
                macPublicKey: publicKey,
                protocolVersion: protocolVersion
            )
        )
    }

    public func queryPairing(
        baseURL: URL,
        sessionId: String,
        sessionToken: String
    ) async throws -> PairingStatusResponse {
        try await send(
            url: endpoint(baseURL, "v1/pairing-sessions/\(sessionId)"),
            method: "GET",
            credential: sessionToken,
            body: Optional<String>.none
        )
    }

    public func decidePairing(
        baseURL: URL,
        sessionId: String,
        sessionToken: String,
        approve: Bool
    ) async throws {
        struct Body: Encodable { let decision: String }
        let _: PairingStatusResponse = try await send(
            url: endpoint(baseURL, "v1/pairing-sessions/\(sessionId)/decision"),
            method: "POST",
            credential: sessionToken,
            body: Body(decision: approve ? "approve" : "reject")
        )
    }

    public func acknowledge(
        baseURL: URL,
        credential: String,
        messageId: String,
        status: String,
        reason: String? = nil
    ) async throws -> AckResponse {
        struct Body: Encodable {
            let status: String
            let reason: String?
        }
        return try await send(
            url: endpoint(baseURL, "v1/messages/\(messageId)/ack"),
            method: "POST",
            credential: credential,
            body: Body(status: status, reason: reason)
        )
    }

    public func revoke(baseURL: URL, credential: String) async throws {
        struct Response: Decodable { let status: String }
        let _: Response = try await send(
            url: endpoint(baseURL, "v1/pairing"),
            method: "DELETE",
            credential: credential,
            body: Optional<String>.none
        )
    }

    public func makeStreamRequest(
        baseURL: URL,
        credential: String
    ) -> URLRequest {
        var components = URLComponents(
            url: endpoint(baseURL, "v1/mac/stream"),
            resolvingAgainstBaseURL: false
        )!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        return request
    }

    private func endpoint(_ baseURL: URL, _ path: String) -> URL {
        baseURL.appending(path: path)
    }

    private func send<Response: Decodable, Body: Encodable>(
        url: URL,
        method: String,
        credential: String?,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credential {
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RelayAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let decodedError = try? decoder.decode(
                ApiErrorEnvelope.self,
                from: data
            )
            let code = decodedError?.error.code ?? "HTTP_ERROR"
            throw RelayAPIError.server(status: http.statusCode, code: code)
        }
        return try decoder.decode(Response.self, from: data)
    }
}

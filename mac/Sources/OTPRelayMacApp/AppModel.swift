import AppKit
import CryptoKit
import Foundation
import OTPRelayCore
import OSLog
import ServiceManagement

struct OtpCard: Identifiable, Equatable, Codable {
    let id: String
    let code: String
    let source: String
    let receivedAt: Date
}

@MainActor
final class AppModel: ObservableObject {
    enum ConnectionState: Equatable {
        case unpaired
        case creatingQR
        case waitingForAndroid
        case waitingForApproval(String)
        case connected
        case reconnecting
        case failed(String)

        var label: String {
            switch self {
            case .unpaired: "尚未配对"
            case .creatingQR: "正在生成配对二维码"
            case .waitingForAndroid: "等待 Android 扫码"
            case let .waitingForApproval(name): "等待确认：\(name)"
            case .connected: "已连接"
            case .reconnecting: "正在重连"
            case let .failed(message): message
            }
        }
    }

    @Published var connectionState: ConnectionState = .unpaired
    @Published var qrImage: NSImage?
    @Published var cards: [OtpCard] = []
    @Published private(set) var isPaired = false
    @Published private(set) var pairedDeviceName: String?
    @Published private(set) var pairingExpiresAt: Date?
    @Published private(set) var lastConnectedAt: Date?
    @Published var launchAtLoginEnabled: Bool
    @Published var autoCopyEnabled: Bool
    @Published private(set) var serverDomain: String
    @Published private(set) var serverDomainError: String?
    @Published private(set) var lastMessageReceivedAt: Date?

    private let api = RelayAPI()
    private let keyManager = MacKeyManager()
    private let persistence = PairingPersistence()
    private let defaults = AppPreferences.defaults
    private let historyStore = KeychainStore(service: KeychainNamespace.service)
    private let deliveryLogger = Logger(
        subsystem: "com.otprelay.mac",
        category: "delivery"
    )
    private let historyAccount = "otp-history-v1"
    private let pairedDeviceNameKey = "paired-android-device-name-v1"
    private let autoCopyPreferenceKey = "auto-copy-enabled-v1"
    private let serverDomainKey = "service-domain-v1"
    private let historyRetention: TimeInterval = 24 * 60 * 60
    private var privateKey: P256.KeyAgreement.PrivateKey?
    private var pairing: PairingMetadata?
    private var credential: String?
    private var pendingAndroidName: String?
    private var pairingTask: Task<Void, Never>?
    private var streamTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var webSocket: URLSessionWebSocketTask?

    init() {
        AppPreferences.migrateIfNeeded()
        let migratedDomain = ServerEndpoint.migratedDomain(
            currentDomain: defaults.string(forKey: "service-domain-v1"),
            legacyBaseURL: defaults.string(forKey: "service-base-url")
        )
        serverDomain = migratedDomain
        defaults.set(migratedDomain, forKey: "service-domain-v1")
        defaults.removeObject(forKey: "service-base-url")
        autoCopyEnabled =
            defaults.object(forKey: autoCopyPreferenceKey) as? Bool
            ?? true
        launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
        do {
            privateKey = try keyManager.loadOrCreatePrivateKey()
        } catch {
            deliveryLogger.error(
                "local key initialization failed: \(String(describing: error), privacy: .public)"
            )
            connectionState = .failed("本机密钥初始化失败")
        }
        restoreCardHistory()
        Task { await restoreOrPreparePairing() }
        expiryTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                self?.removeOldCards()
            }
        }
    }

    func preparePairing() {
        pairingTask?.cancel()
        pairingTask = Task { await createPairingSession() }
    }

    func setServerDomain(_ value: String) {
        guard !isPaired else { return }
        serverDomain = value
        serverDomainError = nil
        if let normalized = ServerEndpoint.normalizedDomain(value) {
            defaults.set(normalized, forKey: serverDomainKey)
        }
    }

    func approvePairing() {
        guard case .waitingForApproval = connectionState else { return }
        pairingTask?.cancel()
        pairingTask = Task { await decidePairing(approve: true) }
    }

    func rejectPairing() {
        guard case .waitingForApproval = connectionState else { return }
        pairingTask?.cancel()
        pairingTask = Task { await decidePairing(approve: false) }
    }

    func prepareForSystemSleep() {
        guard isPaired else { return }
        deliveryLogger.notice("system will sleep; suspending stream")
        streamTask?.cancel()
        streamTask = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        connectionState = .reconnecting
    }

    func resumeAfterSystemWake() {
        guard isPaired, pairing != nil, credential != nil else { return }
        deliveryLogger.notice("system did wake; rebuilding stream")
        startStream()
    }

    func retryConnection() {
        if isPaired {
            connectionState = .reconnecting
            startStream()
        } else {
            preparePairing()
        }
    }

    func copy(_ card: OtpCard) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(card.code, forType: .string)
    }

    func setLaunchAtLoginEnabled(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            deliveryLogger.error("failed to update launch-at-login preference")
        }
        launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
    }

    func setAutoCopyEnabled(_ enabled: Bool) {
        autoCopyEnabled = enabled
        defaults.set(enabled, forKey: autoCopyPreferenceKey)
    }

    func unpair() {
        Task {
            await performUnpair()
        }
    }

    func unpairAndExit() {
        Task {
            await performUnpair()
            NSApplication.shared.terminate(nil)
        }
    }

    func exitApplication() {
        NSApplication.shared.terminate(nil)
    }

    var activeServerDomain: String {
        pairing?.serviceBaseURL.host
            ?? ServerEndpoint.normalizedDomain(serverDomain)
            ?? ServerEndpoint.defaultDomain
    }

    private func restoreOrPreparePairing() async {
        if let stored = try? persistence.load() {
            pairing = stored.0
            credential = stored.1
            isPaired = true
            pairedDeviceName =
                defaults.string(forKey: pairedDeviceNameKey)
                ?? "Android 手机"
            connectionState = .reconnecting
            startStream()
        } else if case .failed = connectionState {
            // 密钥加载失败，保持 failed 状态
        } else {
            connectionState = .unpaired
        }
    }

    private var pendingSession: PairingSessionCreated?
    private var baseURL: URL?

    private func createPairingSession() async {
        guard let privateKey else {
            connectionState = .failed("密钥未就绪，请稍后重试")
            return
        }
        guard
            let normalizedDomain = ServerEndpoint.normalizedDomain(serverDomain),
            let url = ServerEndpoint.baseURL(domain: normalizedDomain)
        else {
            serverDomainError = "仅填写域名，例如 otp.example.com"
            connectionState = .failed("服务器域名无效")
            return
        }
        serverDomain = normalizedDomain
        serverDomainError = nil
        defaults.set(normalizedDomain, forKey: serverDomainKey)
        connectionState = .creatingQR
        do {
            let created = try await api.createPairingSession(
                baseURL: url,
                deviceId: DeviceIdentity.persistentId(),
                deviceName: Host.current().localizedName ?? "Mac",
                publicKey: privateKey.publicKey.x963Representation
                    .base64URLEncodedString()
            )
            pendingSession = created
            baseURL = url
            pairingExpiresAt = Self.parseISO8601(created.expiresAt)
            let qr = PairingQRPayload(
                serviceBaseUrl: url.absoluteString.trimmingCharacters(
                    in: CharacterSet(charactersIn: "/")
                ),
                pairingSessionId: created.pairingSessionId,
                claimSecret: created.claimSecret,
                macPublicKey: privateKey.publicKey.x963Representation
                    .base64URLEncodedString(),
                protocolVersion: protocolVersion
            )
            let encoded = try JSONEncoder().encode(qr)
            qrImage = QRCode.image(from: String(decoding: encoded, as: UTF8.self))
            connectionState = .waitingForAndroid
            await pollForAndroid()
        } catch let error as RelayAPIError {
            switch error {
            case let .server(_, code) where code == "PAIRING_CONFLICT":
                connectionState = .failed("设备仍存在有效配对，请先在原设备解除配对")
            case let .server(status, _) where status == 429:
                connectionState = .failed("操作过于频繁，请稍后再试")
            default:
                connectionState = .failed("无法创建配对，请检查服务器域名")
            }
        } catch {
            connectionState = .failed("无法连接云端，请检查网络")
        }
    }

    private func pollForAndroid() async {
        guard let pendingSession, let baseURL else { return }
        while !Task.isCancelled {
            do {
                let state = try await api.queryPairing(
                    baseURL: baseURL,
                    sessionId: pendingSession.pairingSessionId,
                    sessionToken: pendingSession.macSessionToken
                )
                if state.status == "waiting_for_mac_approval" {
                    pendingAndroidName = state.androidDeviceName ?? "Android 设备"
                    connectionState = .waitingForApproval(
                        pendingAndroidName ?? "Android 设备"
                    )
                    return
                }
                try await Task.sleep(for: .seconds(1.5))
            } catch {
                connectionState = .failed("配对二维码已过期，请重新生成")
                return
            }
        }
    }

    private func decidePairing(approve: Bool) async {
        guard let pendingSession, let baseURL else { return }
        do {
            try await api.decidePairing(
                baseURL: baseURL,
                sessionId: pendingSession.pairingSessionId,
                sessionToken: pendingSession.macSessionToken,
                approve: approve
            )
            if !approve {
                await createPairingSession()
                return
            }
            let result = try await api.queryPairing(
                baseURL: baseURL,
                sessionId: pendingSession.pairingSessionId,
                sessionToken: pendingSession.macSessionToken
            )
            guard
                result.status == "paired",
                let pairingId = result.pairingId,
                let deviceCredential = result.deviceCredential
            else {
                throw RelayAPIError.invalidResponse
            }
            let metadata = PairingMetadata(
                serviceBaseURL: baseURL,
                pairingId: pairingId,
                protocolVersion: result.protocolVersion ?? protocolVersion
            )
            try persistence.save(
                metadata: metadata,
                credential: deviceCredential
            )
            pairing = metadata
            credential = deviceCredential
            isPaired = true
            pairedDeviceName = pendingAndroidName ?? "Android 手机"
            defaults.set(
                pairedDeviceName,
                forKey: pairedDeviceNameKey
            )
            qrImage = nil
            pairingExpiresAt = nil
            pendingAndroidName = nil
            self.pendingSession = nil
            startStream()
        } catch {
            connectionState = .failed("配对确认失败，请重新生成二维码")
        }
    }

    private func startStream() {
        streamTask?.cancel()
        streamTask = Task { await maintainStream() }
    }

    private func maintainStream() async {
        var retrySeconds = 1.0
        while !Task.isCancelled {
            guard let pairing, let credential else { return }
            let request = api.makeStreamRequest(
                baseURL: pairing.serviceBaseURL,
                credential: credential
            )
            let socket = URLSession.shared.webSocketTask(with: request)
            webSocket = socket
            socket.resume()
            connectionState = .connected
            lastConnectedAt = Date()
            deliveryLogger.notice("stream started")
            let heartbeatTask = Task { [weak self] in
                await self?.maintainHeartbeat(socket: socket)
            }
            defer {
                heartbeatTask.cancel()
                socket.cancel(with: .goingAway, reason: nil)
            }
            do {
                try await receiveMessages(
                    socket: socket,
                    pairing: pairing,
                    credential: credential
                )
                retrySeconds = 1
            } catch {
                if Task.isCancelled { return }
                if socket.closeCode.rawValue == 4003 {
                    deliveryLogger.notice(
                        "stored pairing is no longer valid; clearing local credentials"
                    )
                    clearLocalPairing()
                    return
                }
                deliveryLogger.error("stream interrupted; reconnecting")
                connectionState = .reconnecting
                try? await Task.sleep(for: .seconds(retrySeconds))
                retrySeconds = min(retrySeconds * 2, 20)
            }
        }
    }

    private func receiveMessages(
        socket: URLSessionWebSocketTask,
        pairing: PairingMetadata,
        credential: String
    ) async throws {
        while !Task.isCancelled {
            let message = try await socket.receive()
            let data: Data
            switch message {
            case let .data(value): data = value
            case let .string(value): data = Data(value.utf8)
            @unknown default: continue
            }
            let event = try JSONDecoder().decode(MessageEvent.self, from: data)
            if event.event == "pairing.revoked" {
                clearLocalPairing()
                return
            }
            guard event.event == "message.available", let envelope = event.data else {
                continue
            }
            deliveryLogger.notice(
                "message received id=\(envelope.messageId, privacy: .public)"
            )
            await handleEnvelope(
                envelope,
                pairing: pairing,
                credential: credential
            )
        }
    }

    private func maintainHeartbeat(socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(10))
                try Task.checkCancellation()
                let waiter = WebSocketPingWaiter()
                try await waiter.wait(on: socket)
            } catch is CancellationError {
                return
            } catch {
                deliveryLogger.error("stream heartbeat failed")
                socket.cancel(with: .goingAway, reason: nil)
                return
            }
        }
    }

    private func handleEnvelope(
        _ envelope: MessageEnvelope,
        pairing: PairingMetadata,
        credential: String
    ) async {
        guard
            let expiresAt = ISO8601DateFormatter.otpRelay.date(
                from: envelope.expiresAt
            ),
            expiresAt > Date()
        else {
            try? await reject(
                envelope,
                pairing: pairing,
                credential: credential,
                reason: "MESSAGE_EXPIRED"
            )
            return
        }
        do {
            guard let privateKey else { throw OtpCryptoError.invalidPayload }
            let payload = try OtpDecryptor.decrypt(
                envelope: envelope,
                pairing: pairing,
                privateKey: privateKey
            )
            let card = OtpCard(
                id: envelope.messageId,
                code: payload.code,
                source: payload.source,
                receivedAt:
                    Self.parseISO8601(payload.receivedAt)
                    ?? Self.parseISO8601(envelope.receivedAt)
                    ?? Date()
            )
            if !cards.contains(where: { $0.id == card.id }) {
                cards.insert(card, at: 0)
                cards.sort { $0.receivedAt > $1.receivedAt }
                removeOldCards()
                persistCardHistory()
                lastMessageReceivedAt = Date()
                if autoCopyEnabled {
                    copy(card)
                    deliveryLogger.notice(
                        "message auto-copied id=\(envelope.messageId, privacy: .public)"
                    )
                }
                deliveryLogger.notice(
                    "message displayed id=\(envelope.messageId, privacy: .public)"
                )
            }
            _ = try await api.acknowledge(
                baseURL: pairing.serviceBaseURL,
                credential: credential,
                messageId: envelope.messageId,
                status: "displayed"
            )
            deliveryLogger.notice(
                "message acknowledged id=\(envelope.messageId, privacy: .public)"
            )
        } catch let error as OtpCryptoError {
            let reason: String = switch error {
            case .unsupportedProtocol: "PROTOCOL_UNSUPPORTED"
            case .pairingMismatch: "PAIRING_MISMATCH"
            case .invalidEncoding: "INVALID_ENVELOPE"
            case .invalidCiphertext: "DECRYPTION_FAILED"
            case .invalidPayload: "INVALID_PAYLOAD"
            }
            deliveryLogger.error(
                "message rejected id=\(envelope.messageId, privacy: .public) reason=\(reason, privacy: .public)"
            )
            try? await reject(
                envelope,
                pairing: pairing,
                credential: credential,
                reason: reason
            )
        } catch {
            deliveryLogger.error(
                "message handling failed id=\(envelope.messageId, privacy: .public)"
            )
            return
        }
    }

    private func reject(
        _ envelope: MessageEnvelope,
        pairing: PairingMetadata,
        credential: String,
        reason: String
    ) async throws {
        _ = try await api.acknowledge(
            baseURL: pairing.serviceBaseURL,
            credential: credential,
            messageId: envelope.messageId,
            status: "rejected",
            reason: reason
        )
    }

    private func removeOldCards() {
        let cutoff = Date().addingTimeInterval(-historyRetention)
        let previousCount = cards.count
        cards.removeAll { $0.receivedAt < cutoff }
        if cards.count != previousCount {
            persistCardHistory()
        }
    }

    private func clearLocalPairing() {
        streamTask?.cancel()
        webSocket?.cancel(with: .goingAway, reason: nil)
        try? persistence.clear()
        try? historyStore.delete(account: historyAccount)
        defaults.removeObject(forKey: pairedDeviceNameKey)
        pairing = nil
        credential = nil
        isPaired = false
        pairedDeviceName = nil
        pairingExpiresAt = nil
        pendingAndroidName = nil
        pendingSession = nil
        cards = []
        qrImage = nil
        connectionState = .unpaired
    }

    private func performUnpair() async {
        guard let pairing, let credential else {
            clearLocalPairing()
            return
        }
        do {
            try await api.revoke(
                baseURL: pairing.serviceBaseURL,
                credential: credential
            )
            clearLocalPairing()
        } catch let error as RelayAPIError {
            switch error {
            case let .server(status, _) where status == 401 || status == 403:
                clearLocalPairing()
            default:
                connectionState = .failed("解除配对失败，请检查网络后重试")
            }
        } catch {
            connectionState = .failed("解除配对失败，请检查网络后重试")
        }
    }

    private func restoreCardHistory() {
        guard
            let data = try? historyStore.read(account: historyAccount),
            let stored = try? JSONDecoder().decode([OtpCard].self, from: data)
        else {
            return
        }
        cards = stored.sorted { $0.receivedAt > $1.receivedAt }
        removeOldCards()
    }

    private func persistCardHistory() {
        guard let data = try? JSONEncoder().encode(cards) else { return }
        try? historyStore.save(data, account: historyAccount)
    }

    private static func parseISO8601(_ value: String) -> Date? {
        if let date = ISO8601DateFormatter.otpRelay.date(from: value) {
            return date
        }
        return ISO8601DateFormatter.otpRelayWithoutFractionalSeconds.date(
            from: value
        )
    }
}

private extension ISO8601DateFormatter {
    @MainActor
    static let otpRelay: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    @MainActor
    static let otpRelayWithoutFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

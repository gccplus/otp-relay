import Foundation

enum WebSocketHeartbeatError: Error {
    case timedOut
}

/// Bridges URLSession's callback-based ping API without allowing a platform
/// callback to complete the same Swift continuation more than once.
final class WebSocketPingWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var pendingResult: Result<Void, Error>?

    func wait(
        on socket: URLSessionWebSocketTask,
        timeout: TimeInterval = 8
    ) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                install(continuation)

                socket.sendPing { [self] error in
                    if let error {
                        finish(with: .failure(error))
                    } else {
                        finish(with: .success(()))
                    }
                }

                DispatchQueue.global(qos: .utility).asyncAfter(
                    deadline: .now() + timeout
                ) { [self] in
                    finish(with: .failure(WebSocketHeartbeatError.timedOut))
                }
            }
        } onCancel: { [self] in
            finish(with: .failure(CancellationError()))
        }
    }

    func install(
        _ continuation: CheckedContinuation<Void, Error>
    ) {
        lock.lock()
        if let pendingResult {
            lock.unlock()
            continuation.resume(with: pendingResult)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func finish(with result: Result<Void, Error>) {
        lock.lock()
        guard pendingResult == nil else {
            lock.unlock()
            return
        }
        pendingResult = result
        let continuation = continuation
        self.continuation = nil
        lock.unlock()

        continuation?.resume(with: result)
    }
}

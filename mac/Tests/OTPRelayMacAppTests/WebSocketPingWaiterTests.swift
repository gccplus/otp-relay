import Foundation
import Testing
@testable import OTPRelayMacApp

private enum TestPingError: Error {
    case duplicateCallback
}

@Test
func duplicatePingCallbacksCompleteTheContinuationOnlyOnce() async throws {
    let waiter = WebSocketPingWaiter()
    let task = Task {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            waiter.install(continuation)
        }
    }

    await Task.yield()
    waiter.finish(with: .success(()))
    waiter.finish(with: .failure(TestPingError.duplicateCallback))

    try await task.value
}

@Test
func completionBeforeContinuationInstallationIsPreserved() async throws {
    let waiter = WebSocketPingWaiter()
    waiter.finish(with: .success(()))
    waiter.finish(with: .failure(TestPingError.duplicateCallback))

    try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, Error>) in
        waiter.install(continuation)
    }
}

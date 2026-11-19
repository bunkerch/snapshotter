import Foundation
import XCTest
@testable import Snapshotter

final class BackendTests: XCTestCase {
    func testStartupUnlocksOnePasswordWithoutAWebView() async {
        let unlocked = expectation(description: "Startup authorizes 1Password")
        let backedUp = expectation(description: "Scheduled backup runs without opening the UI")
        let engine = FixtureEngine { request in
            if request == "state.get" {
                return #"{"ok":true,"data":{"status":"locked","preferences":{"repository":{"id":"archive","secretStorage":{"provider":"onepassword"}}}}}"#
            }
            if request == "repository.unlock" {
                unlocked.fulfill()
                return #"{"ok":true}"#
            }
            if request == "schedule.due" { return #"{"ok":true,"data":true}"# }
            if request == "backup.requirements" { return #"{"ok":true,"data":[]}"# }
            if request == "backup.start" {
                backedUp.fulfill()
                return #"{"ok":true}"#
            }
            XCTFail("Unexpected request: \(request)")
            return #"{"ok":false}"#
        }
        let backend = Backend(engine: .success(engine))
        backend.start()
        backend.runScheduledBackup()
        await fulfillment(of: [unlocked, backedUp], timeout: 2, enforceOrder: true)
        withExtendedLifetime(backend) {}
    }

    func testStartupAuthorizationFailureIsVisible() async {
        let attention = expectation(description: "Failure is surfaced instead of silently disabling backups")
        let observer = NotificationCenter.default.addObserver(forName: Notification.Name("snapshotter.backupAttention"), object: nil, queue: .main) { notification in
            if let message = notification.userInfo?["message"] as? String, message.contains("Backups are paused") {
                attention.fulfill()
            }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        let engine = FixtureEngine { _ in #"{"ok":false,"error":"Authorization cancelled"}"# }
        let backend = Backend(engine: .success(engine))
        backend.start()
        await fulfillment(of: [attention], timeout: 2)
        withExtendedLifetime(backend) {}
    }

    func testNonRootRestoreDoesNotFetchApplicationSecrets() async {
        let restored = expectation(description: "Restore runs directly")
        restored.expectedFulfillmentCount = 2
        let drained = expectation(description: "First restore finishes")
        let engine = FixtureEngine { request in
            if request == "state.get" {
                drained.fulfill()
                return #"{"ok":true}"#
            }
            XCTAssertEqual(request, "snapshot.restore")
            restored.fulfill()
            return #"{"ok":true,"data":{"restoredFiles":1}}"#
        }
        let backend = Backend(engine: .success(engine))
        backend.restoreSnapshot(snapshotID: "snapshot", path: "/Documents", destination: "/recovered", requestID: nil, webView: nil)
        backend.handle(#"{"type":"state.get"}"#, requestID: nil, webView: nil)
        await fulfillment(of: [drained], timeout: 2)
        backend.restoreSnapshot(snapshotID: "snapshot", path: "/Pictures", destination: "/recovered", requestID: nil, webView: nil)
        await fulfillment(of: [restored], timeout: 2)
        withExtendedLifetime(backend) {}
    }
}

private final class FixtureEngine: NativeEngine, @unchecked Sendable {
    let respond: @Sendable (String) -> String
    init(respond: @escaping @Sendable (String) -> String) { self.respond = respond }
    func handle(_ request: String) throws -> String {
        let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any]
        return respond(object?["type"] as? String ?? "")
    }
    func progress() throws -> String { #"{"phase":"restoring"}"# }
    func cancel() throws -> String { #"{"ok":true,"data":false}"# }
    func close() {}
}

import XCTest
@testable import Snapshotter

final class UpdaterTests: XCTestCase {
    func testInstallerPreservesTheOldAppWhenRelaunchFails() throws {
        try runInstaller(launch: "/usr/bin/false", expectedVersion: "old", expectedStatus: 1)
    }

    func testInstallerReplacesAppAndCleansStaging() throws {
        try runInstaller(launch: "/usr/bin/true", expectedVersion: "new", expectedStatus: 0)
    }

    private func runInstaller(launch: String, expectedVersion: String, expectedStatus: Int32) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let old = root.appendingPathComponent("Snapshotter.app")
        let stage = root.appendingPathComponent("staging")
        let new = stage.appendingPathComponent("Snapshotter.app")
        try FileManager.default.createDirectory(at: old, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: new, withIntermediateDirectories: true)
        try "old".write(to: old.appendingPathComponent("version"), atomically: true, encoding: .utf8)
        try "new".write(to: new.appendingPathComponent("version"), atomically: true, encoding: .utf8)
        let script = root.appendingPathComponent("install.sh")
        try UpdateInstaller.script.write(to: script, atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, old.path, new.path, "0", launch]
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, expectedStatus)
        XCTAssertEqual(try String(contentsOf: old.appendingPathComponent("version"), encoding: .utf8), expectedVersion)
        if expectedStatus == 0 { XCTAssertFalse(FileManager.default.fileExists(atPath: stage.path)) }
    }

    func testFailedUpdateCheckDoesNotReportUpToDate() async {
        let checked = expectation(description: "Network error reaches the interface")
        let updater = Updater(fetchRelease: { throw URLError(.notConnectedToInternet) })
        updater.checkNow { result in
            if case .success = result { XCTFail("Failed check was reported as successful") }
            checked.fulfill()
        }
        await fulfillment(of: [checked], timeout: 2)
    }

    func testStableReleaseReplacesItsReleaseCandidate() {
        XCTAssertTrue(Updater.isNewer("1.0.3", than: "1.0.3-rc.1"))
        XCTAssertFalse(Updater.isNewer("1.0.3-rc.2", than: "1.0.3"))
        XCTAssertTrue(Updater.isNewer("1.0.3-rc.10", than: "1.0.3-rc.2"))
        XCTAssertFalse(Updater.isNewer("1.0.3+build.2", than: "1.0.3+build.1"))
        XCTAssertTrue(Updater.isNewer("1.0.4", than: "1.0.3-rc.9"))
    }
}

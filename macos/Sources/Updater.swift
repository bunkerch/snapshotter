import AppKit
import Foundation
import WebKit

/// Describes a pending software update surfaced to the web interface.
struct AvailableUpdate: Codable {
    let currentVersion: String
    let latestVersion: String
    let available: Bool
    let notes: String?
    let url: String?

    /// Bridging representation for JSONSerialization in the native responder.
    var dictionary: [String: Any] {
        var value: [String: Any] = [
            "currentVersion": currentVersion,
            "latestVersion": latestVersion,
            "available": available,
        ]
        if let notes { value["notes"] = notes }
        if let url { value["url"] = url }
        return value
    }
}

/// Checks for and installs Snapshotter releases from GitHub once a day.
///
/// The host owns all networking (GitHub API + release asset download), the
/// version comparison, and the bundle swap/relaunch. The daily cadence is
/// tracked in `UserDefaults`, while the user-facing "always update" preference
/// lives alongside the rest of the preferences in `preferences.json` so the
/// settings screen can read and write it.
final class Updater: @unchecked Sendable {
    static let shared = Updater()

    private let queue = DispatchQueue(label: "app.snapshotter.updater", qos: .utility)
    private let lock = NSLock()
    private let defaults = UserDefaults.standard
    private let webViewReference = WebViewReference(nil)

    private let repositoryOwner = "bunkerch"
    private let repositoryName = "snapshotter"

    private static let lastCheckKey = "app.snapshotter.lastUpdateCheck"
    private static let checkInterval: TimeInterval = 24 * 60 * 60

    private var latest: AvailableUpdate?

    private init() {}

    /// Records the request's web view so the updater can push availability
    /// events into an already-open popover.
    func attach(webView: WKWebView?) {
        DispatchQueue.main.async {
            self.webViewReference.webView = webView
        }
    }

    /// Runs a daily check if the last one is older than 24 hours.
    func checkIfDue() {
        queue.async {
            let now = Date()
            let last = self.defaults.double(forKey: Self.lastCheckKey)
            if last > 0, now.timeIntervalSince1970 - last < Self.checkInterval {
                return
            }
            self.runCheck(autoInstall: true, markChecked: now)
        }
    }

    /// Runs an immediate, user-initiated check. It bypasses the daily throttle
    /// and only reports availability (it never automatically installs) so the
    /// settings screen can show the result without surprising the user.
    func checkNow(completion: @escaping @Sendable (AvailableUpdate) -> Void) {
        queue.async {
            self.runCheck(autoInstall: false, markChecked: Date())
            completion(self.statusSnapshot())
        }
    }

    /// Exposes the latest known update status to the web interface.
    func status(completion: @escaping @Sendable (AvailableUpdate) -> Void) {
        queue.async {
            completion(self.statusSnapshot())
        }
    }

    /// Downloads and installs the pending release, then relaunches the app.
    func install(completion: @escaping @Sendable (Result<Void, Error>) -> Void) {
        queue.async {
            do {
                guard let update = self.statusSnapshot().available ? self.latest : nil else {
                    throw UpdaterError.noUpdateAvailable
                }
                guard !snapshotterOperationInProgress() else {
                    throw UpdaterError.operationInProgress
                }
                try self.downloadAndInstall(update)
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
        }
    }

    // MARK: - Check

    private func runCheck(autoInstall: Bool, markChecked: Date) {
        performCheck(autoInstall: autoInstall)
        defaults.set(markChecked.timeIntervalSince1970, forKey: Self.lastCheckKey)
    }

    private func performCheck(autoInstall: Bool) {
        let currentVersion = currentVersion()
        do {
            guard let latestRelease = try fetchLatestRelease() else {
                self.applyStatus(AvailableUpdate(
                    currentVersion: currentVersion,
                    latestVersion: currentVersion,
                    available: false,
                    notes: nil,
                    url: nil
                ))
                return
            }
            let version = latestRelease.tagName.replacingOccurrences(of: "^v", with: "", options: .regularExpression)
            guard Self.isNewer(version, than: currentVersion) else {
                self.applyStatus(AvailableUpdate(
                    currentVersion: currentVersion,
                    latestVersion: currentVersion,
                    available: false,
                    notes: nil,
                    url: nil
                ))
                return
            }
            let downloadURL = latestRelease.assets
                .first { $0.name == "Snapshotter-\(version)-macOS.zip" }?
                .browserDownloadURL
            let update = AvailableUpdate(
                currentVersion: currentVersion,
                latestVersion: version,
                available: true,
                notes: latestRelease.body.map { String($0.prefix(500)) },
                url: downloadURL?.absoluteString
            )
            self.applyStatus(update)
            if autoInstall, self.alwaysUpdateEnabled(), !snapshotterOperationInProgress() {
                do {
                    try self.downloadAndInstall(update)
                } catch {
                    // Fall back to prompting the user in the interface.
                    self.push(update)
                }
            } else {
                self.push(update)
            }
        } catch {
            // Transient network/API failures are retried on the next daily pass.
            self.applyStatus(AvailableUpdate(
                currentVersion: currentVersion,
                latestVersion: currentVersion,
                available: false,
                notes: nil,
                url: nil
            ))
        }
    }

    private func applyStatus(_ update: AvailableUpdate) {
        lock.lock()
        latest = update
        lock.unlock()
    }

    private func statusSnapshot() -> AvailableUpdate {
        let currentVersion = currentVersion()
        lock.lock()
        defer { lock.unlock() }
        if let latest, latest.available {
            return latest
        }
        return AvailableUpdate(
            currentVersion: currentVersion,
            latestVersion: currentVersion,
            available: false,
            notes: nil,
            url: nil
        )
    }

    private func push(_ update: AvailableUpdate) {
        guard let encoded = try? JSONEncoder().encode(update),
              let json = String(data: encoded, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webViewReference.webView?.evaluateJavaScript("window.__snapshotterUpdate?.(\(json))")
        }
    }

    // MARK: - Networking

    private func fetchLatestRelease() throws -> GitHubRelease? {
        guard let url = URL(string: "https://api.github.com/repos/\(repositoryOwner)/\(repositoryName)/releases/latest") else {
            throw UpdaterError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Snapshotter/\(currentVersion())", forHTTPHeaderField: "User-Agent")
        let (data, response) = try loadSynchronously(request)
        guard let http = response as? HTTPURLResponse else {
            throw UpdaterError.invalidResponse
        }
        if http.statusCode == 404 {
            return nil
        }
        guard (200..<300).contains(http.statusCode) else {
            throw UpdaterError.downloadFailed("HTTP \(http.statusCode)")
        }
        return try JSONDecoder().decode(GitHubRelease.self, from: data)
    }

    private func loadSynchronously(_ request: URLRequest) throws -> (Data, URLResponse) {
        let semaphore = DispatchSemaphore(value: 0)
        let result = UpdateResultBox(.failure(UpdaterError.downloadFailed("No response")))
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                result.value = .failure(error)
            } else if let data, let response {
                result.value = .success((data, response))
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 120)
        if task.state != .completed {
            task.cancel()
        }
        return try result.value.get()
    }

    // MARK: - Install

    private func downloadAndInstall(_ update: AvailableUpdate) throws {
        guard let urlString = update.url, let url = URL(string: urlString) else {
            throw UpdaterError.assetNotFound
        }
        let fileManager = FileManager.default
        let tempDirectory = fileManager.temporaryDirectory.appendingPathComponent("SnapshotterUpdate-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: tempDirectory) }

        let zipURL = tempDirectory.appendingPathComponent("Snapshotter-\(update.latestVersion)-macOS.zip")
        let (data, response) = try loadSynchronously(URLRequest(url: url))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw UpdaterError.downloadFailed("Release asset download failed")
        }
        try data.write(to: zipURL)

        let extractURL = tempDirectory.appendingPathComponent("extracted", isDirectory: true)
        try fileManager.createDirectory(at: extractURL, withIntermediateDirectories: true)
        let output = try runProcess(executable: URL(fileURLWithPath: "/usr/bin/ditto"), arguments: ["-x", "-k", zipURL.path, extractURL.path])
        guard output.status == 0 else {
            throw UpdaterError.unzipFailed(output.output)
        }

        guard let newApp = try? fileManager.contentsOfDirectory(at: extractURL, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension == "app" }) else {
            throw UpdaterError.assetNotFound
        }
        let signature = try runProcess(executable: URL(fileURLWithPath: "/usr/bin/codesign"), arguments: ["--verify", "--deep", "--strict", "--verbose=2", newApp.path])
        guard signature.status == 0 else {
            throw UpdaterError.signatureCheckFailed(signature.output)
        }

        try replaceRunningApp(with: newApp)
    }

    private func replaceRunningApp(with downloadedApp: URL) throws {
        let runningApp = Bundle.main.bundleURL
        // Refuse to swap a developable build; a real packaged release is signed.
        guard let signature = try? runProcess(executable: URL(fileURLWithPath: "/usr/bin/codesign"), arguments: ["--verify", "--deep", "--strict", runningApp.path]),
              signature.status == 0 else {
            throw UpdaterError.signatureCheckFailed("Refusing to update an unsigned development build")
        }

        let script = """
        #!/bin/sh
        set -e
        old="$1"
        new="$2"
        pid="$3"
        while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
        rm -rf "$old"
        mv "$new" "$old"
        open "$old"
        """
        let scriptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("SnapshotterUpdate-\(UUID().uuidString).sh")
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: scriptURL) }

        let wrapper = try runProcess(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                "nohup sh \(shellQuote(scriptURL.path)) \(shellQuote(runningApp.path)) \(shellQuote(downloadedApp.path)) \(ProcessInfo.processInfo.processIdentifier) >/dev/null 2>&1 &",
            ]
        )
        guard wrapper.status == 0 else {
            throw UpdaterError.unzipFailed(wrapper.output)
        }
        // The detached helper swaps the bundle and relaunches; terminate now.
        exit(0)
    }

    // MARK: - Preferences

    private func alwaysUpdateEnabled() -> Bool {
        let fileURL = try? EngineBridge.preferencesURL()
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let object = try? JSONDecoder().decode(UpdatePreferences.self, from: data) else {
            return false
        }
        return object.alwaysUpdate ?? false
    }

    // MARK: - Version helpers

    private func currentVersion() -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return value?.isEmpty == false ? value! : "0.0.0"
    }

    private static func isNewer(_ candidate: String, than current: String) -> Bool {
        let candidateParts = versionParts(candidate)
        let currentParts = versionParts(current)
        let count = max(candidateParts.count, currentParts.count)
        for index in 0..<count {
            let a = index < candidateParts.count ? candidateParts[index] : 0
            let b = index < currentParts.count ? currentParts[index] : 0
            if a > b { return true }
            if a < b { return false }
        }
        return false
    }

    private static func versionParts(_ version: String) -> [Int] {
        return version
            .replacingOccurrences(of: "-", with: ".")
            .split(separator: ".")
            .map {
                let integer = $0.prefix(while: { $0.isNumber })
                return Int(integer) ?? 0
            }
    }

    // MARK: - Process helpers

    private func runProcess(executable: URL, arguments: [String]) throws -> (status: Int32, output: String) {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let outputData = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: outputData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return (process.terminationStatus, output)
    }

    private func shellQuote(_ value: String) -> String {
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

private enum UpdaterError: LocalizedError {
    case noUpdateAvailable
    case invalidResponse
    case assetNotFound
    case missingBundleURL
    case operationInProgress
    case downloadFailed(String)
    case unzipFailed(String)
    case signatureCheckFailed(String)

    var errorDescription: String? {
        switch self {
        case .noUpdateAvailable:
            return "No update is available"
        case .invalidResponse:
            return "The update service returned an invalid response"
        case .assetNotFound:
            return "The release asset could not be found"
        case .missingBundleURL:
            return "The running application bundle could not be located"
        case .operationInProgress:
            return "Wait for the running operation to finish before updating"
        case let .downloadFailed(reason):
            return "The update download failed: \(reason)"
        case let .unzipFailed(reason):
            return "The update archive could not be extracted: \(reason)"
        case let .signatureCheckFailed(reason):
            return "The update failed code-signature verification: \(reason)"
        }
    }
}

private struct UpdatePreferences: Decodable {
    let alwaysUpdate: Bool?
}

private final class UpdateResultBox: @unchecked Sendable {
    var value: Result<(Data, URLResponse), Error>

    init(_ value: Result<(Data, URLResponse), Error>) {
        self.value = value
    }
}

private struct GitHubRelease: Decodable {
    let tagName: String
    let body: String?
    let assets: [GitHubAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case body
        case assets
    }
}

private struct GitHubAsset: Decodable {
    let name: String
    let browserDownloadURL: URL

    enum CodingKeys: String, CodingKey {
        case name
        case browserDownloadURL = "browser_download_url"
    }
}

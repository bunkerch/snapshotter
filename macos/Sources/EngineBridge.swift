import Darwin
import Foundation

enum EngineBridgeError: LocalizedError {
    case libraryNotFound
    case symbolMissing(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .libraryNotFound:
            "Snapshotter engine library is missing. Run `make engine` first."
        case let .symbolMissing(name):
            "Snapshotter engine symbol \(name) is missing."
        case .invalidResponse:
            "Snapshotter engine returned an invalid response."
        }
    }
}

final class EngineBridge: @unchecked Sendable {
    private typealias OpenFunction = @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
    private typealias HandleFunction = @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
    private typealias ProgressFunction = @convention(c) () -> UnsafeMutablePointer<CChar>?
    private typealias CloseFunction = @convention(c) () -> Void
    private typealias FreeFunction = @convention(c) (UnsafeMutableRawPointer?) -> Void

    private let library: UnsafeMutableRawPointer
    private let handleRequest: HandleFunction
    private let readProgress: ProgressFunction
    private let closeEngine: CloseFunction
    private let freeResponse: FreeFunction

    init() throws {
        guard let libraryURL = Self.libraryURL(),
              let library = dlopen(libraryURL.path, RTLD_NOW | RTLD_LOCAL) else {
            throw EngineBridgeError.libraryNotFound
        }
        self.library = library

        let openEngine: OpenFunction = try Self.loadSymbol("SnapshotterOpen", from: library)
        handleRequest = try Self.loadSymbol("SnapshotterHandle", from: library)
        readProgress = try Self.loadSymbol("SnapshotterProgress", from: library)
        closeEngine = try Self.loadSymbol("SnapshotterClose", from: library)
        freeResponse = try Self.loadSymbol("SnapshotterFree", from: library)

        let supportDirectory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Snapshotter", isDirectory: true)
        try FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true)
        let preferencesPath = supportDirectory.appendingPathComponent("preferences.json").path
        _ = try consume(preferencesPath.withCString { openEngine($0) })
    }

    deinit {
        closeEngine()
        dlclose(library)
    }

    func handle(_ request: String) throws -> String {
        try consume(request.withCString { handleRequest($0) })
    }

    func progress() throws -> String {
        try consume(readProgress())
    }

    private func consume(_ pointer: UnsafeMutablePointer<CChar>?) throws -> String {
        guard let pointer else { throw EngineBridgeError.invalidResponse }
        defer { freeResponse(UnsafeMutableRawPointer(pointer)) }
        return String(cString: pointer)
    }

    private static func loadSymbol<T>(_ name: String, from library: UnsafeMutableRawPointer) throws -> T {
        guard let symbol = dlsym(library, name) else {
            throw EngineBridgeError.symbolMissing(name)
        }
        return unsafeBitCast(symbol, to: T.self)
    }

    private static func libraryURL() -> URL? {
        let environment = ProcessInfo.processInfo.environment["SNAPSHOTTER_ENGINE_LIBRARY"]
        let candidates = [
            environment.map(URL.init(fileURLWithPath:)),
            Bundle.main.privateFrameworksURL?.appendingPathComponent("libsnapshotter.dylib"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("engine/build/libsnapshotter.dylib"),
        ].compactMap { $0 }
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }
}

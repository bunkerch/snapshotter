import AppKit
import ServiceManagement
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSPopoverDelegate {
    private let popover = NSPopover()
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NotificationCenter.default.addObserver(self, selector: #selector(engineActivityChanged(_:)), name: .engineActivityChanged, object: nil)
        configureMainMenu()
        configurePopover()
        configureStatusItem()
    }

    @objc private func engineActivityChanged(_ notification: Notification) {
        guard let button = statusItem?.button,
              let active = notification.userInfo?["active"] as? Bool else { return }
        if active {
            button.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "Backup running")
            button.image?.isTemplate = true
            guard let layer = centeredRotationLayer(for: button) else { return }
            let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
            rotation.fromValue = 0
            rotation.toValue = Double.pi * 2
            rotation.duration = 1.25
            rotation.repeatCount = .infinity
            layer.add(rotation, forKey: "snapshotter.backup.rotation")
        } else {
            button.layer?.removeAnimation(forKey: "snapshotter.backup.rotation")
            button.image = NSImage(systemSymbolName: "shield.checkered", accessibilityDescription: "Snapshotter")
            button.image?.isTemplate = true
        }
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")

        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }

    private func configurePopover() {
        let configuration = WKWebViewConfiguration()
        let packaged = Bundle.main.bundleURL.pathExtension == "app" ? "true" : "false"
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.__snapshotterPackaged = \(packaged)",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(self, name: "resticNative")

        let controller = WebViewController(configuration: configuration)
        popover.contentViewController = controller
        popover.contentSize = NSSize(width: 390, height: 540)
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
    }

    private func configureStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem.button else { return }
        button.image = NSImage(systemSymbolName: "shield.checkered", accessibilityDescription: "Snapshotter")
        button.image?.isTemplate = true
        button.target = self
        button.action = #selector(togglePopover)
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    private func centeredRotationLayer(for view: NSView) -> CALayer? {
        view.wantsLayer = true
        guard let layer = view.layer else { return nil }

        let frame = layer.frame
        layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer.position = CGPoint(x: frame.midX, y: frame.midY)
        return layer
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            showStatusMenu(from: button)
            return
        }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            openPopover()
        }
    }

    @objc private func openPopover() {
        guard let button = statusItem.button else { return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if let window = popover.contentViewController?.view.window {
            window.isOpaque = false
            window.backgroundColor = .clear
            window.makeKey()
        }
    }

    private func showStatusMenu(from button: NSStatusBarButton) {
        popover.performClose(nil)
        let menu = NSMenu()
        let open = menu.addItem(withTitle: "Open Snapshotter", action: #selector(openPopover), keyEquivalent: "")
        open.target = self
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Quit Snapshotter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "resticNative", message.frameInfo.isMainFrame,
              let raw = message.body as? String,
              let data = raw.data(using: .utf8),
              let request = try? JSONDecoder().decode(BridgeRequest.self, from: data) else { return }

        Updater.shared.attach(webView: message.webView)
        switch request.type {
        case "app.quit": NSApp.terminate(nil)
        case "update.status": Backend.shared.updateStatus(requestID: request.id, webView: message.webView)
        case "update.check": Backend.shared.checkForUpdate(requestID: request.id, webView: message.webView)
        case "update.install": Backend.shared.installUpdate(requestID: request.id, webView: message.webView)
        case "source.choose": chooseSourceFolder(request: request, webView: message.webView)
        case "repository.configure.choose": chooseRepository(request: request, webView: message.webView)
        case "repository.configure.remote": configureRemoteRepository(request: request, webView: message.webView)
        case "repository.unlock": unlockRepository(request: request, raw: raw, webView: message.webView)
        case "repository.disconnect": disconnectRepository(request: request, raw: raw, webView: message.webView)
        case "onepassword.accounts": Backend.shared.discoverOnePasswordAccounts(requestID: request.id, webView: message.webView)
        case "snapshot.restore.choose": chooseRestoreDestination(request: request, webView: message.webView)
        case "snapshot.metadata": Backend.shared.fail("Snapshot metadata is only available to the native restore flow", requestID: request.id, webView: message.webView)
        case "operation.cancel": Backend.shared.cancel(requestID: request.id, webView: message.webView)
        case "url.open": openExternalURL(request.payload?.url, requestID: request.id, webView: message.webView)
        case "launchAtLogin.set": setLaunchAtLogin(
            enabled: request.payload?.enabled == true,
            request: raw,
            requestID: request.id,
            webView: message.webView
        )
        default: Backend.shared.handle(raw, requestID: request.id, webView: message.webView)
        }
    }

    private func chooseRestoreDestination(request: BridgeRequest, webView: WKWebView?) {
        guard let snapshotID = request.payload?.snapshotID,
              let path = request.payload?.path else {
            Backend.shared.fail("Snapshot and path are required", requestID: request.id, webView: webView)
            return
        }
        popover.performClose(nil)
        let panel = NSOpenPanel()
        panel.title = "Choose Restore Destination"
        panel.prompt = "Restore Here"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { response in
            defer { self.openPopover() }
            guard response == .OK, let destination = panel.url else {
                Backend.shared.fail("Restore cancelled", requestID: request.id, webView: webView)
                return
            }
            Backend.shared.restoreSnapshot(
                snapshotID: snapshotID,
                path: path,
                destination: destination.path,
                requestID: request.id,
                webView: webView
            )
        }
        panel.makeKeyAndOrderFront(nil)
    }

    private func openExternalURL(_ value: String?, requestID: String?, webView: WKWebView?) {
        guard let value, let url = URL(string: value), url.scheme == "https" else {
            Backend.shared.fail("The license URL is invalid", requestID: requestID, webView: webView)
            return
        }
        if NSWorkspace.shared.open(url) {
            Backend.shared.succeed(requestID: requestID, webView: webView)
        } else {
            Backend.shared.fail("macOS could not open the license URL", requestID: requestID, webView: webView)
        }
    }

    private func chooseSourceFolder(request: BridgeRequest, webView: WKWebView?) {
        popover.performClose(nil)
        let panel = NSOpenPanel()
        panel.title = "Choose Folders to Back Up"
        panel.prompt = "Add"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.canCreateDirectories = false
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { response in
            defer { self.openPopover() }
            guard response == .OK else {
                Backend.shared.refresh(requestID: request.id, webView: webView)
                return
            }
            Backend.shared.addSources(panel.urls, requestID: request.id, webView: webView)
        }
        panel.makeKeyAndOrderFront(nil)
    }

    private func chooseRepository(request: BridgeRequest, webView: WKWebView?) {
        guard let name = request.payload?.name, !name.isEmpty,
              let password = request.payload?.password,
              !password.isEmpty || request.payload?.secretStorage?.itemID?.isEmpty == false else {
            Backend.shared.fail("A name and password are required", requestID: request.id, webView: webView)
            return
        }
        popover.performClose(nil)
        let panel = NSOpenPanel()
        panel.title = "Choose Backup Destination"
        panel.prompt = "Choose"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        if let savedLocation = request.payload?.location, !savedLocation.isEmpty,
           FileManager.default.fileExists(atPath: savedLocation) {
            panel.directoryURL = URL(fileURLWithPath: savedLocation, isDirectory: true)
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { response in
            defer { self.openPopover() }
            guard response == .OK, let destination = panel.url else {
                Backend.shared.refresh(requestID: request.id, webView: webView)
                return
            }
            Backend.shared.configureRepository(
                name: name,
                kind: "local",
                location: destination.path,
                password: password,
                credentials: [:],
                secretStorage: request.payload?.secretStorage,
                requestID: request.id,
                webView: webView
            )
        }
        panel.makeKeyAndOrderFront(nil)
    }

    private func configureRemoteRepository(request: BridgeRequest, webView: WKWebView?) {
        guard let name = request.payload?.name, !name.isEmpty,
              let kind = request.payload?.kind, ["s3", "sftp", "rest"].contains(kind),
              let location = request.payload?.location, !location.isEmpty,
              let password = request.payload?.password,
              !password.isEmpty || request.payload?.secretStorage?.itemID?.isEmpty == false else {
            Backend.shared.fail("Name, destination, and encryption password are required", requestID: request.id, webView: webView)
            return
        }
        Backend.shared.configureRepository(
            name: name,
            kind: kind,
            location: location,
            password: password,
            credentials: request.payload?.credentials ?? [:],
            secretStorage: request.payload?.secretStorage,
            requestID: request.id,
            webView: webView
        )
    }

    private func unlockRepository(request: BridgeRequest, raw: String, webView: WKWebView?) {
        guard let repositoryID = request.payload?.repositoryID else {
            Backend.shared.fail("Repository identifier is missing", requestID: request.id, webView: webView)
            return
        }
        if request.payload?.secretStorage?.provider == "onepassword" {
            Backend.shared.handle(raw, requestID: request.id, webView: webView)
        } else {
            Backend.shared.unlockRepository(repositoryID: repositoryID, requestID: request.id, webView: webView)
        }
    }

    private func disconnectRepository(request: BridgeRequest, raw: String, webView: WKWebView?) {
        guard let repositoryID = request.payload?.repositoryID else {
            Backend.shared.fail("Repository identifier is missing", requestID: request.id, webView: webView)
            return
        }
        if request.payload?.secretStorage?.provider == "onepassword" {
            Backend.shared.handle(raw, requestID: request.id, webView: webView)
        } else {
            Backend.shared.disconnectRepository(repositoryID: repositoryID, request: raw, requestID: request.id, webView: webView)
        }
    }

    private func setLaunchAtLogin(enabled: Bool, request: String, requestID: String?, webView: WKWebView?) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            Backend.shared.handle(request, requestID: requestID, webView: webView)
        } catch {
            Backend.shared.fail(error.localizedDescription, requestID: requestID, webView: webView)
        }
    }
}

private final class WebViewController: NSViewController {
    private let configuration: WKWebViewConfiguration

    init(configuration: WKWebViewConfiguration) {
        self.configuration = configuration
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func loadView() {
        let materialView = NSVisualEffectView()
        materialView.material = .popover
        materialView.blendingMode = .behindWindow
        materialView.state = .active

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        materialView.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: materialView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: materialView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: materialView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: materialView.bottomAnchor),
        ])
        view = materialView

        #if DEBUG
        webView.load(URLRequest(url: URL(string: "http://localhost:4173")!))
        #else
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            fatalError("Bundled web interface is missing")
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        #endif
    }
}

private struct BridgeRequest: Decodable, Sendable {
    let id: String?
    let type: String
    let payload: BridgePayload?
}

private struct BridgePayload: Decodable, Sendable {
    let enabled: Bool?
    let name: String?
    let password: String?
    let repositoryID: String?
    let url: String?
    let snapshotID: String?
    let path: String?
    let kind: String?
    let location: String?
    let credentials: [String: String]?
    let secretStorage: SecretStoragePayload?
}

private struct SecretStoragePayload: Decodable, Sendable {
    let provider: String
    let account: String?
    let vaultID: String?
    let itemID: String?

    var dictionary: [String: String] {
        var value = ["provider": provider]
        if let account { value["account"] = account }
        if let vaultID { value["vaultID"] = vaultID }
        if let itemID { value["itemID"] = itemID }
        return value
    }
}

private final class Backend: @unchecked Sendable {
    static let shared = Backend()
    private let queue = DispatchQueue(label: "app.snapshotter.engine", qos: .utility)
    private let progressQueue = DispatchQueue(label: "app.snapshotter.progress", qos: .utility)
    private let operationLock = NSLock()
    private let keychain = KeychainStore()
    private let engine: Result<EngineBridge, Error>
    private let webViewReference = WebViewReference(nil)
    private var scheduleTimer: DispatchSourceTimer?
    private var pendingOperations = 0

    private init() {
        engine = Result { try EngineBridge() }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 10, repeating: 60)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            Updater.shared.checkIfDue()
            self.beginOperation()
            Self.setActivity(true)
            let progressTimer = self.startProgressUpdates(reference: self.webViewReference)
            defer {
                progressTimer?.cancel()
                Self.setActivity(false)
                self.endOperation()
            }
            guard let due = try? self.engine.get().handle(#"{"type":"schedule.due"}"#),
                  Self.responseBoolean(due) else { return }
            guard let request = try? self.preparedBackupRequest(#"{"type":"backup.start"}"#) else { return }
            _ = try? self.engine.get().handle(request)
        }
        timer.resume()
        scheduleTimer = timer
    }

    func handle(_ rawRequest: String, requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        DispatchQueue.main.async {
            self.webViewReference.webView = webView
        }
        let showsActivity = Self.requestType(rawRequest).map { $0 == "backup.start" || $0 == "schedule.tick" } == true
        let cancellable = Self.requestType(rawRequest).map(Self.isCancellable) == true
        if cancellable { beginOperation() }
        queue.async {
            if showsActivity { Self.setActivity(true) }
            let progressTimer = showsActivity ? self.startProgressUpdates(reference: reference) : nil
            defer {
                progressTimer?.cancel()
                if showsActivity { Self.setActivity(false) }
                if cancellable { self.endOperation() }
            }
            do {
                let request = showsActivity ? try self.preparedBackupRequest(rawRequest) : rawRequest
                let response = try self.engine.get().handle(request)
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    func cancel(requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        progressQueue.async {
            self.attemptCancel(requestID: requestID, reference: reference)
        }
    }

    private func attemptCancel(requestID: String?, reference: WebViewReference) {
        do {
            let response = try engine.get().cancel()
            if Self.cancelledOperation(response) || !hasPendingOperation() {
                Self.respond(response, requestID: requestID, reference: reference)
                return
            }
            progressQueue.asyncAfter(deadline: .now() + .milliseconds(10)) {
                self.attemptCancel(requestID: requestID, reference: reference)
            }
        } catch {
            Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
        }
    }

    private func beginOperation() {
        operationLock.lock()
        pendingOperations += 1
        operationLock.unlock()
    }

    private func endOperation() {
        operationLock.lock()
        pendingOperations -= 1
        operationLock.unlock()
    }

    private func hasPendingOperation() -> Bool {
        operationLock.lock()
        defer { operationLock.unlock() }
        return pendingOperations > 0
    }

    static func operationInProgress() -> Bool {
        shared.hasPendingOperation()
    }

    private func startProgressUpdates(reference: WebViewReference) -> DispatchSourceTimer? {
        guard reference.webView != nil else { return nil }
        let timer = DispatchSource.makeTimerSource(queue: progressQueue)
        timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(250), leeway: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            guard let self,
                  let progress = try? self.engine.get().progress() else { return }
            DispatchQueue.main.async {
                reference.webView?.evaluateJavaScript("window.__snapshotterProgress?.(\(progress))")
            }
        }
        timer.resume()
        return timer
    }

    func refresh(requestID: String?, webView: WKWebView?) {
        handle(#"{"type":"state.get"}"#, requestID: requestID, webView: webView)
    }

    func addSources(_ urls: [URL], requestID: String?, webView: WKWebView?) {
        let paths = urls.map(\.path)
        guard let data = try? JSONSerialization.data(withJSONObject: ["type": "source.add", "payload": ["paths": paths]]),
              let request = String(data: data, encoding: .utf8) else { return }
        handle(request, requestID: requestID, webView: webView)
    }

    func configureRepository(name: String, kind: String, location: String, password: String, credentials: [String: String], secretStorage: SecretStoragePayload?, requestID: String?, webView: WKWebView?) {
        let repositoryID = UUID().uuidString.lowercased()
        var repository: [String: Any] = ["id": repositoryID, "name": name, "kind": kind, "location": location]
        if let secretStorage {
            repository["secretStorage"] = secretStorage.dictionary
        }
        let payload: [String: Any] = [
            "type": "repository.configure",
            "payload": [
                "repository": repository,
                "credentials": credentials,
                "password": password,
            ],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let request = String(data: data, encoding: .utf8) else { return }
        let reference = WebViewReference(webView)
        queue.async {
            do {
                let response = try self.engine.get().handle(request)
                if Self.isSuccessful(response) {
                    if secretStorage == nil {
                        try self.keychain.savePassword(password, repositoryID: repositoryID)
                        let credentialsData = try JSONSerialization.data(withJSONObject: credentials)
                        guard let encodedCredentials = String(data: credentialsData, encoding: .utf8) else {
                            throw EngineBridgeError.invalidResponse
                        }
                        try self.keychain.saveCredentials(encodedCredentials, repositoryID: repositoryID)
                    }
                }
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    func unlockRepository(repositoryID: String, requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        queue.async {
            do {
                guard let password = try self.keychain.password(repositoryID: repositoryID) else {
                    throw NSError(domain: "Snapshotter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Repository password was not found in Keychain"])
                }
                let encodedCredentials = try self.keychain.credentials(repositoryID: repositoryID) ?? "{}"
                let credentialsData = Data(encodedCredentials.utf8)
                let credentials = try JSONSerialization.jsonObject(with: credentialsData) as? [String: String] ?? [:]
                let payload = ["type": "repository.unlock", "payload": ["password": password, "credentials": credentials]] as [String: Any]
                let data = try JSONSerialization.data(withJSONObject: payload)
                guard let request = String(data: data, encoding: .utf8) else { throw EngineBridgeError.invalidResponse }
                let response = try self.engine.get().handle(request)
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    func disconnectRepository(repositoryID: String, request: String, requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        queue.async {
            do {
                let response = try self.engine.get().handle(request)
                if Self.isSuccessful(response) {
                    try self.keychain.removePassword(repositoryID: repositoryID)
                    try self.keychain.removeCredentials(repositoryID: repositoryID)
                }
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    func restoreSnapshot(snapshotID: String, path: String, destination: String, requestID: String?, webView: WKWebView?) {
        let payload: [String: Any] = [
            "type": "snapshot.restore",
            "payload": ["snapshotID": snapshotID, "path": path, "destination": destination],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let request = String(data: data, encoding: .utf8) else { return }
        let reference = WebViewReference(webView)
        beginOperation()
        queue.async {
            defer { self.endOperation() }
            do {
                let metadataPayload: [String: Any] = ["type": "snapshot.metadata", "payload": ["snapshotID": snapshotID]]
                let metadataData = try JSONSerialization.data(withJSONObject: metadataPayload)
                guard let metadataRequest = String(data: metadataData, encoding: .utf8) else { throw EngineBridgeError.invalidResponse }
                let metadataResponse = try? self.engine.get().handle(metadataRequest)
                let response = try self.engine.get().handle(request)
                if Self.isSuccessful(response),
                   (destination as NSString).standardizingPath == "/",
                   let metadataResponse {
                    try self.restoreApplicationPasswords(from: metadataResponse, selectedPath: path)
                }
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    func fail(_ message: String, requestID: String?, webView: WKWebView?) {
        let error = NSError(domain: "Snapshotter", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        Self.respond(Self.errorResponse(error), requestID: requestID, reference: WebViewReference(webView))
    }

    func discoverOnePasswordAccounts(requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        queue.async {
            let accounts = OnePasswordAccountDiscovery.accounts().map { ["id": $0.id, "name": $0.name] }
            Self.respondData(accounts, requestID: requestID, reference: reference)
        }
    }

    func succeed(requestID: String?, webView: WKWebView?) {
        Self.respond(#"{"ok":true}"#, requestID: requestID, reference: WebViewReference(webView))
    }

    func updateStatus(requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        Updater.shared.status { update in
            Self.respondData(update.dictionary, requestID: requestID, reference: reference)
        }
    }

    func checkForUpdate(requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        Updater.shared.checkNow { update in
            Self.respondData(update.dictionary, requestID: requestID, reference: reference)
        }
    }

    func installUpdate(requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        Updater.shared.install { result in
            switch result {
            case .success:
                Self.respond(#"{"ok":true}"#, requestID: requestID, reference: reference)
            case let .failure(error):
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
    }

    private static func respondData(_ data: Any, requestID: String?, reference: WebViewReference) {
        let payload = ["ok": true, "data": data] as [String: Any]
        guard let encoded = try? JSONSerialization.data(withJSONObject: payload),
              let response = String(data: encoded, encoding: .utf8) else { return }
        respond(response, requestID: requestID, reference: reference)
    }

    private static func respond(_ response: String, requestID: String?, reference: WebViewReference) {
        guard let requestID,
              let idData = try? JSONEncoder().encode(requestID),
              let encodedID = String(data: idData, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            reference.webView?.evaluateJavaScript("window.__snapshotterResolve?.(\(encodedID), \(response))")
        }
    }

    private static func errorResponse(_ error: Error) -> String {
        let payload = ["ok": false, "error": error.localizedDescription] as [String: Any]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            return #"{"ok":false,"error":"Native engine error"}"#
        }
        return String(data: data, encoding: .utf8) ?? #"{"ok":false,"error":"Native engine error"}"#
    }

    private static func isSuccessful(_ response: String) -> Bool {
        guard let data = response.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["ok"] as? Bool == true
    }

    private func preparedBackupRequest(_ rawRequest: String) throws -> String {
        let requirementsResponse = try engine.get().handle(#"{"type":"backup.requirements"}"#)
        guard let responseData = requirementsResponse.data(using: .utf8),
              let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any],
              response["ok"] as? Bool == true,
              let applications = response["data"] as? [[String: Any]],
              let requestData = rawRequest.data(using: .utf8),
              var request = try JSONSerialization.jsonObject(with: requestData) as? [String: Any] else {
            throw EngineBridgeError.invalidResponse
        }
        var captured: [String: [[String: String]]] = [:]
        for application in applications {
            guard let id = application["id"] as? String,
                  let items = application["keychainItems"] as? [[String: Any]] else { continue }
            for item in items {
                guard let service = item["service"] as? String,
                      let account = item["account"] as? String,
                      let value = try? keychain.applicationPassword(service: service, account: account) else { continue }
                captured[id, default: []].append(["service": service, "account": account, "value": value])
            }
        }
        var payload = request["payload"] as? [String: Any] ?? [:]
        payload["applicationKeychainItems"] = captured
        request["payload"] = payload
        let encoded = try JSONSerialization.data(withJSONObject: request)
        guard let result = String(data: encoded, encoding: .utf8) else {
            throw EngineBridgeError.invalidResponse
        }
        return result
    }

    private func restoreApplicationPasswords(from metadataResponse: String, selectedPath: String) throws {
        guard let encoded = metadataResponse.data(using: .utf8),
              let response = try JSONSerialization.jsonObject(with: encoded) as? [String: Any],
              response["ok"] as? Bool == true,
              let metadata = response["data"] as? [String: Any],
              let applications = metadata["applications"] as? [[String: Any]] else { return }
        let selected = (selectedPath as NSString).standardizingPath
        for application in applications {
            guard application["id"] as? String == "chrome",
                  let paths = application["paths"] as? [String],
                  paths.contains(where: { path in
                      let applicationPath = (path as NSString).standardizingPath
                      return selected == "/" || applicationPath == selected
                          || applicationPath.hasPrefix(selected + "/")
                          || selected.hasPrefix(applicationPath + "/")
                  }),
                  let items = application["keychainItems"] as? [[String: Any]] else { continue }
            for item in items {
                guard item["service"] as? String == "Chrome Safe Storage",
                      item["account"] as? String == "Chrome",
                      let value = item["value"] as? String else { continue }
                try keychain.saveApplicationPassword(value, service: "Chrome Safe Storage", account: "Chrome")
            }
        }
    }

    private static func responseBoolean(_ response: String) -> Bool {
        guard let data = response.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["ok"] as? Bool == true && object["data"] as? Bool == true
    }

    private static func cancelledOperation(_ response: String) -> Bool {
        guard let data = response.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["ok"] as? Bool == true && object["data"] as? Bool == true
    }

    private static func requestType(_ request: String) -> String? {
        guard let data = request.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["type"] as? String
    }

    private static func isCancellable(_ requestType: String) -> Bool {
        [
            "backup.start",
            "schedule.tick",
            "repository.check",
            "repository.repairIndex",
            "snapshot.restore",
            "snapshot.delete",
        ].contains(requestType)
    }

    private static func setActivity(_ active: Bool) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .engineActivityChanged, object: nil, userInfo: ["active": active])
        }
    }
}

/// Reports whether any engine operation (backup, restore, maintenance) is
/// running so the updater can avoid relaunching mid-operation.
func snapshotterOperationInProgress() -> Bool {
    Backend.operationInProgress()
}

final class WebViewReference: @unchecked Sendable {
    weak var webView: WKWebView?

    init(_ webView: WKWebView?) {
        self.webView = webView
    }
}

private extension Notification.Name {
    static let engineActivityChanged = Notification.Name("app.snapshotter.engineActivityChanged")
}

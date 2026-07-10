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
            button.wantsLayer = true
            let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
            rotation.fromValue = 0
            rotation.toValue = Double.pi * 2
            rotation.duration = 1.25
            rotation.repeatCount = .infinity
            button.layer?.add(rotation, forKey: "snapshotter.backup.rotation")
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
        guard message.name == "resticNative", let raw = message.body as? String,
              let data = raw.data(using: .utf8),
              let request = try? JSONDecoder().decode(BridgeRequest.self, from: data) else { return }

        switch request.type {
        case "app.quit": NSApp.terminate(nil)
        case "source.choose": chooseSourceFolder(request: request, webView: message.webView)
        case "repository.create.choose": chooseRepository(request: request, webView: message.webView)
        case "repository.unlock": unlockRepository(request: request, webView: message.webView)
        case "launchAtLogin.set": setLaunchAtLogin(
            enabled: request.payload?.enabled == true,
            request: raw,
            requestID: request.id,
            webView: message.webView
        )
        default: Backend.shared.handle(raw, requestID: request.id, webView: message.webView)
        }
    }

    private func chooseSourceFolder(request: BridgeRequest, webView: WKWebView?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.begin { response in
            guard response == .OK else {
                Backend.shared.refresh(requestID: request.id, webView: webView)
                return
            }
            Backend.shared.addSources(panel.urls, requestID: request.id, webView: webView)
        }
    }

    private func chooseRepository(request: BridgeRequest, webView: WKWebView?) {
        guard let name = request.payload?.name, !name.isEmpty,
              let password = request.payload?.password, !password.isEmpty else {
            Backend.shared.fail("A name and password are required", requestID: request.id, webView: webView)
            return
        }
        let panel = NSOpenPanel()
        panel.title = "Choose Backup Destination"
        panel.prompt = "Choose"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.begin { response in
            guard response == .OK, let destination = panel.url else {
                Backend.shared.refresh(requestID: request.id, webView: webView)
                return
            }
            Backend.shared.createRepository(
                name: name,
                location: destination.path,
                password: password,
                requestID: request.id,
                webView: webView
            )
        }
    }

    private func unlockRepository(request: BridgeRequest, webView: WKWebView?) {
        guard let repositoryID = request.payload?.repositoryID else {
            Backend.shared.fail("Repository identifier is missing", requestID: request.id, webView: webView)
            return
        }
        Backend.shared.unlockRepository(repositoryID: repositoryID, requestID: request.id, webView: webView)
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
}

private final class Backend: @unchecked Sendable {
    static let shared = Backend()
    private let queue = DispatchQueue(label: "app.snapshotter.engine", qos: .utility)
    private let keychain = KeychainStore()
    private let engine: Result<EngineBridge, Error>
    private var scheduleTimer: DispatchSourceTimer?

    private init() {
        engine = Result { try EngineBridge() }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 10, repeating: 60)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            Self.setActivity(true)
            defer { Self.setActivity(false) }
            _ = try? self.engine.get().handle(#"{"type":"schedule.tick"}"#)
        }
        timer.resume()
        scheduleTimer = timer
    }

    func handle(_ rawRequest: String, requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        let showsActivity = Self.requestType(rawRequest).map { $0 == "backup.start" || $0 == "schedule.tick" } == true
        queue.async {
            if showsActivity { Self.setActivity(true) }
            defer { if showsActivity { Self.setActivity(false) } }
            do {
                let response = try self.engine.get().handle(rawRequest)
                Self.respond(response, requestID: requestID, reference: reference)
            } catch {
                Self.respond(Self.errorResponse(error), requestID: requestID, reference: reference)
            }
        }
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

    func createRepository(name: String, location: String, password: String, requestID: String?, webView: WKWebView?) {
        let repositoryID = UUID().uuidString.lowercased()
        let payload: [String: Any] = [
            "type": "repository.create",
            "payload": [
                "repository": ["id": repositoryID, "name": name, "kind": "local", "location": location],
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
                    try self.keychain.savePassword(password, repositoryID: repositoryID)
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
                let payload = ["type": "repository.unlock", "payload": ["password": password]] as [String: Any]
                let data = try JSONSerialization.data(withJSONObject: payload)
                guard let request = String(data: data, encoding: .utf8) else { throw EngineBridgeError.invalidResponse }
                let response = try self.engine.get().handle(request)
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

    private static func requestType(_ request: String) -> String? {
        guard let data = request.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["type"] as? String
    }

    private static func setActivity(_ active: Bool) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .engineActivityChanged, object: nil, userInfo: ["active": active])
        }
    }
}

private final class WebViewReference: @unchecked Sendable {
    weak var webView: WKWebView?

    init(_ webView: WKWebView?) {
        self.webView = webView
    }
}

private extension Notification.Name {
    static let engineActivityChanged = Notification.Name("app.snapshotter.engineActivityChanged")
}

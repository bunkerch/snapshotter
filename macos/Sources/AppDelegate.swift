import AppKit
import ServiceManagement
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSPopoverDelegate {
    private let popover = NSPopover()
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureMainMenu()
        configurePopover()
        configureStatusItem()
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
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            if let window = popover.contentViewController?.view.window {
                window.isOpaque = false
                window.backgroundColor = .clear
                window.makeKey()
            }
        }
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
        case "launchAtLogin.set": setLaunchAtLogin(enabled: request.payload?.enabled == true)
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

    private func setLaunchAtLogin(enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("Unable to update launch at login: \(error.localizedDescription)")
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

    private init() {
        engine = Result { try EngineBridge() }
    }

    func handle(_ rawRequest: String, requestID: String?, webView: WKWebView?) {
        let reference = WebViewReference(webView)
        queue.async {
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
}

private final class WebViewReference: @unchecked Sendable {
    weak var webView: WKWebView?

    init(_ webView: WKWebView?) {
        self.webView = webView
    }
}

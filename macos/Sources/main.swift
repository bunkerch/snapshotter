import AppKit
import ServiceManagement
import WebKit

@main
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSPopoverDelegate {
    private let popover = NSPopover()
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configurePopover()
        configureStatusItem()
    }

    private func configurePopover() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "resticNative")

        let controller = WebViewController(configuration: configuration)
        popover.contentViewController = controller
        popover.contentSize = NSSize(width: 420, height: 620)
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
    }

    private func configureStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem.button else { return }
        button.image = NSImage(systemSymbolName: "shield.checkered", accessibilityDescription: "Restic")
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
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "resticNative", let raw = message.body as? String,
              let data = raw.data(using: .utf8),
              let request = try? JSONDecoder().decode(BridgeRequest.self, from: data) else { return }

        switch request.type {
        case "app.quit": NSApp.terminate(nil)
        case "source.choose": chooseSourceFolder()
        case "launchAtLogin.set": setLaunchAtLogin(enabled: request.payload?["enabled"] == "true")
        default: Backend.shared.handle(request)
        }
    }

    private func chooseSourceFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.begin { response in
            guard response == .OK else { return }
            Backend.shared.addSources(panel.urls)
        }
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
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        view = webView

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
    let type: String
    let payload: [String: String]?
}

private final class Backend: @unchecked Sendable {
    static let shared = Backend()
    private let queue = DispatchQueue(label: "app.restic.engine", qos: .utility)

    func handle(_ request: BridgeRequest) {
        queue.async {
            // The linked Go engine receives requests here. Keeping this boundary
            // serial prevents overlapping maintenance and backup repository locks.
            NSLog("Engine request: \(request.type)")
        }
    }

    func addSources(_ urls: [URL]) {
        queue.async { NSLog("Adding \(urls.count) backup source(s)") }
    }
}


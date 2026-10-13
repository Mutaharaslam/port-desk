import AppKit
import ServiceManagement
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, WKNavigationDelegate {
    /// Posted by a second launch so the running copy opens its popover.
    static let showNotification = Notification.Name("dev.mutaharaslam.portdesk.show")

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let popover = NSPopover()
    private let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 640))
    private lazy var server = NodeServer(resources: Bundle.main.resourceURL ?? Bundle.main.bundleURL)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = Self.makeMainMenu()

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "network", accessibilityDescription: "Port desk")
            button.image?.isTemplate = true
            button.target = self
            button.action = #selector(statusClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        let controller = NSViewController()
        controller.view = webView
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        popover.contentViewController = controller
        popover.contentSize = NSSize(width: 480, height: 640)
        popover.behavior = .transient
        popover.delegate = self

        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(showPopover), name: Self.showNotification, object: nil)

        server.onChange = { [weak self] state in self?.apply(state) }
        apply(.starting)
        server.start()

        if !launchedAtLogin() { showPopover() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        server.stop()
    }

    // MARK: Server state

    private func apply(_ state: NodeServer.State) {
        switch state {
        case .starting:
            webView.loadHTMLString(Self.messagePage("Starting Port desk…", restart: false), baseURL: nil)
        case .running(let url):
            webView.load(URLRequest(url: url))
        case .failed(let message):
            webView.loadHTMLString(Self.messagePage(message, restart: true), baseURL: nil)
        }
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let url = navigationAction.request.url
        if url?.scheme == "portdesk" {
            decisionHandler(.cancel)
            server.restart()
        } else if navigationAction.navigationType == .linkActivated, let url, ["http", "https"].contains(url.scheme) {
            // The "Open" buttons: show the project in the default browser, not inside the popover.
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setActive(popover.isShown)
    }

    // MARK: Popover

    @objc private func statusClicked(_ sender: Any?) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else if popover.isShown {
            popover.performClose(nil)
        } else {
            showPopover()
        }
    }

    @objc private func showPopover() {
        guard !popover.isShown, let button = statusItem.button else { return }
        Self.activateApp()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        setActive(true)
    }

    func popoverDidClose(_ notification: Notification) {
        setActive(false)
    }

    /// The page only polls lsof while the popover is open.
    private func setActive(_ active: Bool) {
        webView.evaluateJavaScript("window.portDeskSetActive && window.portDeskSetActive(\(active))")
    }

    // MARK: Right-click menu

    private func showMenu() {
        let menu = NSMenu()
        let refresh = NSMenuItem(title: "Refresh", action: #selector(refresh), keyEquivalent: "")
        let login = NSMenuItem(title: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        for item in [refresh, login] { item.target = self }
        menu.addItem(refresh)
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Port desk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func refresh() {
        showPopover()
        setActive(true)
    }

    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
                if service.status == .requiresApproval {
                    alert("Allow Port desk in System Settings", "Open System Settings, go to General, then Login Items, and switch Port desk on.")
                }
            }
        } catch {
            alert("Could not change Open at login", error.localizedDescription)
        }
    }

    /// True when macOS started the app because the user logged in, so it should not pop open.
    private func launchedAtLogin() -> Bool {
        SMAppService.mainApp.status == .enabled && ProcessInfo.processInfo.systemUptime < 600
    }

    private func alert(_ title: String, _ detail: String) {
        Self.activateApp()
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.runModal()
    }

    // MARK: Helpers

    private static func activateApp() {
        if #available(macOS 14, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    /// An accessory app has no menu bar of its own, but the search field still needs Cmd+C, Cmd+V and friends.
    private static func makeMainMenu() -> NSMenu {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Quit Port desk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redo)
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit
        main.addItem(editItem)

        return main
    }

    private static func messagePage(_ message: String, restart: Bool) -> String {
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let button = restart ? #"<p><a href="portdesk://restart">Restart</a></p>"# : ""
        return """
            <!DOCTYPE html><meta charset="utf-8"><style>
            body { margin: 0; padding: 2.5rem 1.5rem; background: #d5e3e8; color: #1a2c33;
              font: 17px/1.45 "Avenir Next", sans-serif; }
            h1 { margin: 0 0 .6rem; font: 600 2.4rem "Iowan Old Style", Palatino, Georgia, serif; letter-spacing: -.03em; }
            p { margin: 0 0 1rem; white-space: pre-wrap; }
            a { color: #0c5c66; border: 1px solid #0c5c66; padding: .4rem .8rem; text-decoration: none; }
            </style><h1>Port desk</h1><p>\(escaped)</p>\(button)
            """
    }
}

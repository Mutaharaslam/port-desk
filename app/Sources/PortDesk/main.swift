import AppKit

// A second launch (Spotlight, Launchpad) asks the running copy to open its popover instead of starting another server.
let bundleID = Bundle.main.bundleIdentifier ?? "dev.mutaharaslam.portdesk"
let me = ProcessInfo.processInfo.processIdentifier
if NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).contains(where: { $0.processIdentifier != me }) {
    DistributedNotificationCenter.default().postNotificationName(
        AppDelegate.showNotification, object: nil, userInfo: nil, deliverImmediately: true)
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

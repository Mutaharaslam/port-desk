// Draws the app icon: a teal tile with a port number, in the same serif as the UI.
// Usage: swift make-icon.swift <output .iconset directory>
import AppKit

func render(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let size = CGFloat(px)
    let tile = NSRect(x: size * 0.1, y: size * 0.1, width: size * 0.8, height: size * 0.8)
    let radius = tile.width * 0.225
    NSColor(red: 0.047, green: 0.361, blue: 0.4, alpha: 1).setFill()
    NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius).fill()

    let font = NSFont(name: "IowanOldStyle-Bold", size: tile.width * 0.3)
        ?? NSFont(name: "Georgia-Bold", size: tile.width * 0.3)
        ?? NSFont.boldSystemFont(ofSize: tile.width * 0.3)
    let text = NSAttributedString(string: "3999", attributes: [
        .font: font,
        .foregroundColor: NSColor(red: 0.835, green: 0.89, blue: 0.91, alpha: 1),
        .kern: -tile.width * 0.008,
    ])
    let textSize = text.size()
    text.draw(at: NSPoint(x: tile.midX - textSize.width / 2, y: tile.midY - textSize.height / 2 + tile.height * 0.04))

    let bar = NSRect(x: tile.midX - tile.width * 0.2, y: tile.midY - tile.height * 0.2, width: tile.width * 0.4, height: tile.height * 0.035)
    NSColor(red: 0.89, green: 0.62, blue: 0.56, alpha: 1).setFill()
    NSBezierPath(roundedRect: bar, xRadius: bar.height / 2, yRadius: bar.height / 2).fill()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: make-icon.swift <output.iconset>\n".utf8))
    exit(2)
}
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try render(base).write(to: directory.appendingPathComponent("icon_\(base)x\(base).png"))
    try render(base * 2).write(to: directory.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}

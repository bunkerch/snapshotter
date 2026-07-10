import AppKit

guard CommandLine.arguments.count == 2 else {
    fatalError("output path required")
}

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()

let bounds = NSRect(origin: .zero, size: size)
let background = NSBezierPath(roundedRect: bounds.insetBy(dx: 42, dy: 42), xRadius: 220, yRadius: 220)
NSGradient(colors: [
    NSColor(red: 0.08, green: 0.48, blue: 0.98, alpha: 1),
    NSColor(red: 0.08, green: 0.29, blue: 0.72, alpha: 1),
])?.draw(in: background, angle: -55)

NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.24)
shadow.shadowBlurRadius = 30
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.set()

let shield = NSBezierPath()
shield.move(to: NSPoint(x: 512, y: 790))
shield.curve(to: NSPoint(x: 284, y: 685), controlPoint1: NSPoint(x: 438, y: 745), controlPoint2: NSPoint(x: 350, y: 710))
shield.line(to: NSPoint(x: 284, y: 485))
shield.curve(to: NSPoint(x: 512, y: 245), controlPoint1: NSPoint(x: 284, y: 350), controlPoint2: NSPoint(x: 377, y: 275))
shield.curve(to: NSPoint(x: 740, y: 485), controlPoint1: NSPoint(x: 647, y: 275), controlPoint2: NSPoint(x: 740, y: 350))
shield.line(to: NSPoint(x: 740, y: 685))
shield.curve(to: NSPoint(x: 512, y: 790), controlPoint1: NSPoint(x: 674, y: 710), controlPoint2: NSPoint(x: 586, y: 745))
shield.close()
NSColor.white.withAlphaComponent(0.96).setFill()
shield.fill()
NSGraphicsContext.restoreGraphicsState()

let tray = NSBezierPath(roundedRect: NSRect(x: 375, y: 440, width: 274, height: 150), xRadius: 34, yRadius: 34)
NSColor(red: 0.08, green: 0.36, blue: 0.78, alpha: 1).setFill()
tray.fill()

let lid = NSBezierPath()
lid.move(to: NSPoint(x: 393, y: 590))
lid.line(to: NSPoint(x: 435, y: 655))
lid.curve(to: NSPoint(x: 589, y: 655), controlPoint1: NSPoint(x: 470, y: 678), controlPoint2: NSPoint(x: 554, y: 678))
lid.line(to: NSPoint(x: 631, y: 590))
lid.close()
NSColor(red: 0.06, green: 0.28, blue: 0.67, alpha: 1).setFill()
lid.fill()

let indicator = NSBezierPath(ovalIn: NSRect(x: 487, y: 482, width: 50, height: 50))
NSColor.white.withAlphaComponent(0.96).setFill()
indicator.fill()

image.unlockFocus()

guard let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("unable to render icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))

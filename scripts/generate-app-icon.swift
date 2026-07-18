import AppKit

guard CommandLine.arguments.count == 3 else {
    fputs("usage: generate-app-icon.swift APP_ICON.png MENU_ICON.png\n", stderr)
    exit(2)
}

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
guard let context = NSGraphicsContext.current?.cgContext else { exit(3) }
context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)

let background = NSBezierPath(
    roundedRect: NSRect(x: 62, y: 62, width: 900, height: 900),
    xRadius: 210,
    yRadius: 210
)
NSColor(calibratedWhite: 0.965, alpha: 1).setFill()
background.fill()

func drawCard(_ rect: NSRect, color: NSColor) {
    let card = NSBezierPath(roundedRect: rect, xRadius: 62, yRadius: 62)
    NSColor(calibratedWhite: 0.965, alpha: 1).setFill()
    card.fill()
    color.setStroke()
    card.lineWidth = 29
    card.stroke()

    let dividerY = rect.maxY - 94
    let divider = NSBezierPath()
    divider.move(to: NSPoint(x: rect.minX + 18, y: dividerY))
    divider.line(to: NSPoint(x: rect.maxX - 18, y: dividerY))
    divider.lineWidth = 23
    divider.lineCapStyle = .round
    divider.stroke()

    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: rect.minX + 45, y: dividerY + 26, width: 22, height: 22)).fill()
}

drawCard(NSRect(x: 330, y: 440, width: 470, height: 330), color: NSColor(calibratedWhite: 0.58, alpha: 1))
drawCard(NSRect(x: 260, y: 350, width: 470, height: 330), color: NSColor(calibratedWhite: 0.34, alpha: 1))
drawCard(NSRect(x: 190, y: 260, width: 470, height: 330), color: NSColor(calibratedWhite: 0.09, alpha: 1))

image.unlockFocus()
guard let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    exit(4)
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)

let menuImage = NSImage(size: NSSize(width: 64, height: 64))
menuImage.lockFocus()
NSColor.clear.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 64, height: 64)).fill()
NSColor.black.setStroke()
for rect in [
    NSRect(x: 25, y: 30, width: 31, height: 22),
    NSRect(x: 17, y: 22, width: 31, height: 22),
    NSRect(x: 9, y: 14, width: 31, height: 22),
] {
    let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
    path.lineWidth = 4
    path.stroke()
}
menuImage.unlockFocus()
guard let menuData = menuImage.tiffRepresentation,
      let menuBitmap = NSBitmapImageRep(data: menuData),
      let menuPNG = menuBitmap.representation(using: .png, properties: [:]) else {
    exit(5)
}
try menuPNG.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)

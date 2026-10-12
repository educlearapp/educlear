import AppKit
import PDFKit

let args = CommandLine.arguments
let input = URL(fileURLWithPath: args[1])
let outDir = args[2]
guard let doc = PDFDocument(url: input) else { print("FAILED to open \(input.path)"); exit(1) }
print("\(input.lastPathComponent): pages=\(doc.pageCount)")
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let scale: CGFloat = 1.6
  let size = NSSize(width: box.width * scale, height: box.height * scale)
  let img = NSImage(size: size)
  img.lockFocus()
  NSColor.white.set()
  NSRect(origin: .zero, size: size).fill()
  let ctx = NSGraphicsContext.current!.cgContext
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  img.unlockFocus()
  let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
  let png = rep.representation(using: .png, properties: [:])!
  try! png.write(to: URL(fileURLWithPath: "\(outDir)/\(input.deletingPathExtension().lastPathComponent)-p\(i + 1).png"))
}

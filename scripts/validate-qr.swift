import AppKit
import CoreImage

guard CommandLine.arguments.count > 1 else {
    fputs("usage: validate-qr <image>...\n", stderr)
    exit(2)
}

for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let data = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: data),
          let cgImage = bitmap.cgImage else {
        print("\(path)\tIMAGE_ERROR")
        continue
    }

    let ciImage = CIImage(cgImage: cgImage)
    let detector = CIDetector(
        ofType: CIDetectorTypeQRCode,
        context: CIContext(options: [.useSoftwareRenderer: true]),
        options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
    )
    let values = (detector?.features(in: ciImage) ?? [])
        .compactMap { ($0 as? CIQRCodeFeature)?.messageString }
    print("\(path)\t\(values.isEmpty ? "NO_QR" : values.joined(separator: " | "))")
}

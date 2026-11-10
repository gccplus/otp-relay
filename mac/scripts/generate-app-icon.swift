import AppKit
import Foundation

private struct IconVariant {
    let chunkType: String
    let pixels: Int
}

private let variants = [
    IconVariant(chunkType: "icp4", pixels: 16),
    IconVariant(chunkType: "icp5", pixels: 32),
    IconVariant(chunkType: "icp6", pixels: 64),
    IconVariant(chunkType: "ic07", pixels: 128),
    IconVariant(chunkType: "ic08", pixels: 256),
    IconVariant(chunkType: "ic09", pixels: 512),
    IconVariant(chunkType: "ic10", pixels: 1_024),
]

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(
        Data("Usage: swift generate-app-icon.swift input.png output.icns\n".utf8)
    )
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let sourceImage = NSImage(contentsOf: inputURL) else {
    FileHandle.standardError.write(Data("Unable to read source image\n".utf8))
    exit(2)
}

private func appendBigEndian(_ value: UInt32, to data: inout Data) {
    var bigEndian = value.bigEndian
    withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
}

var chunks = Data()

for variant in variants {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: variant.pixels,
        pixelsHigh: variant.pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "AppIcon", code: 1)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    sourceImage.draw(
        in: NSRect(
            x: 0,
            y: 0,
            width: variant.pixels,
            height: variant.pixels
        ),
        from: .zero,
        operation: .copy,
        fraction: 1
    )
    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "AppIcon", code: 2)
    }
    chunks.append(Data(variant.chunkType.utf8))
    appendBigEndian(UInt32(png.count + 8), to: &chunks)
    chunks.append(png)
}

var icns = Data("icns".utf8)
appendBigEndian(UInt32(chunks.count + 8), to: &icns)
icns.append(chunks)

try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try icns.write(to: outputURL, options: .atomic)

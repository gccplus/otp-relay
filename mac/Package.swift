// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OtpRelayMac",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "OTPRelayCore", targets: ["OTPRelayCore"]),
        .executable(name: "OTPRelayMacApp", targets: ["OTPRelayMacApp"]),
    ],
    targets: [
        .target(
            name: "OTPRelayCore",
            linkerSettings: [
                .linkedFramework("Security"),
            ]
        ),
        .executableTarget(
            name: "OTPRelayMacApp",
            dependencies: ["OTPRelayCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreImage"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
        .testTarget(
            name: "OTPRelayCoreTests",
            dependencies: ["OTPRelayCore"]
        ),
        .testTarget(
            name: "OTPRelayMacAppTests",
            dependencies: ["OTPRelayMacApp"]
        ),
    ]
)

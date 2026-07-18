// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "CodexTabsManager",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "CodexTabsManager", targets: ["CodexTabsManager"]),
    ],
    targets: [
        .executableTarget(name: "CodexTabsManager"),
    ]
)

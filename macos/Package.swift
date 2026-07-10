// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Snapshotter",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Snapshotter", targets: ["Snapshotter"])],
    targets: [
        .executableTarget(
            name: "Snapshotter",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("Security"),
            ]
        )
    ]
)

// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ResticApp",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ResticApp", targets: ["ResticApp"])],
    targets: [
        .executableTarget(
            name: "ResticApp",
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


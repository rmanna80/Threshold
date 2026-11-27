// swift-tools-version:5.10
// Platform-independent watch logic (models, alcohol math, pace engine, intervention policy,
// protocol). Compiled into the watchOS app target by @bacons/apple-targets and tested here with
// `swift test` against the shared JSON vectors in packages/core/test-vectors.
import PackageDescription

let package = Package(
    name: "ThresholdWatchCore",
    platforms: [.macOS(.v14), .watchOS(.v10), .iOS(.v17)],
    products: [
        .library(name: "ThresholdWatchCore", targets: ["ThresholdWatchCore"]),
    ],
    targets: [
        .target(
            name: "ThresholdWatchCore",
            path: "ThresholdWatch/Shared"
        ),
        .testTarget(
            name: "ThresholdWatchCoreTests",
            dependencies: ["ThresholdWatchCore"],
            path: "Tests/ThresholdWatchCoreTests"
        ),
    ]
)

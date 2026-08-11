#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/build/Snapshotter.app"
CONTENTS="$APP/Contents"
IDENTITY=${CODESIGN_IDENTITY:--}

cd "$ROOT"
zsh -ic 'pnpm build'
make engine
swift build --package-path macos -c release

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Frameworks" "$CONTENTS/Resources/Web"
cp "$ROOT/macos/.build/release/Snapshotter" "$CONTENTS/MacOS/Snapshotter"
cp "$ROOT/engine/build/libsnapshotter.dylib" "$CONTENTS/Frameworks/libsnapshotter.dylib"
cp "$ROOT/macos/Resources/Info.plist" "$CONTENTS/Info.plist"
cp -R "$ROOT/dist/". "$CONTENTS/Resources/Web/"
test "$(find "$CONTENTS/Resources/Web" -type f | wc -l | tr -d ' ')" = "1"
test -f "$CONTENTS/Resources/Web/index.html"

ICON_PNG="$ROOT/build/Snapshotter-1024.png"
ICONSET="$ROOT/build/Snapshotter.iconset"
swift "$ROOT/macos/Resources/generate-icon.swift" "$ICON_PNG"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for spec in "16 icon_16x16.png" "32 icon_16x16@2x.png" "32 icon_32x32.png" \
    "64 icon_32x32@2x.png" "128 icon_128x128.png" "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" "512 icon_256x256@2x.png" "512 icon_512x512.png" \
    "1024 icon_512x512@2x.png"; do
    pixels=${spec%% *}
    name=${spec#* }
    sips -z "$pixels" "$pixels" "$ICON_PNG" --out "$ICONSET/$name" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/Snapshotter.icns"

if [ "$IDENTITY" = "-" ]; then
    codesign --force --sign - --identifier app.snapshotter.Snapshotter "$CONTENTS/Frameworks/libsnapshotter.dylib"
    codesign --force --sign - --identifier app.snapshotter.Snapshotter "$APP"
else
    codesign --force --options runtime --timestamp --sign "$IDENTITY" \
        --identifier app.snapshotter.Snapshotter "$CONTENTS/Frameworks/libsnapshotter.dylib"
    codesign --force --options runtime --timestamp --sign "$IDENTITY" \
        --identifier app.snapshotter.Snapshotter "$APP"
fi

codesign --verify --deep --strict --verbose=2 "$APP"
plutil -lint "$CONTENTS/Info.plist"
echo "$APP"

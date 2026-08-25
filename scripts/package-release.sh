#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/build/Snapshotter.app"
DMG="$ROOT/build/Snapshotter.dmg"
RW_DMG="$ROOT/build/Snapshotter.rw.dmg"
STAGING="$ROOT/build/dmg"
BG_TIFF="$ROOT/build/dmg-background.tiff"
# Mount under a unique path so we never collide with an already-mounted volume.
MOUNT="$ROOT/build/mnt"
BG_DIR="$ROOT/macos/Resources"

if [ -n "${CODESIGN_IDENTITY+x}" ]; then
    IDENTITY=$CODESIGN_IDENTITY
else
    IDENTITY=$(security find-identity -v -p codesigning | awk '/^[[:space:]]*[0-9]+\)/ { print $2; exit }')
    if [ -z "$IDENTITY" ]; then
        echo "No code-signing identity found. Set CODESIGN_IDENTITY=- only for a throwaway build." >&2
        exit 1
    fi
fi

CODESIGN_IDENTITY=$IDENTITY sh "$ROOT/scripts/package-macos.sh"

# Build a retina-ready background (TIFF with 1x and 2x representations) so the
# DMG window renders crisply on Retina displays.
rm -rf "$STAGING" "$RW_DMG" "$DMG" "$BG_TIFF"
tiffutil -cathidpicheck "$BG_DIR/dmg-background.png" "$BG_DIR/dmg-background@2x.png" -out "$BG_TIFF"

# Stage the install layout: the app, an Applications folder alias, and a hidden
# .background folder holding the window background picture.
mkdir -p "$STAGING/.background"
cp -R "$APP" "$STAGING/Snapshotter.app"
ln -s /Applications "$STAGING/Applications"
cp "$BG_TIFF" "$STAGING/.background/bg.tiff"

# Create a read-write image so Finder can write the .DS_Store layout, then
# apply the window/icon layout while it is mounted.
hdiutil create -volname Snapshotter -srcfolder "$STAGING" -fs HFS+ -format UDRW -ov "$RW_DMG" >/dev/null
rm -rf "$STAGING"

if ! hdiutil attach "$RW_DMG" -mountpoint "$MOUNT" >/dev/null; then
    echo "Failed to mount staging image for layout." >&2
    exit 1
fi

# Finder reports the volume by the mount point's last path component.
DISK_NAME=$(basename "$MOUNT")
osascript "$ROOT/scripts/dmg-window.applescript" "$MOUNT" "$DISK_NAME"

hdiutil detach "$MOUNT" >/dev/null

# Convert the layouted read-write image into the compressed final DMG.
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG" >/dev/null
rm -f "$RW_DMG" "$BG_TIFF"

if [ "$IDENTITY" != "-" ]; then
    codesign --force --timestamp --sign "$IDENTITY" "$DMG"
    codesign --verify --verbose=2 "$DMG"
fi

if [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
fi

hdiutil verify "$DMG"
echo "$DMG"

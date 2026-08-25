#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/build/Snapshotter.app"
DMG="$ROOT/build/Snapshotter.dmg"
STAGING="$ROOT/build/dmg"
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
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/Snapshotter.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname Snapshotter -srcfolder "$STAGING" -ov -format UDZO "$DMG"
rm -rf "$STAGING"

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

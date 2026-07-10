#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/build/Snapshotter.app"
DMG="$ROOT/build/Snapshotter.dmg"
STAGING="$ROOT/build/dmg"

sh "$ROOT/scripts/package-macos.sh"
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/Snapshotter.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname Snapshotter -srcfolder "$STAGING" -ov -format UDZO "$DMG"
rm -rf "$STAGING"

if [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
fi

hdiutil verify "$DMG"
echo "$DMG"

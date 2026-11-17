#!/bin/sh
# Wraps the release build in a plain disk image with an Applications shortcut.
# Tauri's own DMG step styles the window through Finder, which needs
# automation permission; this needs nothing but hdiutil.
# Usage: npm run tauri build && sh scripts/make-dmg.sh
set -eu
cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/Tonewell.app"
VERSION=$(node -p "require('./package.json').version")
OUT="src-tauri/target/release/bundle/dmg/Tonewell_${VERSION}_$(uname -m).dmg"
[ -d "$APP" ] || { echo "Build the app first: npm run tauri build"; exit 1; }
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil create -quiet -volname Tonewell -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT"
echo "$OUT"

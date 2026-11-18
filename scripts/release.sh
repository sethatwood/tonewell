#!/usr/bin/env bash
# Publishes a release: a signed, notarized Mac build (Apple silicon and
# Intel), the Windows and Linux bundles that CI built from the same tag, an
# updater signature for each, and site/updates/latest.json, the file every
# installed copy reads once a day to find out about it.
#
#   1. Set the version in src-tauri/tauri.conf.json, src-tauri/Cargo.toml and
#      package.json; commit and push.
#   2. git tag v<version> && git push origin v<version>
#      CI ("Desktop builds") puts the Windows and Linux bundles in a draft
#      release for the tag.
#   3. npm run release
#      Builds, signs and notarizes the Mac app, signs every update, publishes
#      the GitHub release, writes site/updates/latest.json and points the
#      site's download buttons at the new files.
#   4. Commit site/ and push. Forge deploys it, and installed copies find the
#      update the next time they look.
#
# Steps 3 and 4 are separate so the release can be tried from its GitHub page
# before any installed copy is told about it.
#
# Needs: the Developer ID Application certificate; a notarytool keychain
# profile (TONEWELL_NOTARY_PROFILE, default "seraglio"); the updater key at
# ~/.tauri/tonewell-updater.key with its password in the login keychain
# (service "tonewell-updater"); the rustup target x86_64-apple-darwin; gh.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="sethatwood/tonewell"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
IDENTITY="${TONEWELL_SIGN_IDENTITY:-Developer ID Application: Seth Atwood (46322TC4D7)}"
PROFILE="${TONEWELL_NOTARY_PROFILE:-seraglio}"
KEY="${TONEWELL_UPDATER_KEY:-$HOME/.tauri/tonewell-updater.key}"
OUT="src-tauri/target/publish/$VERSION"
DOWNLOAD="https://github.com/$REPO/releases/download/$TAG"
MANIFEST="site/updates/latest.json"

die() {
  echo "release: $*" >&2
  exit 1
}

sign() {
  npx tauri signer sign -f "$KEY" --app-version "$VERSION" "$1" >/dev/null
}

echo "==> Checking release $VERSION"
[ "$(node -p "require('./package.json').version")" = "$VERSION" ] || die "package.json's version is not $VERSION"
grep -q "^version = \"$VERSION\"$" src-tauri/Cargo.toml || die "src-tauri/Cargo.toml's version is not $VERSION"
[ -z "$(git status --porcelain)" ] || die "the working tree has changes; commit or stash them first"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$TAG^{commit}" 2>/dev/null)" ] || die "HEAD is not tag $TAG; check it out first"
[ -f "$KEY" ] || die "no updater key at $KEY"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(security find-generic-password -s tonewell-updater -w) || die "no updater key password in the keychain"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# Matches are tested on captured output: "cmd | grep -q" can fail under
# pipefail when grep exits early and the command gets SIGPIPE.
[[ "$(rustup target list --installed)" == *x86_64-apple-darwin* ]] || die "run: rustup target add x86_64-apple-darwin"
[ "$(gh release view "$TAG" -R "$REPO" --json isDraft --jq .isDraft 2>/dev/null)" = true ] ||
  die "no draft release $TAG; push the tag and wait for the Desktop builds workflow"

rm -rf "$OUT"
mkdir -p "$OUT"

# Before the long build: the key must be the one installed copies trust.
echo "$VERSION" > "$OUT/key-check"
sign "$OUT/key-check"
node scripts/check-update-signatures.mjs "$VERSION" "$OUT/key-check" >/dev/null ||
  die "$KEY is not the key whose public half is in src-tauri/tauri.conf.json"
rm "$OUT/key-check" "$OUT/key-check.sig"

echo "==> Fetching the Windows and Linux bundles from the draft release"
gh release download "$TAG" -R "$REPO" -D "$OUT" -p '*-setup.exe' -p '*.AppImage' -p '*.deb'
EXE=$(cd "$OUT" && ls *-setup.exe)
APPIMAGE=$(cd "$OUT" && ls *.AppImage)
DEB=$(cd "$OUT" && ls *.deb)

echo "==> Building the Mac app (Apple silicon and Intel), signed"
APPLE_SIGNING_IDENTITY="$IDENTITY" npm run tauri build -- --target universal-apple-darwin --bundles app
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Tonewell.app"
codesign --verify --deep --strict "$APP"
[[ "$(codesign -dvv "$APP" 2>&1)" == *"(runtime)"* ]] || die "the app is not signed with the hardened runtime"
ARCHS=$(lipo -archs "$APP/Contents/MacOS/tonewell")
[[ "$ARCHS" == *x86_64* && "$ARCHS" == *arm64* ]] || die "the app is not universal ($ARCHS)"

echo "==> Notarizing the app"
ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
xcrun notarytool submit "$OUT/notarize.zip" --keychain-profile "$PROFILE" --wait
rm "$OUT/notarize.zip"
xcrun stapler staple "$APP"
spctl -a -t exec -vv "$APP"

echo "==> Packing the Mac update"
TARBALL="Tonewell_${VERSION}_universal.app.tar.gz"
# The updater unpacks Tonewell.app from the top of the archive. No AppleDouble files.
COPYFILE_DISABLE=1 tar -czf "$OUT/$TARBALL" -C "$(dirname "$APP")" Tonewell.app

echo "==> Building the DMG"
DMG="Tonewell_${VERSION}_universal.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Tonewell -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT/$DMG"
codesign --force --timestamp --sign "$IDENTITY" "$OUT/$DMG"

echo "==> Notarizing the DMG"
xcrun notarytool submit "$OUT/$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$OUT/$DMG"
spctl -a -t open --context context:primary-signature -vv "$OUT/$DMG"

echo "==> Signing the updates"
# Each signature names the version, so an old release can't be passed off as a new one.
for f in "$TARBALL" "$EXE" "$APPIMAGE" "$DEB"; do
  sign "$OUT/$f"
done
node scripts/check-update-signatures.mjs "$VERSION" "$OUT/$TARBALL" "$OUT/$EXE" "$OUT/$APPIMAGE" "$OUT/$DEB"

echo "==> Writing the update manifest"
node - "$OUT" "$VERSION" "$DOWNLOAD" "$TARBALL" "$EXE" "$APPIMAGE" "$DEB" > "$OUT/latest.json" <<'JS'
const fs = require('fs');
const [out, version, download, tarball, exe, appimage, deb] = process.argv.slice(2);
const entry = (file) => ({
  signature: fs.readFileSync(`${out}/${file}.sig`, 'utf8').trim(),
  url: `${download}/${encodeURIComponent(file)}`,
});
// The updater looks for "<os>-<arch>-<installer>" first, then "<os>-<arch>".
const mac = entry(tarball);
const platforms = {
  'darwin-aarch64': mac,
  'darwin-x86_64': mac,
  'windows-x86_64': entry(exe),
  'windows-x86_64-nsis': entry(exe),
  'linux-x86_64': entry(appimage),
  'linux-x86_64-appimage': entry(appimage),
  'linux-x86_64-deb': entry(deb),
};
console.log(JSON.stringify({ version, pub_date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), platforms }, null, 2));
JS

echo "==> Uploading the Mac builds and publishing the release"
gh release upload "$TAG" -R "$REPO" --clobber "$OUT/$DMG" "$OUT/$TARBALL"
gh release edit "$TAG" -R "$REPO" --draft=false --latest

echo "==> Checking every download"
node - "$OUT/latest.json" <<'JS'
const m = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const urls = [...new Set(Object.values(m.platforms).map((p) => p.url))];
(async () => {
  for (const url of urls) {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    console.log(r.status, url);
    if (!r.ok) process.exit(1);
  }
})();
JS

mkdir -p "$(dirname "$MANIFEST")"
cp "$OUT/latest.json" "$MANIFEST"
node scripts/site-downloads.mjs "$VERSION" mac="$DOWNLOAD/$DMG" windows="$DOWNLOAD/$EXE" appimage="$DOWNLOAD/$APPIMAGE" deb="$DOWNLOAD/$DEB"

echo
echo "Release $VERSION is published on GitHub:"
echo "  https://github.com/$REPO/releases/tag/$TAG"
echo "Commit site/ and push to main: the download buttons go live, and installed"
echo "copies update within a day."

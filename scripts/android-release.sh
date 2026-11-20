#!/usr/bin/env bash
# Builds the Android app for Google Play: a release .aab signed with the upload
# key, for 64- and 32-bit ARM phones and x86_64 Chromebooks.
#
#   npm run android:release            the .aab to upload to Play Console
#   npm run android:release -- --apk   an .apk instead, to install on a phone
#                                      with adb for a last check
#
# The upload key lives at ~/.tauri/tonewell-upload.jks and its password in the
# login keychain (service "tonewell-upload"). Google Play keeps the key that
# signs what people install, so a lost upload key can be replaced from Play
# Console (Setup > App signing).
set -euo pipefail

store="$HOME/.tauri/tonewell-upload.jks"
[ -f "$store" ] || { echo "No upload key at $store" >&2; exit 1; }
password=$(security find-generic-password -s tonewell-upload -w) || {
  echo "No keychain item \"tonewell-upload\" holding the upload key's password" >&2
  exit 1
}

format=--aab
[ "${1:-}" = "--apk" ] && format=--apk

TONEWELL_UPLOAD_STORE="$store" TONEWELL_UPLOAD_PASSWORD="$password" \
  npx tauri android build "$format" --target aarch64 armv7 x86_64

out=src-tauri/gen/android/app/build/outputs
if [ "$format" = --aab ]; then
  ls -lh "$out"/bundle/universalRelease/*.aab
else
  ls -lh "$out"/apk/universal/release/*.apk
fi

#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
OUTPUT_DIR="$PROJECT_DIR/dist"
STAGING_DIR=$(mktemp -d /tmp/otp-relay-dmg.XXXXXX)

cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/package-local.sh"

VERSION=$(plutil -extract CFBundleShortVersionString raw "$PROJECT_DIR/Info.plist")
APP_NAME="验证码同步.app"
OUTPUT_PATH="$OUTPUT_DIR/验证码同步-${VERSION}-local.dmg"

mkdir -p "$OUTPUT_DIR"
cp -R "$PROJECT_DIR/.build/OTPRelayMacApp.app" "$STAGING_DIR/$APP_NAME"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
    -volname "验证码同步" \
    -srcfolder "$STAGING_DIR" \
    -format UDZO \
    -ov \
    "$OUTPUT_PATH"

hdiutil verify "$OUTPUT_PATH"
shasum -a 256 "$OUTPUT_PATH"

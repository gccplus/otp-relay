#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
APP_PATH="$PROJECT_DIR/.build/OTPRelayMacApp.app"
CONTENTS_PATH="$APP_PATH/Contents"
MACOS_PATH="$CONTENTS_PATH/MacOS"
RESOURCES_PATH="$CONTENTS_PATH/Resources"

cd "$PROJECT_DIR"
swift build
BIN_PATH=$(swift build --show-bin-path)

mkdir -p "$MACOS_PATH" "$RESOURCES_PATH"
cp "$BIN_PATH/OTPRelayMacApp" "$MACOS_PATH/OTPRelayMacApp"
cp "$PROJECT_DIR/Info.plist" "$CONTENTS_PATH/Info.plist"
cp "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_PATH/AppIcon.icns"

SIGNING_IDENTITY=${OTP_RELAY_SIGNING_IDENTITY:--}
if [ "$SIGNING_IDENTITY" = "-" ]; then
    codesign \
        --force \
        --deep \
        --sign - \
        --requirements '=designated => identifier "com.otprelay.mac"' \
        "$APP_PATH"
else
    codesign \
        --force \
        --deep \
        --options runtime \
        --timestamp \
        --sign "$SIGNING_IDENTITY" \
        "$APP_PATH"
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -d --requirements - "$APP_PATH" 2>&1

#!/bin/bash
# Builds "Port desk.app" and installs it to ~/Applications.
# Run from anywhere: npm run app
set -euo pipefail

cd "$(dirname "$0")/.."
NAME="Port desk"
APP="dist/$NAME.app"
INSTALL_DIR="$HOME/Applications"
BUNDLE_ID="dev.mutaharaslam.portdesk"

echo "==> Running tests"
npm test --silent

echo "==> Building the Swift shell"
swift build -c release --package-path app
BIN="$(swift build -c release --package-path app --show-bin-path)/PortDesk"

echo "==> Assembling $APP"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server"
cp "$BIN" "$APP/Contents/MacOS/PortDesk"
cp app/Info.plist "$APP/Contents/Info.plist"
cp -R server.js lib public package.json "$APP/Contents/Resources/server/"

# Bundle the node that built this app so a later nvm switch can't break it.
# Its own signature (hardened runtime + JIT entitlement) is kept, so it is not re-signed.
cp "$(node -p process.execPath)" "$APP/Contents/Resources/node"

echo "==> Drawing the icon"
ICONSET="dist/AppIcon.iconset"
swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "==> Signing (ad hoc)"
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"

echo "==> Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if pgrep -f "$INSTALL_DIR/$NAME.app/Contents/MacOS/PortDesk" >/dev/null; then
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$INSTALL_DIR/$NAME.app/Contents/MacOS/PortDesk" >/dev/null || break
    sleep 0.5
  done
fi
rm -rf "$INSTALL_DIR/$NAME.app"
cp -R "$APP" "$INSTALL_DIR/"
rm -rf dist

echo "Installed: $INSTALL_DIR/$NAME.app"
echo "Open it with:  open \"$INSTALL_DIR/$NAME.app\""

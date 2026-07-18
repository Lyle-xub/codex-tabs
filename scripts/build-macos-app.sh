#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
PACKAGE_DIR="$PROJECT_DIR/macos/CodexTabsManager"
BUILD_DIR="$PROJECT_DIR/.build-macos"
APP_DIR="$PROJECT_DIR/dist/Codex Tabs.app"
ICON_SOURCE="$BUILD_DIR/AppIcon-1024.png"
MENU_ICON_SOURCE="$BUILD_DIR/MenuBarIcon.png"
ICONSET_DIR="$BUILD_DIR/AppIcon.iconset"
export SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_DIR/ModuleCache"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/ModuleCache"

swift build \
  --package-path "$PACKAGE_DIR" \
  --configuration release \
  --scratch-path "$BUILD_DIR"

swift "$PROJECT_DIR/scripts/generate-app-icon.swift" "$ICON_SOURCE" "$MENU_ICON_SOURCE"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$ICON_SOURCE" "$ICONSET_DIR/icon_512x512@2x.png"
iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/AppIcon.icns"

CODEX_RUNTIME_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
NODE_BIN="${CODEX_TABS_NODE_BINARY:-$CODEX_RUNTIME_NODE}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "找不到可打包的 Node.js" >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/runtime/src" "$APP_DIR/Contents/Resources/runtime/bin"
cp "$BUILD_DIR/release/CodexTabsManager" "$APP_DIR/Contents/MacOS/CodexTabsManager"
cp "$PROJECT_DIR/macos/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$BUILD_DIR/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
cp "$MENU_ICON_SOURCE" "$APP_DIR/Contents/Resources/MenuBarIcon.png"
cp "$PROJECT_DIR/macos/Assets/AlipayQR.png" "$APP_DIR/Contents/Resources/AlipayQR.png"
cp "$PROJECT_DIR/macos/Assets/WeChatQR.png" "$APP_DIR/Contents/Resources/WeChatQR.png"
cp "$PROJECT_DIR/package.json" "$APP_DIR/Contents/Resources/runtime/package.json"
cp "$PROJECT_DIR/src/cli.mjs" "$APP_DIR/Contents/Resources/runtime/src/cli.mjs"
cp "$PROJECT_DIR/src/cdp.mjs" "$APP_DIR/Contents/Resources/runtime/src/cdp.mjs"
cp "$PROJECT_DIR/src/injected.js" "$APP_DIR/Contents/Resources/runtime/src/injected.js"
cp "$PROJECT_DIR/src/usage.mjs" "$APP_DIR/Contents/Resources/runtime/src/usage.mjs"
cp "$NODE_BIN" "$APP_DIR/Contents/Resources/runtime/bin/node"

codesign --force --deep --sign - "$APP_DIR"
echo "$APP_DIR"

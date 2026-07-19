#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
APP_DIR="$PROJECT_DIR/dist/Codex Tabs.app"
SUBMISSION_ZIP="$PROJECT_DIR/dist/Codex-Tabs-notarization.zip"
FINAL_ZIP="$PROJECT_DIR/dist/Codex-Tabs-macOS.zip"

if [[ -z "${CODE_SIGN_IDENTITY:-}" ]]; then
  echo "CODE_SIGN_IDENTITY must name a Developer ID Application certificate" >&2
  exit 1
fi
if [[ -z "${NOTARYTOOL_PROFILE:-}" ]]; then
  echo "NOTARYTOOL_PROFILE must name a notarytool keychain profile" >&2
  exit 1
fi

"$PROJECT_DIR/scripts/build-macos-app.sh"

rm -f "$SUBMISSION_ZIP" "$FINAL_ZIP"
ditto -c -k --keepParent "$APP_DIR" "$SUBMISSION_ZIP"
xcrun notarytool submit "$SUBMISSION_ZIP" \
  --keychain-profile "$NOTARYTOOL_PROFILE" \
  --wait
xcrun stapler staple "$APP_DIR"
xcrun stapler validate "$APP_DIR"
spctl --assess --type execute --verbose=2 "$APP_DIR"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$FINAL_ZIP"

echo "$FINAL_ZIP"

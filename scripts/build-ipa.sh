#!/usr/bin/env bash
# Archives the iOS app and exports a development-signed IPA to build/.
# Signing uses the Apple ID signed in to Xcode (team FF395Z92C2).
set -euo pipefail
cd "$(dirname "$0")/../ios/App"
BUILD="../../build"
rm -rf "$BUILD/App.xcarchive" "$BUILD/ipa"
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$BUILD/App.xcarchive" \
  -allowProvisioningUpdates archive
cat > "$BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>debugging</string>
  <key>teamID</key><string>FF395Z92C2</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$BUILD/App.xcarchive" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" -exportPath "$BUILD/ipa" -allowProvisioningUpdates
mv "$BUILD"/ipa/*.ipa "$BUILD/NUS Companion.ipa"
echo "IPA: $(cd "$BUILD" && pwd)/NUS Companion.ipa"

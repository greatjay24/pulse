#!/bin/bash

set -e

echo "Building Roo..."
cd "$(dirname "$0")/.."

# Source cargo environment
source "$HOME/.cargo/env"

# Keep node_modules in step with package-lock.json (new deps arrive with merged PRs)
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci --no-audit --no-fund
fi

# Build the release version
npm run tauri build -- --bundles app   # just the .app; the DMG step is for releases and can fail locally

# Find the built app
APP_PATH="src-tauri/target/release/bundle/macos/Pulse.app"

if [ ! -d "$APP_PATH" ]; then
    echo "Error: Built app not found at $APP_PATH"
    exit 1
fi

# A stable code identity keeps the Microphone and Speech Recognition grants across installs.
./scripts/sign-local.sh "$APP_PATH"

# A running Roo keeps executing the old binary after the copy; quit it and reopen the new one below.
WAS_RUNNING=0
if pgrep -f "/Applications/Pulse.app/Contents/MacOS/pulse" >/dev/null; then
    WAS_RUNNING=1
    osascript -e 'quit app "Pulse"' 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "/Applications/Pulse.app/Contents/MacOS/pulse" >/dev/null || break; sleep 1; done
fi

echo "Installing Roo to /Applications..."
rm -rf /Applications/Pulse.app
cp -R "$APP_PATH" /Applications/

echo "Loading Launch Agent..."
launchctl unload ~/Library/LaunchAgents/com.pulse.desktop.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.pulse.desktop.plist

echo ""
echo "Roo installed successfully!"
echo "- App location: /Applications/Pulse.app"
echo "- Will auto-start on login"
echo ""
if [ "$WAS_RUNNING" = 1 ]; then
    open /Applications/Pulse.app
    echo "Roo was running: restarted on the new build."
else
    echo "To start Roo now, run:"
    echo "  open /Applications/Pulse.app"
fi

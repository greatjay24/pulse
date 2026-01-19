#!/bin/bash

set -e

echo "Building Pulse..."
cd "$(dirname "$0")/.."

# Source cargo environment
source "$HOME/.cargo/env"

# Build the release version
npm run tauri build

# Find the built app
APP_PATH="src-tauri/target/release/bundle/macos/Pulse.app"

if [ ! -d "$APP_PATH" ]; then
    echo "Error: Built app not found at $APP_PATH"
    exit 1
fi

echo "Installing Pulse to /Applications..."
rm -rf /Applications/Pulse.app
cp -R "$APP_PATH" /Applications/

echo "Loading Launch Agent..."
launchctl unload ~/Library/LaunchAgents/com.jonathanhaynes.pulse.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.jonathanhaynes.pulse.plist

echo ""
echo "Pulse installed successfully!"
echo "- App location: /Applications/Pulse.app"
echo "- Will auto-start on login"
echo ""
echo "To start Pulse now, run:"
echo "  open /Applications/Pulse.app"

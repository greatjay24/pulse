#!/bin/bash
# Install Pulse auto-launch daemon (macOS)
# Launches Pulse every day at 7:30 AM

PLIST_NAME="com.pulse.autolaunch.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PLIST="$SCRIPT_DIR/$PLIST_NAME"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST_PLIST="$DEST_DIR/$PLIST_NAME"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the plist
cp "$SOURCE_PLIST" "$DEST_PLIST"

# Load the launch agent
launchctl load "$DEST_PLIST"

echo "Pulse auto-launch installed!"
echo "Pulse will now open automatically at 7:30 AM every day."
echo ""
echo "To change the time, edit: $DEST_PLIST"
echo "To uninstall, run: ./uninstall-autolaunch.sh"

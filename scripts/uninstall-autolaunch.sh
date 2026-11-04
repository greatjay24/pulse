#!/bin/bash
# Uninstall Roo auto-launch daemon (macOS)

PLIST_NAME="com.pulse.autolaunch.plist"
DEST_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ -f "$DEST_PLIST" ]; then
    # Unload the launch agent
    launchctl unload "$DEST_PLIST" 2>/dev/null

    # Remove the plist
    rm "$DEST_PLIST"

    echo "Roo auto-launch uninstalled."
else
    echo "Roo auto-launch is not installed."
fi

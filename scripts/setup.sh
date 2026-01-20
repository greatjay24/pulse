#!/bin/bash
# Pulse Setup Script
# Run this after installing Pulse to configure preferences

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.pulse.autolaunch.plist"
SOURCE_PLIST="$SCRIPT_DIR/$PLIST_NAME"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST_PLIST="$DEST_DIR/$PLIST_NAME"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         Welcome to Pulse Setup        ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Ask about auto-launch
echo "Would you like Pulse to launch automatically every morning at 7:30 AM?"
echo "This helps you start your day with a quick overview of your projects."
echo ""
read -p "Enable auto-launch? (y/n): " ENABLE_AUTOLAUNCH

if [[ "$ENABLE_AUTOLAUNCH" =~ ^[Yy]$ ]]; then
    # Create LaunchAgents directory if needed
    mkdir -p "$DEST_DIR"

    # Copy and load the launch agent
    cp "$SOURCE_PLIST" "$DEST_PLIST"
    launchctl load "$DEST_PLIST" 2>/dev/null

    echo ""
    echo "✓ Auto-launch enabled! Pulse will open at 7:30 AM daily."
    echo "  You can change this later in Settings > Preferences."
else
    # Make sure it's not installed
    if [ -f "$DEST_PLIST" ]; then
        launchctl unload "$DEST_PLIST" 2>/dev/null
        rm "$DEST_PLIST"
    fi

    echo ""
    echo "✓ Auto-launch disabled."
    echo "  You can enable this later in Settings > Preferences."
fi

echo ""
echo "Setup complete! Launching Pulse..."
echo ""

# Launch the app
open -a "Pulse" 2>/dev/null || echo "Note: Open Pulse manually from your Applications folder."

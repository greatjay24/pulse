#!/bin/bash

echo "Uninstalling Pulse..."

# Unload Launch Agent
launchctl unload ~/Library/LaunchAgents/com.jonathanhaynes.pulse.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.jonathanhaynes.pulse.plist

# Remove app
rm -rf /Applications/Pulse.app

# Optionally remove settings (commented out by default)
# rm -rf ~/.pulse

echo "Pulse uninstalled."
echo "Note: Settings preserved at ~/.pulse (delete manually if needed)"

#!/bin/sh
# Installs the org's schedule: directors nightly at 5:30am, chief-of-staff Mondays at 6:30am.
# setup.py copies this into <org>/launchd/ next to the plists it rendered for you.
# Run it from there:  sh <org>/launchd/install.sh
# If the plists still hold {{ORG}} / {{PYTHON}} placeholders (you're running it from the
# kit), they are filled in with this script's parent folder and the python3 on PATH.
# Remove with: launchctl bootout gui/$(id -u)/com.pulse.org.nightly (and .weekly)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ORG="${PORTFOLIO_ROOT:-$(dirname "$HERE")}"
PY="$(command -v python3 || echo /usr/bin/python3)"
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST" "$ORG/logs"
for j in nightly weekly; do
  sed -e "s#{{ORG}}#$ORG#g" -e "s#{{PYTHON}}#$PY#g" "$HERE/com.pulse.org.$j.plist" > "$DEST/com.pulse.org.$j.plist"
  launchctl bootout "gui/$(id -u)/com.pulse.org.$j" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$DEST/com.pulse.org.$j.plist"
done
launchctl list | grep com.pulse.org || true

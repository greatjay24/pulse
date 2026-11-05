#!/bin/bash
# Signs a locally built Pulse.app with a stable code identity, so macOS keeps Roo's Microphone
# and Speech Recognition grants across installs. Without it, every build is ad-hoc signed by
# the linker with a random identifier (pulse-<hash>) and macOS treats it as a new app.
#
#   scripts/sign-local.sh path/to/Pulse.app
#
# Identity: $ROO_SIGN_IDENTITY, default "Roo Local Code Signing" (a self-signed code-signing
# certificate in the login keychain; ~/portfolio/bin/roo-signing-setup.sh or any equivalent
# creates it). Any code-signing identity works, e.g. an "Apple Development: ..." one.
# Missing identity: falls back to ad-hoc with the same identifiers and warns that grants won't stick.
set -e
APP="${1:?usage: sign-local.sh path/to/Pulse.app}"
IDENTITY="${ROO_SIGN_IDENTITY:-Roo Local Code Signing}"
APP_ID="com.pulse.app"
LISTEN_ID="com.pulse.app.listen"
LISTEN="$APP/Contents/MacOS/pulse-listen"

sign_all() {
    if [ -f "$LISTEN" ]; then
        codesign --force --timestamp=none --sign "$1" --identifier "$LISTEN_ID" "$LISTEN"
    fi
    codesign --force --timestamp=none --sign "$1" --identifier "$APP_ID" "$APP"
}

if security find-identity -p codesigning 2>/dev/null | grep -qF "\"$IDENTITY\"" && sign_all "$IDENTITY"; then
    echo "Signed with \"$IDENTITY\" ($APP_ID, $LISTEN_ID): Microphone and Speech grants carry over."
else
    sign_all -
    echo ""
    echo "WARNING: code-signing identity \"$IDENTITY\" not found or not usable; signed ad-hoc."
    echo "         macOS will treat this install as a new app: Microphone and Speech Recognition"
    echo "         grants won't carry over. Run ~/portfolio/bin/roo-signing-setup.sh once to fix it."
    echo ""
fi
codesign --verify --strict "$APP"

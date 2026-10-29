#!/bin/sh
# Builds pulse-listen, the on-device speech helper the listening panel runs (src-tauri/listen).
# The release bundle copies it to Pulse.app/Contents/MacOS (tauri.conf.json bundle.macOS.files).
# Its Info.plist (the microphone and speech-recognition usage strings) is embedded in the binary.
set -e
cd "$(dirname "$0")/../src-tauri"
mkdir -p binaries
xcrun swiftc -O -o binaries/pulse-listen listen/main.swift \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker listen/Info.plist
echo "built src-tauri/binaries/pulse-listen"

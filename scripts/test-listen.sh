#!/bin/sh
# Tests pulse-listen's transcript logic (src-tauri/listen/segments.swift) without a microphone.
set -e
cd "$(dirname "$0")/../src-tauri/listen"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -o "$out/test-listen" segments.swift tests/main.swift
"$out/test-listen"

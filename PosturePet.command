#!/usr/bin/env bash
# Double-click launcher for macOS Finder.
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR" || exit 1
bash "$ROOT_DIR/PosturePet.sh" "$@"

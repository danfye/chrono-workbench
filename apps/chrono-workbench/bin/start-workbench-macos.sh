#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG_FILE="/tmp/chrono-workbench-launcher.log"

if [ ! -x "$ELECTRON" ]; then
  osascript -e 'display dialog "Chrono Workbench Electron runtime is missing. Run npm install in apps/chrono-workbench first." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

cd "$APP_DIR"
exec "$ELECTRON" "$APP_DIR" >> "$LOG_FILE" 2>&1

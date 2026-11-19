#!/bin/sh
# Push the logger to the Tessel 1's flash so it starts by itself on every power-up (no computer needed).
# Copies the logger files and the GPS library into a temp folder, fills in START_EPOCH with the current time,
# and runs `tessel push main.js` under Node 0.12. Undo with: nvm use 0.12 && tessel erase
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
. "$HOME/.nvm/nvm.sh"
nvm use 0.12 >/dev/null
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
for f in main app clock rows fat32 sdcard climate camera gps schedule runner; do cp "$HERE/$f.js" "$STAGE/$f.js"; done
mkdir -p "$STAGE/node_modules"
cp -R "$ROOT/node_modules/gps-a2235h" "$STAGE/node_modules/"
NOW=$(date +%s)
sed -i '' "s|var START_EPOCH = 0;|var START_EPOCH = $NOW;|" "$STAGE/main.js"
grep -q "var START_EPOCH = $NOW;" "$STAGE/main.js" || { echo "START_EPOCH was not substituted" >&2; exit 1; }
echo "pushing with START_EPOCH=$NOW ($(date -u -r "$NOW" '+%Y-%m-%d %H:%M:%S') UTC) from $STAGE"
cd "$STAGE"
tessel push main.js

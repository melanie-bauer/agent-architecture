#!/usr/bin/env bash
# Copies the demo from the Windows folder into the WSL home and installs it there.
# Why: Windows App Control blocks the native modules (rollup, libsql, DuckDB, esbuild) on Windows itself.
#
# Run inside WSL, from the demo folder on the Windows drive:
#   cd /mnt/c/Users/<you>/Documents/SoftwareArchitects/basta-herbst-2026/04-agent-architecture/demo
#   bash scripts/wsl-setup.sh            # target: ~/agent-demo
#   bash scripts/wsl-setup.sh ~/other    # other target folder
# Run it again after you change files on the Windows side; your .env in the target is kept.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/agent-demo}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing in WSL. Install Node 22.13 or newer (for example with nvm), then run this again."
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22 && b<13)) { console.error("Node " + process.versions.node + " is too old, this demo needs 22.13 or newer."); process.exit(1) }'
echo "Copying $SRC to $DEST ..."
mkdir -p "$DEST"
# replace everything in the target except your .env and the installed packages
find "$DEST" -mindepth 1 -maxdepth 1 ! -name .env ! -name node_modules -exec rm -rf {} +
tar -C "$SRC" \
  --exclude=./node_modules --exclude=./.mastra --exclude=./.env \
  --exclude='*.db' --exclude='*.db-*' --exclude='*.duckdb' --exclude='*.duckdb.wal' \
  -cf - . | tar -C "$DEST" -xf -

cd "$DEST"
echo "Installing packages ..."
npm ci --no-audit --no-fund
echo "Running the architecture tests ..."
npm test

echo
echo "Ready."
if [ -f .env ]; then
  echo "Found .env (live mode if it contains OPENAI_API_KEY)."
else
  echo "No .env yet, so everything runs with the scripted mock model."
  echo "For live mode: cp .env.example $DEST/.env and put your OPENAI_API_KEY in it."
fi
echo
echo "Start:   cd $DEST && npm run dev:planner-mock     (Incident Desk live if a key is set, planner scripted)"
echo "   or:   cd $DEST && npm run dev                  (everything live, needs the key)"
echo "Open:    http://localhost:4111/planner   http://localhost:4111/desk"

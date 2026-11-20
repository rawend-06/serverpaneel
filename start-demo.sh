#!/usr/bin/env bash
# Rawendpaneel demo op Linux/macOS
cd "$(dirname "$0")/app"
command -v node >/dev/null || { echo "Installeer eerst Node.js (https://nodejs.org)"; exit 1; }
[ -d node_modules/ical.js ] || npm install --omit=dev --no-audit --no-fund
DEMO=1 PORT=${PORT:-3000} node server.js

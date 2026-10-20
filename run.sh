#!/usr/bin/env bash
# Start the Penlight frontend on http://localhost:1837, backed by the live Penlight API.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating .venv…"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
if [[ -f .venv/Scripts/activate ]]; then
    source .venv/Scripts/activate
else
    source .venv/bin/activate
fi
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "Penlight frontend on http://localhost:${PORT:-1837}"
echo "API: ${PENLIGHT_API_BASE:-https://penlight.wardwise.org}"
exec python server.py

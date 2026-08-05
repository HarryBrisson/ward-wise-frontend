#!/usr/bin/env bash
# Start the Penlight frontend on http://localhost:1838.
#
#   ./run.sh                                          # against the live API
#   PENLIGHT_API_BASE=http://localhost:1838 ./run.sh   # against a local backend
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating .venv…"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "Penlight frontend on http://localhost:${PORT:-1838}"
echo "API: ${PENLIGHT_API_BASE:-https://penlight.wardwise.org}"
exec python server.py

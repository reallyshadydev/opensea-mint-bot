#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 20 or newer from https://nodejs.org and run this again."
  exit 1
fi

echo "Node $(node -v)"
npm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from the template."
fi

echo
echo "Next:"
echo "  npm run key"
echo "  npm run generate -- --count 5"
echo "  npm run status"

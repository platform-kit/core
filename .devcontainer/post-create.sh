#!/usr/bin/env bash
# Runs once when the container is created: the dependencies, the headless
# browser the build photographs pages with, and the text-to-speech weights.
# Each step is idempotent, so re-running it after a rebuild is safe.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci
npx playwright install chromium
node packages/kit/build/tts/setup.mjs

echo
echo "ready. next:  npm run dev"

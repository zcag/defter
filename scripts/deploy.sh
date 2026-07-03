#!/usr/bin/env bash
# Deploy the Defter demo + Storybook to defter.cagdas.io (archer:~/web/defter).
# The demo is served at / ; Storybook at /storybook/. The demo rsync excludes the
# storybook/ subdir so --delete never wipes it.
set -euo pipefail
exec > >(tee /tmp/defter-deploy.log) 2>&1
cd "$(dirname "$0")/.."

echo "== building packages =="
node_modules/.bin/tsc -b packages/core packages/formula packages/react packages/yjs packages/xlsx
node packages/react/scripts/copy-css.mjs

echo "== building demo =="
node_modules/.bin/vite build apps/demo

echo "== building storybook =="
node_modules/.bin/storybook build -o storybook-static >/dev/null

echo "== deploying =="
ssh archer 'mkdir -p ~/web/defter/storybook'
rsync -az --delete --exclude 'storybook/' apps/demo/dist/ archer:~/web/defter/
rsync -az --delete storybook-static/ archer:~/web/defter/storybook/

echo "== done: https://defter.cagdas.io  ·  https://defter.cagdas.io/storybook/ =="
curl -sS -o /dev/null -w "demo HTTP %{http_code}\n" https://defter.cagdas.io/
curl -sS -o /dev/null -w "storybook HTTP %{http_code}\n" https://defter.cagdas.io/storybook/

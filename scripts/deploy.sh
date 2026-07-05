#!/usr/bin/env bash
# Deploy the Defter demo + Storybook to defter.cagdas.io (archer:~/web/defter).
# Demo at / ; Storybook at /storybook/. The demo rsync excludes storybook/ so --delete keeps it.
#
# CLEAN build, every time. Stale package dist and — the real trap — Vite's `.vite` optimizer
# cache have silently shipped outdated bundles before (a `vite build` reusing a pre-bundled
# workspace dep). So we wipe those, rebuild packages from source, build the demo, then VERIFY the
# live site actually serves the freshly-built (content-hashed) assets before declaring success.
# The old HTTP-200 check couldn't catch a stale deploy — matching asset hashes can.
set -euo pipefail
exec > >(tee /tmp/defter-deploy.log) 2>&1
cd "$(dirname "$0")/.."

echo "== cleaning stale build outputs & caches =="
rm -rf packages/*/dist packages/*/*.tsbuildinfo
rm -rf apps/demo/dist apps/demo/node_modules/.vite node_modules/.vite storybook-static

echo "== building packages (tsc + copy CSS) =="
pnpm -r --filter "./packages/*" build

echo "== building demo =="
node_modules/.bin/vite build apps/demo

echo "== building storybook =="
node_modules/.bin/storybook build -o storybook-static >/dev/null

echo "== deploying =="
ssh archer 'mkdir -p ~/web/defter/storybook'
rsync -az --delete --exclude 'storybook/' apps/demo/dist/ archer:~/web/defter/
rsync -az --delete storybook-static/ archer:~/web/defter/storybook/

echo "== verifying live site serves the freshly-built assets =="
# Content-hashed asset filenames the build just emitted (entry + preloads + css). Every one must
# appear in the live index.html — matching hashes prove the new bundle actually landed, not a 200.
mapfile -t BUILT < <(grep -oE '/assets/[^"]+\.(js|css)' apps/demo/dist/index.html | sort -u)
[ "${#BUILT[@]}" -gt 0 ] || { echo "FAIL: no hashed assets found in built index.html" >&2; exit 1; }
LIVE_HTML=$(curl -fsS https://defter.cagdas.io/)
for asset in "${BUILT[@]}"; do
  grep -qF "$asset" <<<"$LIVE_HTML" || {
    echo "FAIL: live site does NOT reference $asset — deploy did not land (stale cache/CDN?)." >&2
    echo "      live index references: $(grep -oE '/assets/index-[^\"]+\.js' <<<"$LIVE_HTML" | tail -1)" >&2
    exit 1
  }
done
curl -fsS -o /dev/null -w "storybook HTTP %{http_code}\n" https://defter.cagdas.io/storybook/

echo "== done: https://defter.cagdas.io  ·  https://defter.cagdas.io/storybook/ =="
echo "   verified live: ${#BUILT[@]} freshly-built assets referenced."
exit 0

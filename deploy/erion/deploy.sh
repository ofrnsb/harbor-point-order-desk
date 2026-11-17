#!/usr/bin/env bash
# Runs on erion's GitHub Actions runner for every push (.github/workflows/deploy.yml): copies the checked-out commit
# into the app folder, installs, builds, restarts the service, and fails the deploy if the app does not answer.
# The app's data (./data: the ERP, people, decisions, audit log) and its environment file are never touched.
set -euo pipefail
SRC="${1:?usage: deploy.sh <checked-out source folder>}"
APP="$HOME/apps/harbor-point"
ENV_FILE="$HOME/.config/harbor-point/env"
PORT=3150

mkdir -p "$APP"
rsync -a --delete --exclude data/ --exclude node_modules/ --exclude .next/ --exclude '.env*' --exclude .git/ "$SRC"/ "$APP"/
cd "$APP"
npm ci --no-audit --no-fund
# The lockfile is written on a Mac, so it lists the agent runtime for macOS only; add the one for this server.
SDK_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8')).version")"
npm install --no-save --no-audit --no-fund "@anthropic-ai/claude-agent-sdk-$(node -p 'process.platform')-$(node -p 'process.arch')@$SDK_VERSION"
set -a; . "$ENV_FILE"; set +a
npm run build
[ -f data/systems/harbor_erp.sqlite ] || npm run reset
systemctl --user restart harbor-point
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login"; then echo "deployed $(cat "$APP/.deployed-sha" 2>/dev/null || echo)"; exit 0; fi
  sleep 2
done
journalctl --user -u harbor-point -n 60 --no-pager
echo "harbor-point did not answer on port $PORT after the restart" >&2
exit 1

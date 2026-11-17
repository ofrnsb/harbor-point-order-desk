#!/usr/bin/env bash
# One-time setup on erion, run by hand: the environment file (a fresh master key, the seed password you pass in, the
# agent on each person's own API key), the service, and a GitHub Actions runner that deploys every push.
# Re-running it keeps the existing environment file, data and runner.
#   SEED_PASSWORD='...' RUNNER_TOKEN='<from GitHub>' REPO='ofrnsb/harbor-point-order-desk' PUBLIC_HOST='harborpoint.dodanko.com' bash bootstrap.sh
set -euo pipefail
ENV_DIR="$HOME/.config/harbor-point"
RUNNER_DIR="$HOME/actions-runner-harbor-point"
RUNNER_VERSION="${RUNNER_VERSION:-2.338.2}"
REPO="${REPO:?set REPO, e.g. owner/name}"
UNITS="$HOME/.config/systemd/user"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$ENV_DIR" "$UNITS" "$HOME/apps/harbor-point" && chmod 700 "$ENV_DIR"
if [ ! -f "$ENV_DIR/env" ]; then
  : "${SEED_PASSWORD:?set SEED_PASSWORD for the seeded accounts}"
  ( umask 077; printf '%s\n' "NODE_ENV=production" "SIMPUL_MASTER_KEY=$(openssl rand -base64 32)" "SIMPUL_SEED_PASSWORD='$SEED_PASSWORD'" \
      "SIMPUL_AGENT_KEY_REQUIRED=true" "SIMPUL_PUBLIC_HOSTS=${PUBLIC_HOST:-}" "NEXT_TELEMETRY_DISABLED=1" > "$ENV_DIR/env" )
fi
cp "$HERE/harbor-point.service" "$UNITS/"

if [ ! -f "$RUNNER_DIR/.runner" ]; then
  : "${RUNNER_TOKEN:?set RUNNER_TOKEN (a registration token for $REPO)}"
  mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
  curl -fsSL "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz" | tar xz
  ./config.sh --unattended --url "https://github.com/$REPO" --token "$RUNNER_TOKEN" --name erion-harbor-point --labels erion-harbor-point --replace
fi
cat > "$UNITS/github-runner-harbor-point.service" <<UNIT
[Unit]
Description=GitHub Actions runner for Harbor Point deploys
After=network-online.target

[Service]
WorkingDirectory=$RUNNER_DIR
ExecStart=$RUNNER_DIR/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now github-runner-harbor-point
systemctl --user enable harbor-point
echo "Runner up. The next push to harbor-point deploys to 127.0.0.1:3150."

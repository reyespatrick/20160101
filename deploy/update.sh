#!/usr/bin/env bash
# Deploy the latest commit of the configured branch: pull, install, build, restart. Run as root.
set -euo pipefail
cd /opt/immoba
sudo -u immoba git pull --ff-only
sudo -u immoba npm ci --no-audit --no-fund
sudo -u immoba npm run build
systemctl restart immoba
systemctl --no-pager --lines=5 status immoba

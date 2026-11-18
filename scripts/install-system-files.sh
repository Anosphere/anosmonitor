#!/bin/sh
# Puts the monitor's deploy/ files in place on monitor1 and starts or reloads
# what reads them: the TLS folder, the challenge folder, the two nginx sites,
# the unit.
# Run as root from the repo root:
#
#   sh scripts/install-system-files.sh
#
# Every step is safe to repeat. The TLS site is installed only once the
# certificate exists at /etc/monitor/tls, so the script runs twice at the
# set-up, before and after the certificate (README, "The monitor server"),
# and again after every pull. It restarts the unit at the end.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sh scripts/install-system-files.sh" >&2
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$REPO/deploy"
if [ ! -f "$DEPLOY/monitor.service" ] || [ ! -f "$DEPLOY/nginx/monitor.conf" ] || [ ! -f "$DEPLOY/nginx/monitor-acme.conf" ]; then
  echo "deploy/ not found at $DEPLOY; run this script from the monitorsoftware checkout" >&2
  exit 1
fi

TLS=/etc/monitor/tls
ACME=/var/www/acme
ACCESS_LOG=/var/log/nginx/monitor-access.log

# 1. The TLS folder. The key file is created empty and owner-only before any
#    certificate exists, so the key lands in a file that is already 0600.
mkdir -p "$TLS"
chmod 755 "$TLS"
if [ ! -e "$TLS/key.pem" ]; then
  touch "$TLS/key.pem"
  chmod 600 "$TLS/key.pem"
fi

# 2. The folder acme.sh writes the challenge files into; nginx reads it on
#    port 80.
mkdir -p "$ACME"
chmod 755 "$ACME"

# 3. nginx: the system's default site goes; the port 80 site always; the TLS
#    site once both certificate files are non-empty. The access log the sites
#    declare is created now if it is missing.
rm -f /etc/nginx/sites-enabled/default
install -m 0644 "$DEPLOY/nginx/monitor-acme.conf" /etc/nginx/sites-available/monitor-acme
ln -sf /etc/nginx/sites-available/monitor-acme /etc/nginx/sites-enabled/monitor-acme
site=installed
if [ -s "$TLS/fullchain.pem" ] && [ -s "$TLS/key.pem" ]; then
  install -m 0644 "$DEPLOY/nginx/monitor.conf" /etc/nginx/sites-available/monitor
  ln -sf /etc/nginx/sites-available/monitor /etc/nginx/sites-enabled/monitor
else
  site=skipped
  echo "TLS site skipped: no certificate at $TLS yet; put it there, then run this script again"
fi
if [ ! -e "$ACCESS_LOG" ]; then
  touch "$ACCESS_LOG"
  chown root:adm "$ACCESS_LOG"
  chmod 640 "$ACCESS_LOG"
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

# 4. The unit.
install -m 0644 "$DEPLOY/monitor.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable monitor
systemctl restart monitor

# 5. What happened.
echo "Installed: $TLS, $ACME, nginx site monitor-acme, nginx site monitor ($site), unit monitor.service."
echo "The unit was restarted: journalctl -fu monitor"
if [ "$site" = skipped ]; then
  echo "Next: the certificate into $TLS (README, \"The monitor server\"), then this script again."
fi

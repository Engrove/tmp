#!/usr/bin/env bash
# Install or upgrade GreenSea as a systemd service.
#   sudo ./deploy/install.sh            (run from the greensea/ directory)
# Idempotent: an existing /etc/greensea/greensea.toml and the database are kept.
set -euo pipefail

PREFIX=/opt/greensea
CONF_DIR=/etc/greensea
UNIT=/etc/systemd/system/greensea.service
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "run as root (sudo $0)" >&2
  exit 1
fi
PY=${PYTHON:-python3}
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || {
  echo "Python 3.11 or newer is required ($PY is $("$PY" --version 2>&1))" >&2
  exit 1
}

echo "== service user"
id greensea >/dev/null 2>&1 || useradd --system --home-dir /var/lib/greensea --shell /usr/sbin/nologin greensea

echo "== code -> $PREFIX"
install -d -m 0755 "$PREFIX"
rm -rf "$PREFIX/src"
install -d -m 0755 "$PREFIX/src"
cp -r "$SRC/greensea" "$SRC/pyproject.toml" "$SRC/README.md" "$PREFIX/src/"
[[ -x "$PREFIX/venv/bin/python" ]] || "$PY" -m venv "$PREFIX/venv"
"$PREFIX/venv/bin/pip" install --quiet --upgrade pip
"$PREFIX/venv/bin/pip" install --quiet "$PREFIX/src"

echo "== configuration -> $CONF_DIR"
install -d -m 0750 -g greensea "$CONF_DIR"
if [[ ! -f "$CONF_DIR/greensea.toml" ]]; then
  TOKEN=$("$PY" -c 'import secrets; print(secrets.token_urlsafe(32))')
  sed "s|^auth_token = \"\"|auth_token = \"$TOKEN\"|" "$SRC/deploy/greensea.toml.example" > "$CONF_DIR/greensea.toml"
  chown root:greensea "$CONF_DIR/greensea.toml"
  chmod 0640 "$CONF_DIR/greensea.toml"
  echo "   created $CONF_DIR/greensea.toml with a new login token:"
  echo "   $TOKEN"
else
  echo "   keeping existing $CONF_DIR/greensea.toml"
fi
"$PREFIX/venv/bin/greensea" --config "$CONF_DIR/greensea.toml" --check

echo "== systemd unit"
install -m 0644 "$SRC/deploy/greensea.service" "$UNIT"
systemctl daemon-reload
systemctl enable greensea.service >/dev/null
systemctl restart greensea.service
sleep 1
systemctl --no-pager --lines=5 status greensea.service || true
echo
echo "Done. Web interface: http://<host>:<port>/ (see [server] in $CONF_DIR/greensea.toml)"
echo "Logs: journalctl -u greensea -f"

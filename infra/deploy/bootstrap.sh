#!/usr/bin/env bash
# one-time setup of a fresh ubuntu 24.04 vm for weft; safe to run again
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo: sudo bash bootstrap.sh" >&2
  exit 1
fi

DEPLOY_USER="${SUDO_USER:-azureuser}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get install -y -q ca-certificates curl unattended-upgrades

echo "== docker engine and compose plugin"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"

echo "== swap ($SWAP_SIZE)"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-weft.conf
sysctl -q --system

echo "== unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades

echo "== /opt/weft"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/weft

echo
echo "done. log out and back in so '$DEPLOY_USER' can use docker without sudo."
echo "put this in /opt/weft/.env:"
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)"

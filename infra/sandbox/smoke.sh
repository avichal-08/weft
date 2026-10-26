#!/usr/bin/env sh
set -eu

image="${1:-weft-sandbox:dev}"

docker run --rm --network none --tmpfs /tmp:exec --tmpfs /var/tmp --tmpfs /run/lock \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m \
  "$image" sh -ec '
    test "$(id -u)" = 1000
    node --version
    git --version
    rg --version | head -1
    v=$(pnpm --version) && echo "pnpm $v"
    v=$(yarn --version) && echo "yarn $v"
    v=$(bun --version) && echo "bun $v"
    test -L "$COREPACK_HOME/v1/pnpm/$(ls /opt/corepack/v1/pnpm)"
    if touch /usr/weft-smoke 2>/dev/null; then echo "/usr is writable"; exit 1; fi
    cd /workspace && git init -q && echo ok > f && git add f && git commit -qm init
    echo "sandbox smoke ok"
  '

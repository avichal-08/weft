#!/bin/sh
set -e

mkdir -p "$COREPACK_HOME/v1"
for tool in /opt/corepack/v1/*; do
  [ -d "$tool" ] || continue
  mkdir -p "$COREPACK_HOME/v1/${tool##*/}"
  for version in "$tool"/*; do
    ln -sfn "$version" "$COREPACK_HOME/v1/${tool##*/}/${version##*/}"
  done
done
[ -f /opt/corepack/lastKnownGood.json ] && cp /opt/corepack/lastKnownGood.json "$COREPACK_HOME/"

exec "$@"

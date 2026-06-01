#!/bin/bash
# Run from monorepo root:
#   ./apps/km/scripts/record-tour/record-and-encode.sh refs_fill
set -e
SCENE="$1"
if [ -z "$SCENE" ]; then
  echo "usage: $0 <scene>"
  exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

cd "$ROOT/apps/km"
RAW=$(pnpm --silent record-tour "$SCENE" | tail -n 1)

cd "$HERE"
./encode.sh "$RAW" "$ROOT/apps/km/public/tour/wow_${SCENE}.webm"
